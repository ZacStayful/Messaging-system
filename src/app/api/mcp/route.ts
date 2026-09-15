import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyApiKey } from "@/lib/api/auth";
import { jwtConfigured } from "@/lib/api/jwt";
import { registerTools, type McpAuthExtra } from "@/lib/mcp/tools";

// The SDK uses Node crypto and stream APIs, so this cannot run on the edge runtime.
export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const RATE_LIMIT = 600;
const RATE_WINDOW_SECONDS = 60;

/**
 * Remote MCP server over Streamable HTTP, so Claude, n8n, Zapier or anything else speaking MCP
 * can drive the workspace with nothing to install.
 *
 * Authenticated with the same API keys as the REST API, through the same verifyApiKey helper,
 * so the two surfaces cannot end up authenticating differently. Every tool acts as the key's
 * Stayful team member and is bounded by that person's own access — an agent cannot see or do
 * anything they could not.
 *
 * Stateless: Vercel keeps nothing between requests, so there is no session to resume.
 * maxSubscriptions: 0 rejects `subscriptions/listen` outright rather than opening an SSE
 * stream a serverless function cannot hold open. That rules out server-initiated
 * notifications, resource subscriptions and streaming progress — every tool here is plain
 * request/response, which is all they need. (The app's own live updates ride Supabase
 * Realtime; MCP clients poll.)
 */
const handler = createMcpHandler(
  (server) => {
    registerTools(server);
  },
  {
    serverInfo: { name: "stayful-messaging", version: "1.0.0" },
    maxSubscriptions: 0,
  },
);

const authed = withMcpAuth(
  handler,
  async (request, bearerToken) => {
    // Distinguishable from a bad key: without the secret nothing can act as a user at all, and
    // a 401 would send whoever is holding a perfectly good key hunting for the wrong problem.
    if (!jwtConfigured()) {
      console.error("[mcp] SUPABASE_JWT_SECRET is not set; the MCP server cannot act as a user");
      return undefined;
    }

    const ctx = await verifyApiKey(request);
    if (!ctx) return undefined;

    const admin = createAdminClient();
    if (admin) {
      const { data: withinLimit } = await admin.rpc("api_rate_hit", {
        p_key_id: ctx.keyId,
        p_limit: RATE_LIMIT,
        p_window_seconds: RATE_WINDOW_SECONDS,
      });
      if (withinLimit === false) return undefined;
      void admin.rpc("api_touch_key", { p_key_id: ctx.keyId });
    }

    const extra: McpAuthExtra = { ctx };
    return {
      token: bearerToken ?? "",
      clientId: ctx.keyId,
      scopes: ctx.scopes,
      extra: extra as unknown as Record<string, unknown>,
    };
  },
  { required: true },
);

export { authed as GET, authed as POST, authed as DELETE };
