import { describe, expect, it } from "vitest";
import { registerTools } from "@/lib/mcp/tools";

/**
 * The registry is registered against a stand-in server, which catches the mistakes that
 * actually happen here: a duplicate or badly named tool, a missing schema, a write tool that
 * does not warn the model it is acting in a live workspace, or a tool that fails open when no
 * key is present. (Scope names need no test — actor()'s Scope[] parameter makes an invalid one
 * a compile error.)
 */
interface Registered {
  name: string;
  config: { title?: string; description?: string; inputSchema?: unknown };
  handler: (args: unknown, ctx: unknown) => Promise<{ isError?: boolean }>;
}

function collect(): Registered[] {
  const tools: Registered[] = [];
  const fake = {
    registerTool(name: string, config: Registered["config"], handler: Registered["handler"]) {
      tools.push({ name, config, handler });
      return {};
    },
  };
  registerTools(fake as unknown as Parameters<typeof registerTools>[0]);
  return tools;
}

const tools = collect();
const names = tools.map((t) => t.name);

const WRITE_TOOLS = [
  "send_message",
  "create_group",
  "open_dm",
  "add_members",
  "remove_member",
  "invite_member",
  "add_bookmark",
  "remove_bookmark",
  "set_my_status",
];

const READ_TOOLS = [
  "list_conversations",
  "get_conversation",
  "list_messages",
  "list_thread_replies",
  "search_messages",
  "list_people",
  "list_bookmarks",
];

describe("the MCP tool registry", () => {
  it("registers every tool the README documents", () => {
    expect(names).toEqual(expect.arrayContaining([...READ_TOOLS, ...WRITE_TOOLS, "whoami"]));
  });

  it("registers no tool twice", () => {
    expect(new Set(names).size).toBe(names.length);
  });

  it("names every tool in snake_case, which is what MCP clients expect", () => {
    for (const name of names) expect(name, name).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it("gives every tool a title, a description and a schema", () => {
    for (const t of tools) {
      expect(t.config.title, t.name).toBeTruthy();
      expect(t.config.description, t.name).toBeTruthy();
      expect(t.config.inputSchema, t.name).toBeTruthy();
      expect(typeof t.handler, t.name).toBe("function");
    }
  });

  it("warns on every write tool that it acts as a real person in a live workspace", () => {
    for (const name of WRITE_TOOLS) {
      const t = tools.find((x) => x.name === name);
      expect(t, name).toBeTruthy();
      expect(t!.config.description, name).toMatch(/visible to real people/);
    }
  });

  it("leaves that warning off the read-only tools, where it would only be noise", () => {
    for (const name of READ_TOOLS) {
      const t = tools.find((x) => x.name === name);
      expect(t!.config.description, name).not.toMatch(/visible to real people/);
    }
  });

  it("refuses without a key rather than falling through to an unauthenticated call", async () => {
    // No http.authInfo at all: what a request would look like if the auth wrapper were ever
    // removed or misconfigured. Every tool must fail closed, not act as nobody.
    for (const t of tools) {
      const result = await t.handler({}, {});
      expect(result.isError, t.name).toBe(true);
    }
  });
});
