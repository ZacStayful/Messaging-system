/**
 * Regenerates src/lib/slack/emoji.json: every Slack short name → the unicode character.
 *
 *   pnpm tsx scripts/gen-slack-emoji.ts
 *
 * Slack stores a reaction as its short name (`thumbsup`, `+1`, `heart`), with a skin tone as a
 * suffix (`thumbsup::skin-tone-3`). This app stores the character the picker inserted
 * (src/lib/emoji.ts), so the import needs the table. `emoji-datasource` is the same data set
 * Slack's own clients are built on, which is why it is the source rather than a hand-written
 * list; it is a devDependency because only this script reads it.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import data from "emoji-datasource/emoji.json" with { type: "json" };

interface Entry {
  unified: string;
  short_names: string[];
  skin_variations?: Record<string, { unified: string }>;
}

const toChar = (unified: string) => String.fromCodePoint(...unified.split("-").map((cp) => Number.parseInt(cp, 16)));

const SKIN: Record<string, string> = {
  "1F3FB": "skin-tone-2",
  "1F3FC": "skin-tone-3",
  "1F3FD": "skin-tone-4",
  "1F3FE": "skin-tone-5",
  "1F3FF": "skin-tone-6",
};

const table: Record<string, string> = {};
for (const entry of data as Entry[]) {
  const base = toChar(entry.unified);
  for (const name of entry.short_names) {
    table[name] = base;
    for (const [tone, variant] of Object.entries(entry.skin_variations ?? {})) {
      const suffix = SKIN[tone];
      if (suffix) table[`${name}::${suffix}`] = toChar(variant.unified);
    }
  }
}

const out = resolve(process.cwd(), "src/lib/slack/emoji.json");
writeFileSync(out, JSON.stringify(table));
console.log(`${Object.keys(table).length} names written to ${out}`);
