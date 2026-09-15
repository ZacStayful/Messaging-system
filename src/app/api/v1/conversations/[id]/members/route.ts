import { withApiKey } from "@/lib/api/withApiKey";
import { ok } from "@/lib/api/respond";
import { addMembers, listMembers } from "@/lib/api/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApiKey(async ({ db, params }) => ok(await listMembers(db, params.id)), {
  scopes: ["conversations:read"],
});

export const POST = withApiKey(
  async ({ request, db, params }) => {
    const body = (await request.json()) as { user_ids: string[] };
    return ok(await addMembers(db, params.id, body.user_ids ?? []));
  },
  { scopes: ["members:write"], team: true },
);
