import { withApiKey } from "@/lib/api/withApiKey";
import { ok } from "@/lib/api/respond";
import { getConversation, setConversationDetails } from "@/lib/api/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApiKey(async ({ db, params }) => ok(await getConversation(db, params.id)), {
  scopes: ["conversations:read"],
});

export const PATCH = withApiKey(
  async ({ request, db, params }) => {
    const body = (await request.json()) as {
      name?: string;
      topic?: string | null;
      description?: string | null;
      archived?: boolean;
    };
    return ok(await setConversationDetails(db, params.id, body));
  },
  { scopes: ["conversations:write"], team: true },
);
