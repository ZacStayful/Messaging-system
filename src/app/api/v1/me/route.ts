import { withApiKey } from "@/lib/api/withApiKey";
import { ok } from "@/lib/api/respond";
import { me } from "@/lib/api/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Who this key acts as, and what it may do. The cheapest way to check a key works. */
export const GET = withApiKey(async ({ ctx }) => ok(me(ctx)), { scopes: [] });
