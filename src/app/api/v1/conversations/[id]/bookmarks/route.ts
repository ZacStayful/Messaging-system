import { withApiKey } from "@/lib/api/withApiKey";
import { ok } from "@/lib/api/respond";
import { addBookmark, listBookmarks, type BookmarkInput } from "@/lib/api/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApiKey(async ({ db, params }) => ok(await listBookmarks(db, params.id)), {
  scopes: ["bookmarks:read"],
});

export const POST = withApiKey(
  async ({ request, db, params }) =>
    ok(await addBookmark(db, params.id, (await request.json()) as BookmarkInput), { status: 201 }),
  { scopes: ["bookmarks:write"] },
);
