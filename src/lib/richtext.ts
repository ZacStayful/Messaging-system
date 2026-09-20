/**
 * Message bodies are stored as plain text with a small markdown subset (Slack's "mrkdwn"):
 *   **Heading**      a line that is entirely bold becomes a heading
 *   - item           bullet list          1. item     numbered list
 *   > quote          block quote          ```code```  code block (fenced, multi-line)
 *   [text](url)      link with label      https://…   bare links are auto-linked
 *   @Name            mention chip (single-word display name)
 *   @[Nigel Hyde]    mention chip for a display name with spaces
 *   **bold**  _italic_ or *italic*  ~strike~  `code`
 */
export type Inline =
  | { type: "text"; text: string }
  | { type: "bold"; text: string }
  | { type: "italic"; text: string }
  | { type: "strike"; text: string }
  | { type: "code"; text: string }
  | { type: "link"; text: string; href: string }
  | { type: "mention"; text: string; name: string };

export type Block =
  | { type: "p"; lines: Inline[][] }
  | { type: "h"; text: string }
  | { type: "ul"; items: Inline[][] }
  | { type: "ol"; items: Inline[][]; start: number }
  | { type: "quote"; lines: Inline[][] }
  | { type: "code"; text: string };

const URL_SRC = String.raw`https?:\/\/[^\s<>()\]]+[^\s<>()\].,;:!?'"]`;
const URL_RE = new RegExp(URL_SRC, "g");
// Not after a word character or a dot: "zac@stayful.co.uk" is an address, not a mention of
// "stayful.co.uk". The composer only offers a mention at the start or after a space anyway.
const MENTION = String.raw`(?<![\w.])(?:@\[([^\]\n]{1,80})\]|@([A-Za-z][\w-]*(?:\.[A-Za-z][\w-]*)*))`;
// Order matters: labelled link, code, bold, italic, strike, mention, bare URL.
const INLINE_RE = new RegExp(
  [
    String.raw`\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)`, // 1,2 link
    String.raw`` + "`([^`\\n]+)`", // 3 code
    String.raw`\*\*([^*\n]+)\*\*`, // 4 bold
    String.raw`(?<![\w*\\])\*([^*\n]+)\*(?![\w*])|(?<![\w\\])_([^_\n]+)_(?![\w])`, // 5,6 italic
    String.raw`(?<![\w~])~([^~\n]+)~(?![\w~])`, // 7 strike
    `(?:${MENTION})`, // 8,9 mention
    `(${URL_SRC})`, // 10 url
  ].join("|"),
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
    else if (m[3]) out.push({ type: "code", text: m[3] });
    else if (m[4]) out.push({ type: "bold", text: m[4] });
    else if (m[5] || m[6]) out.push({ type: "italic", text: m[5] ?? m[6] });
    else if (m[7]) out.push({ type: "strike", text: m[7] });
    else if (m[8]) out.push({ type: "mention", text: `@${m[8]}`, name: m[8] });
    else if (m[9]) out.push({ type: "mention", text: `@${m[9]}`, name: m[9] });
    else if (m[10]) out.push({ type: "link", text: m[10], href: m[10] });
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
  let olist: { items: Inline[][]; start: number } | null = null;
  let quote: Inline[][] = [];
  let code: string[] | null = null;

  const flushPara = () => {
    if (para.length) blocks.push({ type: "p", lines: para });
    para = [];
  };
  const flushList = () => {
    if (list.length) blocks.push({ type: "ul", items: list });
    list = [];
    if (olist) blocks.push({ type: "ol", items: olist.items, start: olist.start });
    olist = null;
  };
  const flushQuote = () => {
    if (quote.length) blocks.push({ type: "quote", lines: quote });
    quote = [];
  };
  const flushAll = () => {
    flushPara();
    flushList();
    flushQuote();
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (code !== null) {
      if (line.trim().startsWith("```")) {
        blocks.push({ type: "code", text: code.join("\n") });
        code = null;
      } else code.push(raw);
      continue;
    }
    const fence = /^```(\w*)\s*(.*)$/.exec(line.trim());
    if (fence) {
      flushAll();
      // ```code``` on one line
      const oneLine = /^```(.*?)```$/.exec(line.trim());
      if (oneLine && line.trim().length > 6) blocks.push({ type: "code", text: oneLine[1] });
      else code = fence[2] ? [fence[2]] : [];
      continue;
    }
    if (line.trim() === "") {
      flushAll();
      continue;
    }
    // No asterisk inside: "**Update:** all done **today**" is a paragraph with two bold runs.
    const heading = /^\*\*([^*]+)\*\*$/.exec(line.trim());
    if (heading) {
      flushAll();
      blocks.push({ type: "h", text: heading[1] });
      continue;
    }
    const q = /^>\s?(.*)$/.exec(line.trim());
    if (q) {
      flushPara();
      flushList();
      quote.push(parseInline(q[1]));
      continue;
    }
    const item = /^[-*•]\s+(.*)$/.exec(line.trim());
    if (item) {
      flushPara();
      flushQuote();
      if (olist) flushList();
      list.push(parseInline(item[1]));
      continue;
    }
    const num = /^(\d{1,3})[.)]\s+(.*)$/.exec(line.trim());
    if (num) {
      flushPara();
      flushQuote();
      if (list.length) flushList();
      if (!olist) olist = { items: [], start: Number(num[1]) || 1 };
      olist.items.push(parseInline(num[2]));
      continue;
    }
    flushList();
    flushQuote();
    para.push(parseInline(line));
  }
  if (code !== null) blocks.push({ type: "code", text: code.join("\n") });
  flushAll();
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

/** The first URL worth unfurling: not a Stayful link, not a direct image/file. */
export function previewableLink(body: string): string | null {
  for (const l of extractLinks(body)) {
    if (l.host.endsWith("stayful.co.uk") || l.host === "localhost") continue;
    if (/\.(png|jpe?g|gif|webp|svg|pdf|zip|mp4|mov|mp3|m4a)$/i.test(l.path.split("?")[0])) continue;
    return l.href;
  }
  return null;
}

/** Display names found as @mentions in a body. */
export function mentionedNames(body: string): string[] {
  return Array.from(body.matchAll(MENTION_RE), (m) => m[1] ?? m[2]);
}

/**
 * Does this preview @mention `displayName`?
 *
 * The realtime handler used to build `new RegExp("@\\[?" + display_name + "\\b")`, which put an
 * arbitrary display name into a pattern. A name with an unbalanced bracket ("Dan [") or a
 * leading quantifier threw a SyntaxError inside the message_created handler — before the state
 * update, so that person's sidebar silently stopped moving until they reloaded — and a name
 * with a full stop ("J. Smith") matched anything in that position and badged false mentions.
 *
 * Asking the mention parser is both safer and more accurate: it understands the two forms the
 * composer actually writes (`@Name` and `@[Name With Spaces]`), so no name needs escaping.
 */
export function previewMentions(preview: string, displayName: string): boolean {
  const target = displayName.trim().toLowerCase();
  if (!target) return false;
  return mentionedNames(preview).some((n) => n?.trim().toLowerCase() === target);
}

/** The text the composer inserts for a mention of `displayName`. */
export function mentionToken(displayName: string): string {
  const name = displayName.trim();
  return /^[A-Za-z][\w-]*(?:\.[A-Za-z][\w-]*)*$/.test(name) ? `@${name}` : `@[${name}]`;
}

/** Body → plain text (formatting markers stripped) for previews and notifications. */
export function plainText(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?/g, "").replace(/```$/, ""))
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/(?<![\w*\\])\*([^*\n]+)\*(?![\w*])/g, "$1")
    .replace(/(?<![\w\\])_([^_\n]+)_(?![\w])/g, "$1")
    .replace(/(?<![\w~])~([^~\n]+)~(?![\w~])/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/^>\s?/gm, "")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1")
    .replace(/@\[([^\]\n]{1,80})\]/g, "@$1");
}
