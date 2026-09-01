import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  assertAuthorized,
  publicIdentity,
  type AuthorizationContext,
} from "@ventneuf/domain";

function jsonResult(value: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

export function createRemoteMcpServer(context: AuthorizationContext): McpServer {
  const server = new McpServer({ name: "ventneuf-os-remote", version: "0.1.0" });

  server.registerTool(
    "system.whoami",
    {
      title: "Inspect the active ventneuf.os identity",
      description: "Return the authenticated principal and its current scoped capabilities.",
      inputSchema: {},
    },
    async () => {
      assertAuthorized(context, "system:identity:read");
      return jsonResult(publicIdentity(context));
    },
  );

  return server;
}
