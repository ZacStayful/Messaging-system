/**
 * Message bodies are stored as plain text with a small markdown subset:
 *   **Heading**      a line that is entirely bold becomes a heading
 *   - item           bullet list
 *   [text](url)      link with label
 *   https://…        bare links are auto-linked
 *   @Name            mention chip (single-word display name)
 *   @[Nigel Hyde]    mention chip for a display name with spaces
 *   **bold**         inline bold
 */
export type Inline =
  | { type: "text"; text: string }
  | { type: "bold"; text: string }
  | { type: "link"; text: string; href: string }
  | { type: "mention"; text: string; name: string };

export type Block = { type: "p"; lines: Inline[][] } | { type: "h"; text: string } | { type: "ul"; items: Inline[][] };

const URL_RE = /https?:\/\/[^\s<>()\]]+[^\s<>()\].,;:!?'"]/g;
const MENTION = String.raw`@\[([^\]\n]{1,80})\]|@([A-Za-z][\w-]*(?:\.[A-Za-z][\w-]*)*)`;
const INLINE_RE = new RegExp(
  String.raw`\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(\*\*[^*]+\*\*)|(?:${MENTION})|(https?:\/\/[^\s<>()\]]+[^\s<>()\].,;:!?'"])`,
  "g",
);
const MENTION_RE = new RegExp(MENTION, "g");

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ type: "text", text: text.slice(last, idx) });
    if (m[1] && m[2]) out.push({ type: "link", text: m[1], href: m[2] });
    else if (m[3]) out.push({ type: "bold", text: m[3].slice(2, -2) });
    else if (m[4]) out.push({ type: "mention", text: `@${m[4]}`, name: m[4] });
    else if (m[5]) out.push({ type: "mention", text: `@${m[5]}`, name: m[5] });
    else if (m[6]) out.push({ type: "link", text: m[6], href: m[6] });
    last = idx + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out;
}

export function parseBlocks(body: string): Block[] {
  const blocks: Block[] = [];
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  let para: Inline[][] = [];
  let list: Inline[][] = [];

  const flushPara = () => {
    if (para.length) blocks.push({ type: "p", lines: para });
    para = [];
  };
  const flushList = () => {
    if (list.length) blocks.push({ type: "ul", items: list });
    list = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === "") {
      flushPara();
      flushList();
      continue;
    }
    const heading = /^\*\*(.+)\*\*$/.exec(line.trim());
    if (heading) {
      flushPara();
      flushList();
      blocks.push({ type: "h", text: heading[1] });
      continue;
    }
    const item = /^[-*•]\s+(.*)$/.exec(line.trim());
    if (item) {
      flushPara();
      list.push(parseInline(item[1]));
      continue;
    }
    flushList();
    para.push(parseInline(line));
  }
  flushPara();
  flushList();
  return blocks;
}

export interface ExtractedLink {
  href: string;
  host: string;
  path: string;
}

/** Every URL in a body, deduplicated, for the "Files and links" tab. */
export function extractLinks(body: string): ExtractedLink[] {
  const seen = new Set<string>();
  const out: ExtractedLink[] = [];
  for (const m of body.matchAll(URL_RE)) {
    const href = m[0];
    if (seen.has(href)) continue;
    seen.add(href);
    try {
      const u = new URL(href);
      out.push({ href, host: u.host.replace(/^www\./, ""), path: `${u.pathname}${u.search}` });
    } catch {
      // ignore malformed URLs
    }
  }
  return out;
}

/** Display names found as @mentions in a body. */
export function mentionedNames(body: string): string[] {
  return Array.from(body.matchAll(MENTION_RE), (m) => m[1] ?? m[2]);
}

/** The text the composer inserts for a mention of `displayName`. */
export function mentionToken(displayName: string): string {
  const name = displayName.trim();
  return /^[A-Za-z][\w-]*(?:\.[A-Za-z][\w-]*)*$/.test(name) ? `@${name}` : `@[${name}]`;
}
