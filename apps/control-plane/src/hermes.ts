import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { randomUUID } from "node:crypto";

export interface AskHermesInput {
  message: string;
  contextId?: string;
}

export interface HermesReply {
  taskId?: string;
  contextId: string;
  state?: string;
  text: string;
}

export interface HermesClient {
  ask(input: AskHermesInput): Promise<HermesReply>;
}

export interface TokenProvider {
  getToken(): Promise<string>;
}

export class HermesRequestTimeoutError extends Error {
  constructor(cause?: unknown) {
    super("Hermes did not reply before the A2A timeout.", { cause });
    this.name = "HermesRequestTimeoutError";
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
