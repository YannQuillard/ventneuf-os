import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  assertAuthorized,
  publicIdentity,
  type AuthorizationContext,
} from "@ventneuf/domain";
import type { ConversationRuntime } from "./runtime.js";
import { submitPrivateMessage } from "./conversations.js";

function jsonResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value as Record<string, unknown>,
  };
}

export interface RemoteMcpServices {
  conversations?: Pick<ConversationRuntime, "repository" | "queue">;
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
      description: "Queue a message in your private Hermes conversation. Returns missionId and conversationId; the reply is persisted asynchronously. contextId, if supplied, must match your existing Hermes context.",
      inputSchema: {
        message: z.string().min(1).max(100_000),
        contextId: z.string().min(1).optional(),
      },
    },
    async ({ message, contextId }) => {
      assertAuthorized(context, "hermes:ask");
      if (!services.conversations) throw new Error("The conversation runtime is unavailable.");
      return jsonResult(await submitPrivateMessage(context, services.conversations, { content: message, contextId }));
    },
  );

  return server;
}
