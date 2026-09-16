import { withApiKey } from "@/lib/api/withApiKey";
import { ok } from "@/lib/api/respond";
import { invitePerson, listPeople } from "@/lib/api/service";
import type { InviteRole } from "@/lib/api/invite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApiKey(
  async ({ request, db }) => {
    const q = new URL(request.url).searchParams;
    const accountType = q.get("account_type");
    return ok(
      await listPeople(db, {
        query: q.get("q") ?? undefined,
        accountType: accountType === "team" || accountType === "customer" ? accountType : undefined,
      }),
    );
  },
  { scopes: ["users:read"] },
);

export const POST = withApiKey(
  async ({ request, ctx, db }) => {
    const body = (await request.json()) as {
      email: string;
      full_name: string;
      display_name?: string;
      role?: InviteRole;
      conversation_ids?: string[];
    };
    const outcome = await invitePerson(db, ctx, {
      email: body.email,
      fullName: body.full_name,
      displayName: body.display_name,
      role: body.role,
      conversationIds: body.conversation_ids,
    });
    return ok(outcome, { status: 201 });
  },
  { scopes: ["users:invite"], team: true },
);
