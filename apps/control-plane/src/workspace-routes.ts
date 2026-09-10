import type { HermesClient } from "./hermes.js";
import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import { assertAuthorized, reasoningEfforts, type AuthorizationContext } from "@ventneuf/domain";
import { WorkspaceAccessError } from "@ventneuf/database";
import type { ConversationRuntime } from "./runtime.js";
import { questionnaireReplySchema, submitPrivateMessage } from "./conversations.js";

const id = z.string().uuid();
const repository = z.object({ deviceId: id, repositoryId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/) }).strict();
const projectInput = z.object({
  name: z.string().trim().min(1).max(100),
  context: z.record(z.string(), z.unknown()).refine(value => Buffer.byteLength(JSON.stringify(value)) <= 20_000).optional(),
  repositoryAssociations: z.array(repository).max(50).optional(),
}).strict();
const conversationInput = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  kind: z.enum(["private", "topic", "mission"]).default("private"),
  projectId: id.optional(),
  parentConversationId: id.optional(),
}).strict();
const executionInput = z.object({
  harness: z.object({ provider: z.enum(["codex", "claude"]), model: z.string().trim().min(1).max(100).optional(),
    reasoningEffort: z.enum(reasoningEfforts) }).strict().superRefine((harness, context) => {
      if (harness.provider === "claude" && !harness.model) context.addIssue({ code: "custom", message: "Claude Code requires a lead model." });
    }),
  subagents: z.object({ models: z.array(z.string().trim().min(1).max(100)).min(1).max(8),
    reasoningEffort: z.enum(reasoningEfforts) }).strict(),
}).strict();

type Authenticate = (request: Request, response: Response) => Promise<AuthorizationContext | undefined>;

