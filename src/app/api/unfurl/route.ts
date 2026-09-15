import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeHttpUrl } from "@/lib/urls";

export const dynamic = "force-dynamic";

export interface UnfurlResult {
  url: string;
  title: string | null;
  description: string | null;
  image_url: string | null;
  site_name: string | null;
  ok: boolean;
}

const CACHE_MS = 7 * 24 * 60 * 60_000;
const MAX_BYTES = 512 * 1024;

/** Shared with the bookmark features, so the rule exists once. See src/lib/urls.ts. */
function blocked(u: URL): boolean {
  return safeHttpUrl(u.toString()) === null;
}

function meta(html: string, key: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`,
    "i",
  );
  const m = re.exec(html);
  const v = m?.[1] ?? m?.[2];
  return v ? decode(v).trim() || null : null;
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

async function fetchPreview(url: string): Promise<UnfurlResult> {
  const empty: UnfurlResult = { url, title: null, description: null, image_url: null, site_name: null, ok: false };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; StayfulBot/1.0; +https://stayful.co.uk)",
        accept: "text/html",
      },
    });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return empty;
    const reader = res.body?.getReader();
    if (!reader) return empty;
    let received = 0;
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      received += value.length;
      if (received > MAX_BYTES) break;
    }
    void reader.cancel().catch(() => undefined);
    const html = new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
    const titleTag = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1];
    const title = meta(html, "og:title") ?? meta(html, "twitter:title") ?? (titleTag ? decode(titleTag).trim() : null);
    const description = meta(html, "og:description") ?? meta(html, "twitter:description") ?? meta(html, "description");
    let image = meta(html, "og:image") ?? meta(html, "twitter:image");
    if (image) {
      try {
        image = new URL(image, res.url).toString();
      } catch {
        image = null;
      }
    }
    const site = meta(html, "og:site_name") ?? new URL(res.url).host.replace(/^www\./, "");
    return {
      url,
      title,
      description: description ? description.slice(0, 300) : null,
      image_url: image,
      site_name: site,
      ok: !!title,
    };
  } catch {
    return empty;
  } finally {
    clearTimeout(timer);
  }
}

/** GET /api/unfurl?url=… → Open Graph summary for a link, cached in link_previews for a week. Signed-in only. */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const raw = request.nextUrl.searchParams.get("url") ?? "";
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return NextResponse.json({ error: "bad url" }, { status: 400 });
  }
  if (blocked(target)) return NextResponse.json({ error: "not allowed" }, { status: 400 });
  const url = target.toString();

  const { data: cached } = await supabase.from("link_previews").select("*").eq("url", url).maybeSingle();
  if (cached && Date.now() - new Date(cached.fetched_at).getTime() < CACHE_MS) {
    return NextResponse.json(cached, { headers: { "cache-control": "private, max-age=3600" } });
  }

  const result = await fetchPreview(url);
  const admin = createAdminClient();
  if (admin) {
    await admin
      .from("link_previews")
      .upsert({ ...result, fetched_at: new Date().toISOString() }, { onConflict: "url" });
  }
  return NextResponse.json(result, { headers: { "cache-control": "private, max-age=3600" } });
}
