import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  assertAuthorized,
  publicIdentity,
  type AuthorizationContext,
} from "@ventneuf/domain";
import type { ConversationRuntime } from "./runtime.js";
import { submitPrivateMessage } from "./conversations.js";
import { dispatchRunnerMission } from "./missions.js";
import type { MissionDelegationVerifier } from "./mission-delegation.js";
import { decideApprovalAsService } from "./approvals.js";

const repositoryId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/);

function jsonResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value as Record<string, unknown>,
  };
}

export interface RemoteMcpServices {
  conversations?: Pick<ConversationRuntime, "repository" | "queue">
    & Partial<Pick<ConversationRuntime, "approvals">>;
  delegations?: MissionDelegationVerifier;
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

  server.registerTool(
    "mission.dispatch",
    {
      title: "Dispatch a runner mission",
      description: "Queue a repository task within an explicitly advertised runner capability. Codex development missions may edit the isolated worktree and request policy-bound approvals. User calls are ownership-scoped directly; Hermes service calls require the current parent-mission delegation and a stable request ID.",
      inputSchema: {
        objective: z.string().trim().min(1).max(4_000),
        deviceId: z.string().uuid(),
        repositoryId,
        adapter: z.enum(["repository-check", "orca-review", "codex-development", "claude-development"]).default("orca-review"),
        delegationToken: z.string().min(1).max(20_000).optional(),
        requestId: z.string().uuid().optional(),
      },
    },
    async (input) => {
      if (!services.conversations) throw new Error("The conversation runtime is unavailable.");
      return jsonResult(await dispatchRunnerMission(
        context,
        services.conversations,
        input,
        services.delegations,
      ));
    },
  );

  server.registerTool(
    "approval.decide",
    {
      title: "Decide a delegated approval request",
      description: "Approve, reject, or escalate one exact coding-agent operation. A parent-scoped delegation and stable request ID are required.",
      inputSchema: {
        approvalId: z.string().uuid(),
        delegationToken: z.string().min(1).max(20_000),
        requestId: z.string().uuid(),
        decision: z.enum(["approved", "rejected", "escalated"]),
        rationale: z.string().trim().min(1).max(2_000),
      },
    },
    async (input) => {
      if (!services.conversations?.approvals) throw new Error("The approval runtime is unavailable.");
      return jsonResult(await decideApprovalAsService(
        context,
        { approvals: services.conversations.approvals },
        input,
        services.delegations,
      ));
    },
  );

  return server;
}