export function registerWorkspaceRoutes(app: Express, authenticate: Authenticate, runtime?: ConversationRuntime, hermes?: HermesClient) {
  const route = (handler: (request: Request, response: Response, context: AuthorizationContext, services: ConversationRuntime) => Promise<unknown>) =>
    async (request: Request, response: Response, next: NextFunction) => {
      try {
        const context = await authenticate(request, response);
        if (!context) return;
        if (context.principalType !== "user") return void response.status(403).json({ error: "forbidden" });
        try { assertAuthorized(context, "hermes:ask"); }
        catch { return void response.status(403).json({ error: "forbidden" }); }
        if (!runtime?.workspace) return void response.status(503).json({ error: "workspace_unavailable" });
        response.setHeader("Cache-Control", "no-store");
        await handler(request, response, context, runtime);
      } catch (error) {
        if (error instanceof z.ZodError) return void response.status(400).json({ error: "invalid_request" });
        if (error instanceof WorkspaceAccessError) return void response.status(404).json({ error: "resource_unavailable" });
        next(error);
      }
    };
  const scope = (context: AuthorizationContext) => ({ organizationId: context.organizationId, externalSubject: context.principalId });

  app.get("/api/workspace", route(async (_request, response, context, services) => {
    const query = scope(context);
    const currentMember = await services.workspace!.getCurrentMember(query);
    const [projects, conversations, members, notifications] = await Promise.all([
      services.workspace!.listProjects(query), services.workspace!.listConversations(query),
      services.workspace!.listMembers(query), services.workspace!.listNotifications(query),
    ]);
    response.json({ projects, conversations, members, notifications, currentMember });
  }));
  app.get("/api/workspace/memory", route(async (request, response, context, services) => {
    if (!services.memory?.listMemory) return void response.status(503).json({ error: "memory_unavailable" });
    const conversationId = request.query.conversationId === undefined ? undefined : id.parse(request.query.conversationId);
    const memoryScope = await services.workspace!.getMemoryScope(scope(context), conversationId);
    response.json(await services.memory.listMemory(memoryScope.scopeId));
  }));
  app.get("/api/workspace/memory/:entryId", route(async (request, response, context, services) => {
    if (!services.memory?.readMemory) return void response.status(503).json({ error: "memory_unavailable" });
    const conversationId = request.query.conversationId === undefined ? undefined : id.parse(request.query.conversationId);
    const entryId = z.string().min(1).max(2048).parse(request.params.entryId);
    const memoryScope = await services.workspace!.getMemoryScope(scope(context), conversationId);
    response.json(await services.memory.readMemory(memoryScope.scopeId, entryId));
  }));
  app.patch("/api/workspace/me", route(async (request, response, context, services) => {
    const { name } = z.object({ name: z.string().trim().min(1).max(100) }).strict().parse(request.body);
    response.json({ currentMember: await services.workspace!.updateCurrentMember(scope(context), name) });
  }));
  app.get("/api/workspace/members", route(async (_request, response, context, services) => {
    response.json({ members: await services.workspace!.listMembers(scope(context)) });
  }));
  app.get("/api/workspace/projects", route(async (_request, response, context, services) => {
    response.json({ projects: await services.workspace!.listProjects(scope(context)) });
  }));
  app.post("/api/workspace/projects", route(async (request, response, context, services) => {
    response.status(201).json({ project: await services.workspace!.createProject(scope(context), projectInput.parse(request.body)) });
  }));
  app.get("/api/workspace/projects/:projectId", route(async (request, response, context, services) => {
    response.json({ project: await services.workspace!.getProject(scope(context), id.parse(request.params.projectId)) });
  }));
  app.patch("/api/workspace/projects/:projectId", route(async (request, response, context, services) => {
    response.json({ project: await services.workspace!.updateProject(scope(context), id.parse(request.params.projectId), projectInput.partial().parse(request.body)) });
  }));
  app.get("/api/workspace/conversations", route(async (request, response, context, services) => {
    const projectId = request.query.projectId === undefined ? undefined : id.parse(request.query.projectId);
    response.json({ conversations: await services.workspace!.listConversations(scope(context), { projectId }) });
  }));
  app.post("/api/workspace/conversations", route(async (request, response, context, services) => {
    response.status(201).json({ conversation: await services.workspace!.createConversation(scope(context), conversationInput.parse(request.body)) });
  }));
  app.get("/api/workspace/conversations/:conversationId", route(async (request, response, context, services) => {
    response.json({ conversation: await services.workspace!.getConversation(scope(context), id.parse(request.params.conversationId)) });
  }));
  app.delete("/api/workspace/conversations/:conversationId", route(async (request, response, context, services) => {
    const deleted = await services.workspace!.deleteMissionConversation(scope(context), id.parse(request.params.conversationId));
    for (const run of deleted.hermesRuns) {
      await hermes?.stop?.(run.runId, run.scopeId).catch(() => {
        console.warn("Deleted mission Hermes stop failed; cancellation remains authoritative.");
      });
    }
    response.json({ id: deleted.id, deleted: true });
  }));
  app.patch("/api/workspace/conversations/:conversationId", route(async (request, response, context, services) => {
    const input = z.object({ title: z.string().trim().min(1).max(200) }).strict().parse(request.body);
    response.json({ conversation: await services.workspace!.updateConversation(scope(context), id.parse(request.params.conversationId), input) });
  }));
  for (const resource of ["projects", "conversations"] as const) {
    const path = `/api/workspace/${resource}/:resourceId/members/:memberId`;
    app.put(path, route(async (request, response, context, services) => {
      const resourceId = id.parse(request.params.resourceId);
      const memberId = id.parse(request.params.memberId);
      const result = resource === "projects"
        ? await services.workspace!.shareProject(scope(context), resourceId, memberId)
        : await services.workspace!.shareConversation(scope(context), resourceId, memberId);
      response.json({ [resource === "projects" ? "project" : "conversation"]: result });
    }));
    app.delete(path, route(async (request, response, context, services) => {
      const resourceId = id.parse(request.params.resourceId);
      const memberId = id.parse(request.params.memberId);
      const result = resource === "projects"
        ? await services.workspace!.revokeProjectMember(scope(context), resourceId, memberId)
        : await services.workspace!.revokeConversationMember(scope(context), resourceId, memberId);
      response.json({ [resource === "projects" ? "project" : "conversation"]: result });
    }));
  }
  app.get("/api/workspace/conversations/:conversationId/messages", route(async (request, response, context, services) => {
    response.json(await services.repository.getConversationSnapshot({ ...scope(context), conversationId: id.parse(request.params.conversationId) }));
  }));
  app.post("/api/workspace/conversations/:conversationId/messages", route(async (request, response, context, services) => {
    const input = z.object({ content: z.string().trim().min(1).max(100_000), delivery: z.enum(["hermes", "project_chat"]).default("hermes"),
      questionnaireReply: questionnaireReplySchema.optional(),
      execution: executionInput.optional() }).strict().parse(request.body);
    const conversationId = id.parse(request.params.conversationId);
    if (input.delivery === "project_chat" && !input.questionnaireReply) {
      if (!/(^|\s)@hermes(?=\s|[.,!?;:]|$)/iu.test(input.content)) {
        return void response.status(201).json({ message: await services.workspace!.appendProjectMessage(scope(context), conversationId, input.content) });
      }
      const conversation = await services.workspace!.getConversation(scope(context), conversationId);
      if (!conversation.isProjectGeneral) throw new WorkspaceAccessError("Project chat not found or access denied.");
    }
    response.status(202).json(await submitPrivateMessage(context, services, {
      content: input.content, conversationId, execution: input.execution, questionnaireReply: input.questionnaireReply,
    }));
  }));
  app.post("/api/workspace/notifications/:notificationId/read", route(async (request, response, context, services) => {
    response.json({ notification: await services.workspace!.markNotificationRead(scope(context), id.parse(request.params.notificationId)) });
  }));
  app.post("/api/workspace/conversations/:conversationId/missions/:missionId/cancel", route(async (request, response, context, services) => {
    const mission = await services.repository.getOwnedConversationMission({ ...scope(context),
      conversationId: id.parse(request.params.conversationId), missionId: id.parse(request.params.missionId) });
    if (!["queued", "running", "waiting_for_approval", "cancelled"].includes(mission.status)) {
      return void response.status(409).json({ error: "mission_not_cancellable" });
    }
    const cancelledAt = new Date().toISOString();
    const cancelled = mission.status === "cancelled" ? [{ context: mission.context }]
      : await services.repository.cancelMission(context.organizationId, mission.id, { cancelledAt });
    if (!cancelled.length) return void response.status(409).json({ error: "mission_not_cancellable" });
    const state = cancelled[0]!.context;
    if (!mission.assignedDeviceId && typeof state.hermesRunId === "string") {
      if (!hermes?.stop) return void response.status(503).json({ error: "hermes_cancellation_unavailable" });
      await hermes.stop(state.hermesRunId, typeof state.hermesScopeId === "string" ? state.hermesScopeId : undefined);
    }
    response.json({ id: mission.id, status: "cancelled", cancelledAt });
  }));
  app.get("/api/workspace/conversations/:conversationId/events", route(async (request, response, context, services) => {
    const query = { ...scope(context), conversationId: id.parse(request.params.conversationId) };
    let snapshot = await services.repository.getConversationSnapshot(query);
    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + 55_000;
    response.on("close", () => { stopped = true; if (timer) clearTimeout(timer); });
    const send = async () => {
      if (stopped) return;
      try {
        assertAuthorized(context, "hermes:ask");
        response.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
        if (Date.now() >= deadline) { response.end(); return; }
        timer = setTimeout(async () => {
          try {
            snapshot = await services.repository.getConversationSnapshot(query);
            await send();
          } catch {
            if (!stopped) { response.write("event: access_revoked\ndata: {}\n\n"); response.end(); }
          }
        }, 1_500);
      } catch { response.end(); }
    };
    await send();
  }));
}
