import { withApiKey } from "@/lib/api/withApiKey";
import { ok } from "@/lib/api/respond";
import { setMyStatus, type StatusInput } from "@/lib/api/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const PATCH = withApiKey(
  async ({ request, ctx, db }) => ok(await setMyStatus(db, ctx, (await request.json()) as StatusInput)),
  { scopes: ["status:write"] },
);
