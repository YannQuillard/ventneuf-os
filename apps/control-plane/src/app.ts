import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { bearerToken, type TokenVerifier } from "./authentication.js";
import type { HermesClient } from "./hermes.js";
import { createRemoteMcpServer } from "./mcp.js";
import type { ConversationRuntime } from "./runtime.js";
import { assertAuthorized } from "@ventneuf/domain";
import { z } from "zod";
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
  host?: string;
}

export function createApp({ verifier, hermes, conversations, host = "127.0.0.1" }: AppServices) {
  const app = createMcpExpressApp({ host });

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
      const [items, mission] = await Promise.all([
        conversations.repository.listPrivateMessages(query),
        conversations.repository.getLatestPrivateMission(query),
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
      const queued = await conversations.repository.enqueuePrivateMessage({
        organizationId: context.organizationId,
        externalSubject: context.principalId,
        content,
      });
      const queuedAt = new Date();
      const missionContext = queued.mission.context ?? {};
      const queuedContext = {
        ...missionContext,
        timing: {
          ...(missionContext.timing && typeof missionContext.timing === "object"
            ? missionContext.timing as Record<string, unknown>
            : {}),
          queuedAt: queuedAt.toISOString(),
        },
      };
      await conversations.repository.setMissionQueued(
        context.organizationId,
        queued.mission.id,
        queuedContext,
      );
      try {
        await conversations.queue.publish(
          { organizationId: context.organizationId, missionId: queued.mission.id },
          queued.conversationId,
        );
      } catch (error) {
        const failedAt = new Date();
        await conversations.repository.failMission(
          context.organizationId,
          queued.mission.id,
          "Mission dispatch failed.",
          {
            ...queuedContext,
            timing: {
              ...queuedContext.timing,
              failedAt: failedAt.toISOString(),
              totalMs: queued.message.createdAt instanceof Date
                ? failedAt.getTime() - queued.message.createdAt.getTime()
                : undefined,
            },
          },
        );
        throw error;
      }
      console.info(JSON.stringify({
        component: "conversation-api",
        event: "mission.queued",
        organizationId: context.organizationId,
        missionId: queued.mission.id,
        conversationId: queued.conversationId,
        acceptedToQueueMs: queued.message.createdAt instanceof Date
          ? queuedAt.getTime() - queued.message.createdAt.getTime()
          : undefined,
      }));
      response.status(202).json({
        conversationId: queued.conversationId,
        message: queued.message,
        missionId: queued.mission.id,
        status: queued.mission.status,
        timing: queuedContext.timing,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        response.status(400).json({ error: "invalid_request" });
        return;
      }
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
      if (!["queued", "running", "waiting_for_approval"].includes(mission.status)) {
        return void response.status(409).json({ error: "mission_not_cancellable" });
      }

      const hermesRunId = typeof mission.context?.hermesRunId === "string"
        ? mission.context.hermesRunId
        : undefined;
      if (hermesRunId) {
        if (!hermes.stop) return void response.status(503).json({ error: "hermes_cancellation_unavailable" });
        await hermes.stop(hermesRunId);
      }
      const cancelledAt = new Date().toISOString();
      const cancelled = await conversations.repository.cancelMission(
        context.organizationId,
        mission.id,
        { ...mission.context, cancelledAt },
      );
      if (cancelled.length === 0) {
        return void response.status(409).json({ error: "mission_not_cancellable" });
      }
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

      const server = createRemoteMcpServer(context, { hermes });
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
