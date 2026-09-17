import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeHttpUrl } from "@/lib/urls";
import { fetchPublicUrl } from "@/lib/net/fetchPublicUrl";

export const dynamic = "force-dynamic";
// node:dns and node:https, for the address check that happens inside the connect path.
export const runtime = "nodejs";

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
  try {
    // fetchPublicUrl, not fetch: it validates the resolved address inside the connect path and
    // re-checks every redirect hop, so neither a hostname that resolves inwards nor a 302 into
    // the private network gets a socket. See src/lib/net/fetchPublicUrl.ts.
    const res = await fetchPublicUrl(url, {
      maxBytes: MAX_BYTES,
      accept: "text/html",
      userAgent: "Mozilla/5.0 (compatible; StayfulBot/1.0; +https://stayful.co.uk)",
    });
    if (!res || res.status < 200 || res.status >= 300 || !res.contentType.includes("html")) return empty;
    const html = res.body;
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

  // The cache is per organisation (0030). It used to be one global table readable by every
  // signed-in account, which made it a list of the links other tenants post, with titles.
  const { data: me } = await supabase.from("profiles").select("org_id").eq("id", user.id).maybeSingle();
  if (!me?.org_id) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  // The select goes through RLS as the caller, so it can only ever see their own org's row.
  const { data: cached } = await supabase.from("link_previews").select("*").eq("url", url).maybeSingle();
  if (cached && Date.now() - new Date(cached.fetched_at).getTime() < CACHE_MS) {
    return NextResponse.json(cached, { headers: { "cache-control": "private, max-age=3600" } });
  }

  const result = await fetchPreview(url);
  const admin = createAdminClient();
  if (admin) {
    await admin
      .from("link_previews")
      .upsert({ ...result, org_id: me.org_id, fetched_at: new Date().toISOString() }, { onConflict: "org_id,url" });
  }
  return NextResponse.json(result, { headers: { "cache-control": "private, max-age=3600" } });
}
