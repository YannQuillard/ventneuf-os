import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { randomUUID } from "node:crypto";

export interface AskHermesInput {
  message: string;
  contextId?: string;
  runId?: string;
  sessionKey?: string;
  onRunStarted?: (runId: string) => Promise<void>;
  idempotencyKey?: string;
  onEvent?: (event: HermesRunEvent) => Promise<void>;
}

export interface HermesRunEvent {
  event: string;
  run_id?: string;
  timestamp?: number;
  [key: string]: unknown;
}

export interface HermesReply {
  taskId?: string;
  contextId: string;
  state?: string;
  text: string;
  usage?: Record<string, unknown>;
}

export interface HermesClient {
  ask(input: AskHermesInput): Promise<HermesReply>;
  stop?(runId: string): Promise<void>;
}

export interface TokenProvider {
  getToken(): Promise<string>;
}

export class HermesRequestTimeoutError extends Error {
  constructor(cause?: unknown) {
    super("Hermes did not reply before the request timeout.", { cause });
    this.name = "HermesRequestTimeoutError";
  }
}

export class HermesRunCancelledError extends Error {
  constructor() {
    super("The Hermes run was cancelled.");
    this.name = "HermesRunCancelledError";
  }
}

export class StaticTokenProvider implements TokenProvider {
  constructor(private readonly token: string) {}

  async getToken(): Promise<string> {
    return this.token;
  }
}

export class SecretsManagerTokenProvider implements TokenProvider {
  private cached?: { token: string; expiresAt: number };

  constructor(
    private readonly client: SecretsManagerClient,
    private readonly secretId: string,
    private readonly cacheTtlMs = 5 * 60 * 1000,
  ) {}

  async getToken(): Promise<string> {
    if (this.cached && this.cached.expiresAt > Date.now()) return this.cached.token;
    const response = await this.client.send(
      new GetSecretValueCommand({ SecretId: this.secretId }),
    );
    const token = response.SecretString?.trim();
    if (!token) throw new Error("The Hermes A2A secret has no string value.");
    this.cached = { token, expiresAt: Date.now() + this.cacheTtlMs };
    return token;
  }
}

type Fetch = typeof fetch;

interface A2AResponse {
  error?: { code?: number; message?: string };
  result?: {
    task?: {
      id?: string;
      contextId?: string;
      status?: { state?: string; message?: unknown };
      artifacts?: unknown[];
    };
    message?: unknown;
  };
}

interface HermesRun {
  run_id?: string;
  status?: string;
  session_id?: string;
  output?: string;
  error?: string | { message?: string };
  usage?: Record<string, unknown>;
}

function errorMessage(error: HermesRun["error"]): string | undefined {
  if (typeof error === "string") return error;
  return error?.message;
}

export class RunsHermesClient implements HermesClient {
  private readonly baseUrl: string;

  constructor(
    url: string,
    private readonly tokens: TokenProvider,
    private readonly fetchImplementation: Fetch = fetch,
    private readonly pollIntervalMs = 1_000,
    private readonly maxWaitMs = 12 * 60_000,
  ) {
    this.baseUrl = url.replace(/\/$/, "");
  }

