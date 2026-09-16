import { withApiKey } from "@/lib/api/withApiKey";
import { ok } from "@/lib/api/respond";
import { listReplies } from "@/lib/api/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApiKey(
  async ({ request, db, params }) => {
    const limit = Number(new URL(request.url).searchParams.get("limit")) || undefined;
    return ok(await listReplies(db, params.id, { limit }));
  },
  { scopes: ["messages:read"] },
);
