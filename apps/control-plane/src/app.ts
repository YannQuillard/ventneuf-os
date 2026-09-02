import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import type { NextFunction, Request, Response } from "express";
import { bearerToken, type TokenVerifier } from "./authentication.js";
import type { HermesClient } from "./hermes.js";
import { createRemoteMcpServer } from "./mcp.js";

export interface AppServices {
  verifier: TokenVerifier;
  hermes: HermesClient;
  host?: string;
}

export function createApp({ verifier, hermes, host = "127.0.0.1" }: AppServices) {
  const app = createMcpExpressApp({ host });

  app.get("/health", (_request, response) => {
    response.json({ service: "ventneuf-os-control-plane", status: "ok" });
  });

  app.post("/mcp", async (request: Request, response: Response, next: NextFunction) => {
    try {
      const token = bearerToken(request);
      const context = token ? await verifier.verify(token) : undefined;
      if (!context) {
        response.setHeader("WWW-Authenticate", "Bearer");
        response.status(401).json({ error: "unauthorized" });
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
