import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  assertAuthorized,
  reasoningEfforts,
  publicIdentity,
  type AuthorizationContext,
} from "@ventneuf/domain";
import type { ConversationRuntime } from "./runtime.js";
import { submitPrivateMessage } from "./conversations.js";
import { dispatchRunnerMission } from "./missions.js";
import { readStoredDispatchDelegation, type MissionDelegationVerifier } from "./mission-delegation.js";
import { decideApprovalAsService } from "./approvals.js";

const repositoryId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/);
const questionSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  label: z.string().trim().min(1).max(300),
  mode: z.enum(["single", "multiple", "text"]),
  options: z.array(z.object({ value: z.string().trim().min(1).max(300).refine(value => value !== "__custom__"),
    label: z.string().trim().min(1).max(300) }).strict()).max(8).default([]),
  defaultValues: z.array(z.string().trim().min(1).max(2_000)).max(8).default([]),
}).strict().superRefine((question, context) => {
  if ((question.mode !== "text" && question.options.length < 2)
    || (question.mode !== "multiple" && question.defaultValues.length > 1)
    || new Set(question.options.map(option => option.value)).size !== question.options.length) {
    context.addIssue({ code: "custom", message: "Provide distinct choices and defaults appropriate to the question type." });
  }
});

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
    "conversation.ask_questions",
    {
      title: "Ask with an interactive form",
      description: "Present one to four questions directly in the conversation as a prefilled form with selectable answers. Use for missing mission requirements and lead/sub-agent model choices. Reuse confirmed choices as defaults; derive model options from the advertised targets. The initiating member submits once to resume Hermes with fresh authority. Do not dispatch until the answers arrive.",
      inputSchema: {
        delegationId: z.string().uuid(), requestId: z.string().uuid(),
        title: z.string().trim().min(1).max(200),
        questions: z.array(questionSchema).min(1).max(4).refine(questions => new Set(questions.map(question => question.id)).size === questions.length),
      },
    },
    async ({ delegationId, requestId, title, questions }) => {
      assertAuthorized(context, "mission:dispatch");
      if (context.principalType !== "service" || !services.conversations || !services.delegations) {
        throw new Error("A current Hermes conversation delegation is required.");
      }
      const claims = readStoredDispatchDelegation(await services.conversations.repository.getMissionDispatchDelegation({
        organizationId: context.organizationId, serviceId: context.principalId, delegationId,
      }));
      if (claims.organizationId !== context.organizationId || claims.serviceId !== context.principalId || claims.delegationId !== delegationId) {
        throw new Error("The conversation form is outside the current authority.");
      }
      return jsonResult({ ...await services.conversations.repository.createConversationQuestionnaire({
        organizationId: claims.organizationId, parentMissionId: claims.parentMissionId, conversationId: claims.conversationId,
        memberId: claims.memberId, expiresAt: new Date(claims.expiresAt), requestId, questionnaire: { title, questions },
      }), status: "awaiting_answers", instruction: "The form is visible in the chat. End this reply briefly and wait for the member's answers. Do not repeat the questions as prose or dispatch yet." });
    },
  );

  server.registerTool(
    "mission.dispatch",
    {
      title: "Dispatch a runner mission",
      description: "Queue a repository task within an explicitly advertised runner capability. Native harness models and sub-agent models must be advertised by the target. Development missions may edit the isolated worktree and request policy-bound approvals. User calls are ownership-scoped directly; Hermes service calls require the current parent-mission delegation and a stable request ID.",
      inputSchema: {
        objective: z.string().trim().min(1).max(4_000),
        deviceId: z.string().uuid(),
        repositoryId,
        projectId: z.string().uuid().optional().describe("Pass the projectId advertised by the selected target. New workspace missions belong to this project."),
        adapter: z.enum(["repository-check", "orca-review", "codex-development", "claude-development"]).default("orca-review"),
        model: z.string().trim().min(1).max(100).optional().describe("Lead model selected from the target's advertised models."),
        reasoningEffort: z.enum(reasoningEfforts).optional().describe("Native reasoning effort for Codex or Claude development missions."),
        subagents: z.object({ models: z.array(z.string().trim().min(1).max(100)).min(1).max(8),
          reasoningEffort: z.enum(reasoningEfforts) }).strict().optional()
          .describe("Native sub-agent models and reasoning requested by the member."),
        delegationId: z.string().uuid().optional().describe("Use the Delegation ID supplied in the current turn. Ventneuf resolves its authority server-side."),
        delegationToken: z.string().min(1).max(20_000).optional().describe("Legacy signed token. Prefer delegationId; never reconstruct a token."),
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
