import { withApiKey } from "@/lib/api/withApiKey";
import { ok } from "@/lib/api/respond";
import { createGroup, listConversations, type CreateGroupInput } from "@/lib/api/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApiKey(
  async ({ request, db }) => {
    const includeArchived = new URL(request.url).searchParams.get("include_archived") === "true";
    return ok(await listConversations(db, { includeArchived }));
  },
  { scopes: ["conversations:read"] },
);

export const POST = withApiKey(
  async ({ request, db }) => ok(await createGroup(db, (await request.json()) as CreateGroupInput), { status: 201 }),
  { scopes: ["conversations:write"], team: true },
);
