import { withApiKey } from "@/lib/api/withApiKey";
import { ok } from "@/lib/api/respond";
import { removeMember } from "@/lib/api/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const DELETE = withApiKey(async ({ db, params }) => ok(await removeMember(db, params.id, params.userId)), {
  scopes: ["members:write"],
  team: true,
});
