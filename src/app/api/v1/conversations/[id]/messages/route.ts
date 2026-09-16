import { withApiKey } from "@/lib/api/withApiKey";
import { ok } from "@/lib/api/respond";
import { listMessages, sendMessage } from "@/lib/api/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApiKey(
  async ({ request, db, params }) => {
    const q = new URL(request.url).searchParams;
    return ok(
      await listMessages(db, params.id, {
        before: q.get("before") ?? undefined,
        limit: Number(q.get("limit")) || undefined,
      }),
    );
  },
  { scopes: ["messages:read"] },
);

export const POST = withApiKey(
  async ({ request, ctx, db, params }) => {
    const body = (await request.json()) as {
      body: string;
      parent_id?: string | null;
      visibility?: "public" | "internal";
      client_id?: string;
      external_ref?: string | null;
    };
    const message = await sendMessage(db, ctx, {
      conversationId: params.id,
      body: body.body,
      parentId: body.parent_id,
      visibility: body.visibility,
      clientId: body.client_id,
      externalRef: body.external_ref,
    });
    return ok(message, { status: 201 });
  },
  { scopes: ["messages:write"] },
);
