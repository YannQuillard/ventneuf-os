import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import type { NextFunction, Request, Response } from "express";
import { bearerToken, type TokenVerifier } from "./authentication.js";
import type { HermesClient } from "./hermes.js";
import { createRemoteMcpServer } from "./mcp.js";
import type { ConversationRuntime } from "./runtime.js";
import { assertAuthorized } from "@ventneuf/domain";
import { z } from "zod";

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
      const items = await conversations.repository.listPrivateMessages({
        organizationId: context.organizationId,
        externalSubject: context.principalId,
      });
      response.json({ messages: items });
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
      await conversations.queue.publish(
        { organizationId: context.organizationId, missionId: queued.mission.id },
        queued.conversationId,
      );
      response.status(202).json({
        conversationId: queued.conversationId,
        message: queued.message,
        missionId: queued.mission.id,
        status: queued.mission.status,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        response.status(400).json({ error: "invalid_request" });
        return;
      }
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
