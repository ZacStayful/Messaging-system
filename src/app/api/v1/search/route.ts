import { withApiKey } from "@/lib/api/withApiKey";
import { fail, ok } from "@/lib/api/respond";
import { searchMessages } from "@/lib/api/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApiKey(
  async ({ request, db }) => {
    const q = new URL(request.url).searchParams;
    const query = q.get("q");
    if (!query) return fail("invalid_request", "Pass what to search for as ?q=");
    return ok(await searchMessages(db, query, { limit: Number(q.get("limit")) || undefined }));
  },
  { scopes: ["messages:read"] },
);
