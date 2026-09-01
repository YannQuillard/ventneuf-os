import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  assertAuthorized,
  publicIdentity,
  type AuthorizationContext,
} from "@ventneuf/domain";
import type { HermesClient } from "./hermes.js";

function jsonResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value as Record<string, unknown>,
  };
}

export interface RemoteMcpServices {
  hermes: HermesClient;
}

export function createRemoteMcpServer(
  context: AuthorizationContext,
  services: RemoteMcpServices,
): McpServer {
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

  server.registerTool(
    "hermes.ask",
    {
      title: "Ask Hermes",
      description: "Send a scoped message to the authorized private Hermes profile.",
      inputSchema: {
        message: z.string().min(1).max(100_000),
        contextId: z.string().min(1).optional(),
      },
    },
    async ({ message, contextId }) => {
      assertAuthorized(context, "hermes:ask");
      return jsonResult(await services.hermes.ask({ message, contextId }));
    },
  );

  return server;
}
