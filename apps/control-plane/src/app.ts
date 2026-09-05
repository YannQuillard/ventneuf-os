import { submitPrivateMessage } from "./conversations.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { bearerToken, type TokenVerifier } from "./authentication.js";
import type { HermesClient } from "./hermes.js";
import { createRemoteMcpServer } from "./mcp.js";
import type { ConversationRuntime } from "./runtime.js";
import { assertAuthorized } from "@ventneuf/domain";
import {
  MissionApprovalConflictError,
  MissionApprovalPolicyError,
  MissionApprovalUnavailableError,
} from "@ventneuf/database";
import { z } from "zod";
import { registerRunnerRoutes } from "./runner-routes.js";
import type { MissionDelegationVerifier } from "./mission-delegation.js";
import {
  createDeviceCredential,
  createEnrollmentToken,
  hashDeviceToken,
  parseDeviceCredential,
  parseEnrollmentToken,
} from "./device-auth.js";

export interface AppServices {
  verifier: TokenVerifier;
  hermes: HermesClient;
  conversations?: ConversationRuntime;
  delegations?: MissionDelegationVerifier;
  host?: string;
}

export function createApp({ verifier, hermes, conversations, delegations, host = "127.0.0.1" }: AppServices) {
  const app = createMcpExpressApp({ host });

  registerRunnerRoutes(app, verifier, conversations);

  app.get("/health", (_request, response) => {
    response.json({ service: "ventneuf-os-control-plane", status: "ok" });
  });

  app.post("/api/devices/enrollments", async (request: Request, response: Response, next: NextFunction) => {
    try {
      const context = await authenticate(request, response);
      if (!context) return;
      assertAuthorized(context, "device:manage");
      if (!conversations) return void response.status(503).json({ error: "conversation_runtime_unavailable" });

      const expiresAt = new Date(Date.now() + 10 * 60_000);
      const enrollment = createEnrollmentToken(context.organizationId);
      await conversations.devices.createEnrollment({
        organizationId: context.organizationId,
        externalSubject: context.principalId,
        tokenHash: enrollment.tokenHash,
        expiresAt,
      });
      response.setHeader("cache-control", "no-store");
      response.status(201).json({ token: enrollment.token, expiresAt: expiresAt.toISOString() });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/devices", async (request: Request, response: Response, next: NextFunction) => {
    try {
      const context = await authenticate(request, response);
      if (!context) return;
      assertAuthorized(context, "device:manage");
      if (!conversations) return void response.status(503).json({ error: "conversation_runtime_unavailable" });
      const items = await conversations.devices.listForMember({
        organizationId: context.organizationId,
        externalSubject: context.principalId,
      });
      response.json({ devices: items });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/runner/enroll", async (request: Request, response: Response, next: NextFunction) => {
    try {
      if (!conversations) return void response.status(503).json({ error: "conversation_runtime_unavailable" });
      const parsedBody = z.object({
        token: z.string().min(1).max(256),
        name: z.string().trim().min(1).max(100).regex(/^[^\u0000-\u001f\u007f]+$/),
        platform: z.enum(["darwin", "linux", "win32"]),
      }).safeParse(request.body);
      if (!parsedBody.success) return void response.status(400).json({ error: "invalid_request" });
      const enrollmentScope = parseEnrollmentToken(parsedBody.data.token);
      if (!enrollmentScope) return void response.status(401).json({ error: "invalid_enrollment" });

      const deviceId = randomUUID();
      const credential = createDeviceCredential(enrollmentScope.organizationId, deviceId);
      const device = await conversations.devices.consumeEnrollment({
        organizationId: enrollmentScope.organizationId,
        tokenHash: hashDeviceToken(parsedBody.data.token),
        credentialHash: credential.tokenHash,
        deviceId,
        name: parsedBody.data.name,
        platform: parsedBody.data.platform,
        now: new Date(),
      });
      if (!device) return void response.status(401).json({ error: "invalid_enrollment" });

      response.setHeader("cache-control", "no-store");
      response.status(201).json({
        device: { id: device.id, name: device.name, platform: device.platform },
        credential: credential.token,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/runner/heartbeat", async (request: Request, response: Response, next: NextFunction) => {
    try {
      if (!conversations) return void response.status(503).json({ error: "conversation_runtime_unavailable" });
      const token = bearerToken(request);
      const scope = token ? parseDeviceCredential(token) : undefined;
      if (!token || !scope) {
        response.setHeader("WWW-Authenticate", "Bearer");
        return void response.status(401).json({ error: "unauthorized" });
      }

      const now = new Date();
      const device = await conversations.devices.heartbeat({
        organizationId: scope.organizationId,
        deviceId: scope.deviceId,
        credentialHash: hashDeviceToken(token),
        now,
      });
      if (!device) {
        response.setHeader("WWW-Authenticate", "Bearer");
        return void response.status(401).json({ error: "unauthorized" });
      }
      assertAuthorized({
        organizationId: scope.organizationId,
        principalId: device.id,
        principalType: "device",
        memberId: device.memberId,
        deviceId: device.id,
        projectIds: [],
        capabilities: ["device:heartbeat"],
        expiresAt: new Date(now.getTime() + 60_000).toISOString(),
      }, "device:heartbeat", now);
      response.json({ deviceId: device.id, status: "online", lastSeenAt: now.toISOString() });
    } catch (error) {
      next(error);
    }
  });

  async function authenticate(request: Request, response: Response) {
    const token = bearerToken(request);
    const context = token ? await verifier.verify(token) : undefined;
    if (!context) {
      response.setHeader("WWW-Authenticate", "Bearer");
      response.status(401).json({ error: "unauthorized" });
    }
    return context;
  }

  app.get("/api/conversations/hermes/messages", async (request: Request, response: Response, next: NextFunction) => {
    try {
      const context = await authenticate(request, response);
      if (!context) return;
      assertAuthorized(context, "hermes:ask");
      if (!conversations) return void response.status(503).json({ error: "conversation_runtime_unavailable" });
      const query = {
        organizationId: context.organizationId,
        externalSubject: context.principalId,
      };
      const [items, mission, approvals] = await Promise.all([
        conversations.repository.listPrivateMessages(query),
        conversations.repository.getLatestPrivateMission(query),
        conversations.approvals?.listForMember(query) ?? Promise.resolve([]),
      ]);
      const events = mission
        ? await conversations.repository.listMissionEvents(context.organizationId, mission.id)
        : [];
      const missionContext = mission?.context;
      response.json({
        messages: items,
        mission: mission ? {
          id: mission.id,
          status: mission.status,
          timing: missionContext && typeof missionContext.timing === "object"
            ? missionContext.timing
            : {},
          failure: typeof missionContext?.failure === "string" ? missionContext.failure : undefined,
        } : null,
        events,
        approvals,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/conversations/hermes/events", async (request: Request, response: Response, next: NextFunction) => {
    try {
      const context = await authenticate(request, response);
      if (!context) return;
      assertAuthorized(context, "hermes:ask");
      if (!conversations) return void response.status(503).json({ error: "conversation_runtime_unavailable" });
      response.setHeader("content-type", "text/event-stream");
      response.setHeader("cache-control", "no-cache, no-transform");
      response.setHeader("connection", "keep-alive");
      response.flushHeaders();
      let closed = false;
      response.on("close", () => { closed = true; });
      let previous = "";
      const deadline = Date.now() + 25_000;
      while (!closed && Date.now() < deadline) {
        const mission = await conversations.repository.getLatestPrivateMission({
          organizationId: context.organizationId,
          externalSubject: context.principalId,
        });
        const events = mission
          ? await conversations.repository.listMissionEvents(context.organizationId, mission.id)
          : [];
        const approvals = await conversations.approvals?.listForMember({
          organizationId: context.organizationId,
          externalSubject: context.principalId,
        }) ?? [];
        const missionContext = mission?.context;
        const snapshot = JSON.stringify({
          mission: mission ? {
            id: mission.id,
            status: mission.status,
            timing: missionContext && typeof missionContext.timing === "object"
              ? missionContext.timing
              : {},
            failure: typeof missionContext?.failure === "string" ? missionContext.failure : undefined,
          } : null,
          events,
          approvals,
        });
        if (snapshot !== previous) {
          response.write(`event: snapshot\ndata: ${snapshot}\n\n`);
          previous = snapshot;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (!closed) response.end();
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/conversations/hermes/messages", async (request: Request, response: Response, next: NextFunction) => {
    try {
      const context = await authenticate(request, response);
      if (!context) return;
      assertAuthorized(context, "hermes:ask");
      if (!conversations) return void response.status(503).json({ error: "conversation_runtime_unavailable" });
      const { content } = z.object({ content: z.string().trim().min(1).max(100_000) }).parse(request.body);
      response.status(202).json(await submitPrivateMessage(context, conversations, { content }));
    } catch (error) {
      if (error instanceof z.ZodError) {
        response.status(400).json({ error: "invalid_request" });
        return;
      }
      next(error);
    }
  });

  app.post("/api/conversations/hermes/approvals/:approvalId/decision", async (
    request: Request,
    response: Response,
    next: NextFunction,
  ) => {
    try {
      const context = await authenticate(request, response);
      if (!context) return;
      if (context.principalType !== "user") return void response.status(403).json({ error: "forbidden" });
      try { assertAuthorized(context, "approval:decide"); }
      catch { return void response.status(403).json({ error: "forbidden" }); }
      if (!conversations?.approvals) return void response.status(503).json({ error: "conversation_runtime_unavailable" });
      const approvalId = z.string().uuid().parse(request.params.approvalId);
      const input = z.object({
        requestId: z.string().uuid(),
        decision: z.enum(["approved", "rejected"]),
        rationale: z.string().trim().min(1).max(2_000),
      }).strict().parse(request.body);
      response.json(await conversations.approvals.decideByMember({
        organizationId: context.organizationId,
        externalSubject: context.principalId,
        approvalId,
        decisionRequestId: input.requestId,
        decision: input.decision,
        rationale: input.rationale,
      }));
    } catch (error) {
      if (error instanceof z.ZodError) return void response.status(400).json({ error: "invalid_request" });
      if (error instanceof MissionApprovalPolicyError) return void response.status(403).json({ error: "approval_forbidden" });
      if (error instanceof MissionApprovalConflictError) return void response.status(409).json({ error: "approval_conflict" });
      if (error instanceof MissionApprovalUnavailableError) return void response.status(404).json({ error: "approval_not_found" });
      next(error);
    }
  });

  app.post("/api/conversations/hermes/missions/:missionId/cancel", async (request: Request, response: Response, next: NextFunction) => {
    try {
      const context = await authenticate(request, response);
      if (!context) return;
      assertAuthorized(context, "hermes:ask");
      if (!conversations) return void response.status(503).json({ error: "conversation_runtime_unavailable" });

      const mission = await conversations.repository.getLatestPrivateMission({
        organizationId: context.organizationId,
        externalSubject: context.principalId,
      });
      if (!mission || mission.id !== request.params.missionId) {
        return void response.status(404).json({ error: "mission_not_found" });
      }
      if (!["queued", "running", "waiting_for_approval", "cancelled"].includes(mission.status)) {
        return void response.status(409).json({ error: "mission_not_cancellable" });
      }

      if (!mission.assignedDeviceId && !hermes.stop) {
        return void response.status(503).json({ error: "hermes_cancellation_unavailable" });
      }
      const cancelledAt = new Date().toISOString();
      const cancelled = mission.status === "cancelled"
        ? [{ id: mission.id, context: mission.context }]
        : await conversations.repository.cancelMission(
          context.organizationId, mission.id, { cancelledAt },
        );
      if (cancelled.length === 0) {
        return void response.status(409).json({ error: "mission_not_cancellable" });
      }
      // Use the context returned by the transition, not the earlier ownership read.
      const runId = cancelled[0]?.context?.hermesRunId;
      if (typeof runId === "string") await hermes.stop!(runId);
      response.json({ id: mission.id, status: "cancelled", cancelledAt });
    } catch (error) {
      next(error);
    }
  });

  app.post("/mcp", async (request: Request, response: Response, next: NextFunction) => {
    try {
      const context = await authenticate(request, response);
      if (!context) {
        return;
      }

      const server = createRemoteMcpServer(context, { conversations, delegations });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      response.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      next(error);
    }
  });

  app.get("/mcp", (_request, response) => {
    response.status(405).json({ error: "method_not_allowed" });
  });
  app.delete("/mcp", (_request, response) => {
    response.status(405).json({ error: "method_not_allowed" });
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    console.error(error);
    if (!response.headersSent) response.status(500).json({ error: "internal_error" });
  });

  return app;
}
