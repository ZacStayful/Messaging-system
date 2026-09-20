import table from "./emoji.json";

const NAMES = table as Record<string, string>;

/**
 * A Slack emoji name → the character this app stores. Handles the skin-tone suffix Slack puts on
 * a reaction (`thumbsup::skin-tone-3`) and falls back to the base character for a tone the table
 * does not carry. Returns null for a custom (workspace) emoji, which has no character at all.
 */
export function shortcodeToUnicode(name: string): string | null {
  const key = name.trim().replace(/^:|:$/g, "");
  if (!key) return null;
  const direct = NAMES[key];
  if (direct) return direct;
  const base = key.split("::")[0];
  return NAMES[base] ?? null;
}

/**
 * Replaces `:shortcode:` in message text with the character. Unknown names — custom emoji — are
 * left as they are, which reads as `:partyparrot:` and is the honest rendering of something this
 * app has no picture for. Skips fenced and inline code, where a colon pair is more likely a
 * time or a label than an emoji.
 */
export function replaceShortcodes(text: string): string {
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]+`)/);
  return parts
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(/:([a-z0-9_+\-]+(?:::skin-tone-[2-6])?):/gi, (whole, name: string) => {
            const ch = shortcodeToUnicode(name);
            return ch ?? whole;
          }),
    )
    .join("");
}
