import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import { assertAuthorized, type AuthorizationContext } from "@ventneuf/domain";
import { WorkspaceAccessError } from "@ventneuf/database";
import type { ConversationRuntime } from "./runtime.js";
import { submitPrivateMessage } from "./conversations.js";

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

type Authenticate = (request: Request, response: Response) => Promise<AuthorizationContext | undefined>;

export function registerWorkspaceRoutes(app: Express, authenticate: Authenticate, runtime?: ConversationRuntime) {
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
    const [projects, conversations, members] = await Promise.all([
      services.workspace!.listProjects(query), services.workspace!.listConversations(query),
      services.workspace!.listMembers(query),
    ]);
    response.json({ projects, conversations, members, currentMember });
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
    const input = z.object({ content: z.string().trim().min(1).max(100_000) }).strict().parse(request.body);
    response.status(202).json(await submitPrivateMessage(context, services, {
      ...input, conversationId: id.parse(request.params.conversationId),
    }));
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
