/**
 * Runs the Slack worker from a machine rather than the cron, for a first full import at full
 * speed or to push one channel through by hand.
 *
 *   pnpm slack:backfill                 keep taking slices until nothing is due
 *   pnpm slack:backfill --once          one slice, like a single cron tick
 *   pnpm slack:backfill --slice 600     a longer slice (seconds; default 300)
 *
 * Needs .env.local with SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET (the worker acts as the
 * admin on the settings page for the account RPCs) and SLACK_USER_TOKEN. Same code path as
 * /api/cron/slack: nothing here is a shortcut.
 */
import { config } from "dotenv";
import { createAdminClient } from "@/lib/supabase/admin";
import { runSlice } from "@/lib/slack/backfill";

config({ path: ".env.local" });
config();

const args = process.argv.slice(2);
const once = args.includes("--once");
const sliceIdx = args.indexOf("--slice");
const sliceSeconds = sliceIdx >= 0 ? Number(args[sliceIdx + 1]) || 300 : 300;

async function main() {
  const admin = createAdminClient();
  if (!admin) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  for (let i = 1; ; i += 1) {
    const started = Date.now();
    const report = await runSlice(admin, sliceSeconds * 1000, { holder: `cli-${process.pid}`, maxConversations: 1000 });
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    const rooms = report.conversations.map((c) => `${c.name ?? c.channel}: ${c.from}→${c.to}${c.error ? ` (${c.error})` : ""}`);
    console.log(`slice ${i} (${secs}s) phase=${report.phase}${report.stopped ? ` stopped=${report.stopped}` : ""}`);
    if (report.discovery) console.log("  discovery", report.discovery);
    if (report.users) console.log("  users", report.users);
    if (rooms.length) console.log("  " + rooms.join("\n  "));
    if (report.files) console.log("  files", report.files);
    const idle = report.phase === "idle" || report.stopped;
    if (once || idle) break;
    if (report.stopped === "rate limited") await new Promise((r) => setTimeout(r, 30_000));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
