import { withApiKey } from "@/lib/api/withApiKey";
import { ok } from "@/lib/api/respond";
import { deleteBookmark, moveBookmark, updateBookmark, type BookmarkInput } from "@/lib/api/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const PATCH = withApiKey(
  async ({ request, db, params }) => {
    const body = (await request.json()) as Partial<BookmarkInput> & { move?: number };
    // A reorder and an edit are different operations on the same row; `move` picks the former.
    if (typeof body.move === "number") return ok(await moveBookmark(db, params.id, body.move));
    return ok(await updateBookmark(db, params.id, body));
  },
  { scopes: ["bookmarks:write"] },
);

export const DELETE = withApiKey(async ({ db, params }) => ok(await deleteBookmark(db, params.id)), {
  scopes: ["bookmarks:write"],
});