  async ask(input: AskHermesInput): Promise<HermesReply> {
    const contextId = input.contextId ?? randomUUID();
    let runId = input.runId;

    if (!runId) {
      let response: Response;
      try {
        response = await this.request("/v1/runs", {
          method: "POST",
          body: JSON.stringify({ input: input.message, session_id: contextId }),
          signal: AbortSignal.timeout(10_000),
        }, input.sessionKey, input.idempotencyKey);
      } catch (error) {
        if (error instanceof Error && error.name === "TimeoutError") {
          throw new Error(
            "Hermes Runs API submission timed out and will be recovered with its idempotency key.",
            { cause: error },
          );
        }
        throw error;
      }
      await this.assertOk(response, "start");
      const run = await response.json() as HermesRun;
      if (!run.run_id) throw new Error("Hermes Runs API returned no run ID.");
      runId = run.run_id;
      await input.onRunStarted?.(runId);
    }

    const eventStream = input.onEvent
      ? this.streamEvents(runId, input.onEvent, input.sessionKey).catch(() => undefined)
      : Promise.resolve();

    const deadline = Date.now() + this.maxWaitMs;
    while (Date.now() < deadline) {
      const response = await this.request(
        `/v1/runs/${encodeURIComponent(runId)}`,
        { signal: AbortSignal.timeout(10_000) },
        input.sessionKey,
      );
      await this.assertOk(response, "read");
      const run = await response.json() as HermesRun;
      const status = run.status?.toLowerCase();
      if (status === "completed") {
        await eventStream;
        if (!run.output) throw new Error("Hermes Runs API completed without output.");
        return {
          taskId: runId,
          contextId: run.session_id ?? contextId,
          state: status,
          text: run.output,
          usage: run.usage,
        };
      }
      if (status === "failed") {
        throw new Error(`Hermes run failed: ${errorMessage(run.error) ?? "unknown failure"}`);
      }
      if (status === "cancelled" || status === "interrupted") {
        throw new HermesRunCancelledError();
      }
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
    throw new Error("Hermes run is still active after the polling window.");
  }

  async stop(runId: string): Promise<void> {
    const response = await this.request(`/v1/runs/${encodeURIComponent(runId)}/stop`, {
      method: "POST",
      body: "{}",
      signal: AbortSignal.timeout(10_000),
    });
    await this.assertOk(response, "stop");
  }

  private async request(
    path: string,
    init: RequestInit,
    sessionKey?: string,
    idempotencyKey?: string,
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${await this.tokens.getToken()}`);
    headers.set("content-type", "application/json");
    if (sessionKey) headers.set("x-hermes-session-key", sessionKey);
    if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
    return this.fetchImplementation(`${this.baseUrl}${path}`, { ...init, headers });
  }

  private async streamEvents(
    runId: string,
    onEvent: (event: HermesRunEvent) => Promise<void>,
    sessionKey?: string,
  ): Promise<void> {
    const response = await this.request(
      `/v1/runs/${encodeURIComponent(runId)}/events`,
      { headers: { accept: "text/event-stream" } },
      sessionKey,
    );
    await this.assertOk(response, "stream");
    if (!response.body) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const data = frame.split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n");
        if (!data || data === "[DONE]") continue;
        try {
          const event = JSON.parse(data) as HermesRunEvent;
          if (typeof event.event === "string") await onEvent(event);
        } catch (error) {
          if (error instanceof SyntaxError) continue;
          throw error;
        }
      }
      if (done) break;
    }
  }

  private async assertOk(response: Response, operation: string): Promise<void> {
    if (response.ok) return;
    throw new Error(`Hermes Runs API could not ${operation} a run (HTTP ${response.status}).`);
  }
}

function extractText(value: unknown): string {
  if (Array.isArray(value)) return value.map(extractText).filter(Boolean).join("\n");
  if (!value || typeof value !== "object") return "";
  const object = value as Record<string, unknown>;
  if (typeof object.text === "string") return object.text;
  for (const key of ["parts", "artifacts"]) {
    if (Array.isArray(object[key])) {
      const text = (object[key] as unknown[]).map(extractText).filter(Boolean).join("\n");
      if (text) return text;
    }
  }
  for (const key of ["message", "task", "status"]) {
    const text = extractText(object[key]);
    if (text) return text;
  }
  return "";
}

export class A2AHermesClient implements HermesClient {
  constructor(
    private readonly url: string,
    private readonly tokens: TokenProvider,
    private readonly fetchImplementation: Fetch = fetch,
  ) {}

  async ask(input: AskHermesInput): Promise<HermesReply> {
    const contextId = input.contextId ?? randomUUID();
    let response: Response;
    try {
      response = await this.fetchImplementation(this.url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${await this.tokens.getToken()}`,
          "content-type": "application/json",
          "a2a-version": "1.0",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: randomUUID(),
          method: "SendMessage",
          params: {
            message: {
              role: "ROLE_USER",
              parts: [{ text: input.message, mediaType: "text/plain" }],
              messageId: randomUUID(),
              contextId,
            },
          },
        }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new HermesRequestTimeoutError(error);
      }
      throw error;
    }
    if (!response.ok) throw new Error(`Hermes A2A returned HTTP ${response.status}.`);

    const payload = (await response.json()) as A2AResponse;
    if (payload.error) {
      throw new Error(
        `Hermes A2A returned ${payload.error.message ?? `error ${payload.error.code ?? "unknown"}`}.`,
      );
    }
    const task = payload.result?.task;
    const text =
      extractText(task?.artifacts) ||
      extractText(task?.status?.message) ||
      extractText(payload.result?.message);
    if (!text) throw new Error("Hermes A2A returned no text.");

    return {
      taskId: task?.id,
      contextId: task?.contextId ?? contextId,
      state: task?.status?.state,
      text,
    };
  }
}

export function createHermesClient(env: NodeJS.ProcessEnv = process.env): HermesClient {
  if (env.HERMES_API_URL && env.HERMES_API_SECRET_ID) {
    const client = new SecretsManagerClient({ region: env.AWS_REGION ?? "eu-west-1" });
    return new RunsHermesClient(
      env.HERMES_API_URL,
      new SecretsManagerTokenProvider(client, env.HERMES_API_SECRET_ID),
    );
  }
  if (env.NODE_ENV !== "production" && env.HERMES_API_URL && env.HERMES_API_TOKEN) {
    return new RunsHermesClient(env.HERMES_API_URL, new StaticTokenProvider(env.HERMES_API_TOKEN));
  }
  const url = env.HERMES_A2A_URL ?? "http://127.0.0.1:9900/";
  if (env.HERMES_A2A_SECRET_ID) {
    const client = new SecretsManagerClient({ region: env.AWS_REGION ?? "eu-west-1" });
    return new A2AHermesClient(
      url,
      new SecretsManagerTokenProvider(client, env.HERMES_A2A_SECRET_ID),
    );
  }
  if (env.NODE_ENV !== "production" && env.HERMES_A2A_TOKEN) {
    return new A2AHermesClient(url, new StaticTokenProvider(env.HERMES_A2A_TOKEN));
  }
  throw new Error(
    "HERMES_A2A_SECRET_ID is required. HERMES_A2A_TOKEN is accepted only outside production.",
  );
}
