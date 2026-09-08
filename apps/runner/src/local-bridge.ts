import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { CredentialStore, StoredDevice } from "./credential-store.js";
import type { RunnerCloudClient } from "./cloud-client.js";
import {
  addGitHubRepository,
  addRepositorySearchFolder,
  removeRegisteredRepository,
  removeRepositorySearchFolder,
  replaceRepositorySearchFolder,
  repositorySettings,
} from "./repositories.js";
import { loadExecutionHarnesses, saveExecutionHarnesses, type InstalledHarnesses } from "./execution-harnesses.js";
import type { RunnerUpdater } from "./runner-update.js";

const maxRequestBytes = 8_192;

export interface LocalBridgeOptions {
  client: Pick<RunnerCloudClient, "enroll" | "heartbeat">;
  store: CredentialStore;
  deviceName: string;
  allowedOrigins: Set<string>;
  repositoriesFile?: string;
  harnessesFile?: string;
  selectFolder?: () => Promise<string | undefined>;
  updater?: Pick<RunnerUpdater, "status" | "install" | "confirmHealthy">;
  installedHarnesses?: InstalledHarnesses;
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
    await this.options.updater?.confirmHealthy();
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
      response.setHeader("access-control-allow-methods", "DELETE, GET, PATCH, POST, OPTIONS");
      response.setHeader("access-control-allow-headers", "content-type");
      response.writeHead(204).end();
      return;
    }
    try {
      if (request.method === "GET" && request.url === "/status") {
        return this.json(response, 200, await this.publicStatus());
      }
      if (request.method === "GET" && request.url === "/repository-settings") {
        if (!this.device) return this.json(response, 409, { error: "runner_not_enrolled" });
        if (!this.options.repositoriesFile) return this.json(response, 503, { error: "repository_configuration_unavailable" });
        return this.json(response, 200, await repositorySettings(this.options.repositoriesFile));
      }
      if (request.method === "POST" && request.url === "/folders/select") {
        if (!this.device) return this.json(response, 409, { error: "runner_not_enrolled" });
        if (!this.options.selectFolder) return this.json(response, 503, { error: "folder_selection_unavailable" });
        const path = await this.options.selectFolder();
        return this.json(response, 200, path ? { path } : { cancelled: true });
      }
      if (request.url === "/repository-search-folders" && ["POST", "PATCH", "DELETE"].includes(request.method ?? "")) {
        if (!this.device) return this.json(response, 409, { error: "runner_not_enrolled" });
        if (!this.options.repositoriesFile) return this.json(response, 503, { error: "repository_configuration_unavailable" });
        const body = await this.readJson(request) as { path?: unknown; currentPath?: unknown };
        if (typeof body.path !== "string" || (body.currentPath !== undefined && typeof body.currentPath !== "string")) {
          return this.json(response, 400, { error: "invalid_request" });
        }
        if (request.method === "POST") {
          const path = await addRepositorySearchFolder(this.options.repositoriesFile, body.path);
          return this.json(response, 201, { path });
        }
        if (request.method === "PATCH") {
          if (typeof body.currentPath !== "string") return this.json(response, 400, { error: "invalid_request" });
          const path = await replaceRepositorySearchFolder(this.options.repositoriesFile, body.currentPath, body.path);
          return this.json(response, 200, { path });
        }
        await removeRepositorySearchFolder(this.options.repositoriesFile, body.path);
        return this.json(response, 204, undefined);
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
        return this.json(response, 201, await this.publicStatus());
      }
      if (request.method === "POST" && request.url === "/repositories") {
        if (!this.device) return this.json(response, 409, { error: "runner_not_enrolled" });
        if (!this.options.repositoriesFile) return this.json(response, 503, { error: "repository_configuration_unavailable" });
        const body = await this.readJson(request) as {
          githubUrl?: unknown;
          githubRepositoryId?: unknown;
          repositoryPath?: unknown;
          searchRoot?: unknown;
        };
        if (typeof body.githubUrl !== "string" || (body.githubRepositoryId !== undefined && typeof body.githubRepositoryId !== "string")
          || (body.repositoryPath !== undefined && typeof body.repositoryPath !== "string")
          || (body.searchRoot !== undefined && typeof body.searchRoot !== "string")) {
          return this.json(response, 400, { error: "invalid_request" });
        }
        const repository = await addGitHubRepository(this.options.repositoriesFile, {
          url: body.githubUrl,
          ...(body.githubRepositoryId ? { repositoryId: body.githubRepositoryId } : {}),
          ...(body.repositoryPath ? { repositoryPath: body.repositoryPath } : {}),
          ...(body.searchRoot ? { searchRoot: body.searchRoot } : {}),
        });
        return this.json(response, 201, { repository: { id: repository.id, name: repository.name, github: repository.github } });
      }
      if (request.method === "PATCH" && request.url === "/execution-harnesses") {
        if (!this.device) return this.json(response, 409, { error: "runner_not_enrolled" });
        if (!this.options.harnessesFile) return this.json(response, 503, { error: "harness_configuration_unavailable" });
        const harnesses = await saveExecutionHarnesses(this.options.harnessesFile, await this.readJson(request),
          this.options.installedHarnesses ?? { codex: false, claude: false });
        await this.heartbeat();
        return this.json(response, 200, { harnesses });
      }
      if (request.method === "DELETE" && request.url === "/repositories") {
        if (!this.device) return this.json(response, 409, { error: "runner_not_enrolled" });
        if (!this.options.repositoriesFile) return this.json(response, 503, { error: "repository_configuration_unavailable" });
        const body = await this.readJson(request) as { id?: unknown };
        if (typeof body.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(body.id)) {
          return this.json(response, 400, { error: "invalid_request" });
        }
        await removeRegisteredRepository(this.options.repositoriesFile, body.id);
        return this.json(response, 204, undefined);
      }
      if (request.method === "GET" && request.url === "/updates") {
        if (!this.device) return this.json(response, 409, { error: "runner_not_enrolled" });
        if (!this.options.updater) return this.json(response, 503, { error: "runner_updates_unavailable" });
        return this.json(response, 200, await this.options.updater.status());
      }
      if (request.method === "POST" && request.url === "/updates/install") {
        if (!this.device) return this.json(response, 409, { error: "runner_not_enrolled" });
        if (!this.options.updater) return this.json(response, 503, { error: "runner_updates_unavailable" });
        return this.json(response, 202, { version: await this.options.updater.install(), restarting: true });
      }
      return this.json(response, 404, { error: "not_found" });
    } catch (error) {
      return this.json(response, 502, {
        error: "runner_unavailable",
        message: error instanceof Error ? error.message : "Runner request failed.",
      });
    }
  }

  private async publicStatus() {
    const installedHarnesses = this.options.installedHarnesses ?? { codex: false, claude: false };
    const harnesses = this.options.harnessesFile
      ? await loadExecutionHarnesses(this.options.harnessesFile, installedHarnesses)
      : {};
    return this.device
      ? { status: "online", device: { id: this.device.deviceId, name: this.device.name, platform: this.device.platform },
        installedHarnesses, harnesses }
      : { status: "not_enrolled" };
  }

  private async heartbeat() {
    if (!this.device) return;
    await this.options.client.heartbeat(this.device);
  }

  private startHeartbeats() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    const heartbeat = async () => {
      if (!this.device) return;
      try {
        await this.heartbeat();
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
