import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { CredentialStore, StoredDevice } from "./credential-store.js";
import type { RunnerCloudClient } from "./cloud-client.js";

const maxRequestBytes = 8_192;

export interface LocalBridgeOptions {
  client: Pick<RunnerCloudClient, "enroll" | "heartbeat">;
  store: CredentialStore;
  deviceName: string;
  allowedOrigins: Set<string>;
  heartbeatIntervalMs?: number;
}

export class LocalRunnerBridge {
  private device?: StoredDevice;
  private heartbeatTimer?: NodeJS.Timeout;

  constructor(private readonly options: LocalBridgeOptions) {}

  async start(port = 41_929) {
    this.device = await this.options.store.load();
    if (this.device) this.startHeartbeats();
    const server = createServer((request, response) => void this.handle(request, response));
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });
    return { server, port: (server.address() as AddressInfo).port };
  }

  private async handle(request: IncomingMessage, response: ServerResponse) {
    const host = request.headers.host?.split(":")[0];
    if (host !== "127.0.0.1" && host !== "localhost") return this.json(response, 403, { error: "forbidden_host" });
    const origin = request.headers.origin;
    if (!origin || !this.options.allowedOrigins.has(origin)) return this.json(response, 403, { error: "forbidden_origin" });
    response.setHeader("access-control-allow-origin", origin);
    response.setHeader("vary", "Origin");
    response.setHeader("access-control-allow-private-network", "true");
    if (request.method === "OPTIONS") {
      response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
      response.setHeader("access-control-allow-headers", "content-type");
      response.writeHead(204).end();
      return;
    }
    try {
      if (request.method === "GET" && request.url === "/status") {
        return this.json(response, 200, this.publicStatus());
      }
      if (request.method === "POST" && request.url === "/enroll") {
        const body = await this.readJson(request) as { token?: unknown };
        if (typeof body.token !== "string" || body.token.length > 256) {
          return this.json(response, 400, { error: "invalid_request" });
        }
        const device = await this.options.client.enroll(body.token, this.options.deviceName);
        await this.options.store.save(device);
        this.device = device;
        this.startHeartbeats();
        return this.json(response, 201, this.publicStatus());
      }
      return this.json(response, 404, { error: "not_found" });
    } catch (error) {
      return this.json(response, 502, {
        error: "runner_unavailable",
        message: error instanceof Error ? error.message : "Runner request failed.",
      });
    }
  }

  private publicStatus() {
    return this.device
      ? { status: "online", device: { id: this.device.deviceId, name: this.device.name, platform: this.device.platform } }
      : { status: "not_enrolled" };
  }

  private startHeartbeats() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    const heartbeat = async () => {
      if (!this.device) return;
      try {
        await this.options.client.heartbeat(this.device);
      } catch (error) {
        console.error(error instanceof Error ? error.message : "Heartbeat failed.");
      }
    };
    void heartbeat();
    this.heartbeatTimer = setInterval(heartbeat, this.options.heartbeatIntervalMs ?? 30_000);
    this.heartbeatTimer.unref();
  }

  private async readJson(request: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const buffer = Buffer.from(chunk);
      size += buffer.length;
      if (size > maxRequestBytes) throw new Error("The request is too large.");
      chunks.push(buffer);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }

  private json(response: ServerResponse, status: number, body: unknown) {
    response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify(body));
  }
}
