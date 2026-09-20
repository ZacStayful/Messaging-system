/**
 * Slack's mrkdwn → this app's message markup (src/lib/richtext.ts).
 *
 * The two are close cousins and differ in exactly the places that matter for a faithful copy:
 *
 *   Slack                          here
 *   *bold*                         **bold**
 *   <@U123>  <@U123|name>          @Name / @[Name With Spaces]   (mentionToken, by display name)
 *   <#C123|name>                   #name                          (no channel-link token exists)
 *   <!here> <!channel> <!everyone> @here @channel @everyone      (plain text)
 *   <!subteam^S123|@handle>        @handle
 *   <!date^…|fallback>             fallback
 *   <https://x|label>  <https://x> [label](https://x)  https://x
 *   &amp; &lt; &gt;                & < >                          (decoded last, after the tokens)
 *   :shortcode:                    the character                  (custom emoji left as text)
 *   _italic_ ~strike~ `code` ```…``` &gt; quote                   unchanged
 *
 * Pure. Code spans are protected first so nothing inside them is rewritten.
 */

import { mentionToken } from "@/lib/richtext";
import { replaceShortcodes } from "./emoji";

export interface MrkdwnContext {
  /** Display name for a Slack user id, or null when unknown. */
  userName: (id: string) => string | null;
  /** Profile id for a Slack user id, for meta.mentions. */
  userProfileId?: (id: string) => string | null;
  channelName: (id: string) => string | null;
}

export interface ConvertedBody {
  body: string;
  /** Profile ids mentioned, the composer's convention for meta.mentions. */
  mentions: string[];
}

const noContext: MrkdwnContext = { userName: () => null, channelName: () => null };

function decodeEntities(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function convertSegment(text: string, ctx: MrkdwnContext, mentions: Set<string>): string {
  let out = text.replace(/<([^<>]+)>/g, (whole, inner: string) => {
    if (inner.startsWith("@")) {
      const [id, label] = inner.slice(1).split("|");
      const name = ctx.userName(id) ?? label ?? id;
      const pid = ctx.userProfileId?.(id);
      if (pid) mentions.add(pid);
      return mentionToken(name);
    }
    if (inner.startsWith("#")) {
      const [id, label] = inner.slice(1).split("|");
      return `#${label ?? ctx.channelName(id) ?? id}`;
    }
    if (inner.startsWith("!")) {
      const [cmd, label] = inner.slice(1).split("|");
      if (cmd === "here" || cmd === "channel" || cmd === "everyone") return `@${cmd}`;
      if (cmd.startsWith("subteam^")) return label ?? "@group";
      if (cmd.startsWith("date^")) return label ?? cmd;
      return label ?? whole;
    }
    if (/^(https?:\/\/|mailto:|tel:)/i.test(inner)) {
      const [url, label] = inner.split("|");
      if (url.startsWith("mailto:") || url.startsWith("tel:")) return label ?? url.replace(/^(mailto|tel):/, "");
      return label && label !== url ? `[${label}](${url})` : url;
    }
    return whole;
  });
  // Slack bold is a single asterisk with word boundaries; this app's is double.
  out = out.replace(/(?<![\w*\\])\*([^*\n]+)\*(?![\w*])/g, "**$1**");
  out = replaceShortcodes(out);
  return decodeEntities(out);
}

export function mrkdwnToBody(text: string, ctx: MrkdwnContext = noContext): ConvertedBody {
  const mentions = new Set<string>();
  // Odd indexes are code (fenced first, then inline), copied through untouched apart from entities.
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]+`)/);
  const body = parts
    .map((part, i) => (i % 2 === 1 ? decodeEntities(part) : convertSegment(part, ctx, mentions)))
    .join("")
    .replace(/\r\n/g, "\n")
    .trim();
  return { body, mentions: Array.from(mentions) };
}

/**
 * Text for a message whose `text` is empty because it was posted as blocks (most app posts) or
 * as a legacy attachment. Best effort: rich_text and section blocks are read; images and
 * dividers are not. Returns mrkdwn, for mrkdwnToBody.
 */
export function blocksToText(
  blocks: unknown[] | undefined,
  attachments?: { fallback?: string; text?: string; title?: string; title_link?: string }[],
): string {
  const lines: string[] = [];
  const el = (e: Record<string, unknown>): string => {
    const t = e.type;
    if (t === "text") return String(e.text ?? "");
    if (t === "link") return e.text ? `<${String(e.url)}|${String(e.text)}>` : `<${String(e.url)}>`;
    if (t === "user") return `<@${String(e.user_id)}>`;
    if (t === "channel") return `<#${String(e.channel_id)}>`;
    if (t === "emoji") return `:${String(e.name)}:`;
    if (t === "broadcast") return `<!${String(e.range ?? "here")}>`;
    if (t === "usergroup") return `<!subteam^${String(e.usergroup_id)}>`;
    return "";
  };
  for (const raw of blocks ?? []) {
    const b = raw as Record<string, unknown>;
    if (b.type === "section") {
      const text = b.text as { text?: string } | undefined;
      if (text?.text) lines.push(text.text);
      for (const f of (b.fields as { text?: string }[] | undefined) ?? []) if (f.text) lines.push(f.text);
    } else if (b.type === "header") {
      const text = b.text as { text?: string } | undefined;
      if (text?.text) lines.push(`*${text.text}*`);
    } else if (b.type === "context") {
      const parts = ((b.elements as Record<string, unknown>[] | undefined) ?? [])
        .map((e) => (e.type === "image" ? "" : String(e.text ?? "")))
        .filter(Boolean);
      if (parts.length) lines.push(parts.join(" "));
    } else if (b.type === "rich_text") {
      for (const sec of (b.elements as Record<string, unknown>[] | undefined) ?? []) {
        const inner = (sec.elements as Record<string, unknown>[] | undefined) ?? [];
        if (sec.type === "rich_text_list") {
          for (const item of inner) {
            const text = ((item.elements as Record<string, unknown>[] | undefined) ?? []).map(el).join("");
            lines.push(`- ${text}`);
          }
        } else if (sec.type === "rich_text_preformatted") {
          lines.push("```" + inner.map(el).join("") + "```");
        } else if (sec.type === "rich_text_quote") {
          lines.push("&gt; " + inner.map(el).join(""));
        } else {
          lines.push(inner.map(el).join(""));
        }
      }
    }
  }
  if (lines.length === 0) {
    for (const a of attachments ?? []) {
      const title = a.title ? (a.title_link ? `<${a.title_link}|${a.title}>` : a.title) : "";
      const text = [title, a.text ?? a.fallback ?? ""].filter(Boolean).join("\n");
      if (text) lines.push(text);
    }
  }
  return lines.join("\n");
}
