import { randomUUID } from "node:crypto";
import type { AppConfig } from "./config.js";

interface JsonRpcResponse {
  error?: { code?: number; message?: string; data?: unknown };
  result?: Record<string, unknown>;
}

function collectText(value: unknown, output: string[]): void {
  if (!value || typeof value !== "object") return;
  const object = value as Record<string, unknown>;
  if (typeof object.text === "string") output.push(object.text);
  for (const key of ["parts", "artifacts"]) {
    if (Array.isArray(object[key])) {
      for (const item of object[key] as unknown[]) collectText(item, output);
    }
  }
  if (object.message) collectText(object.message, output);
  if (object.status) collectText(object.status, output);
  if (object.task) collectText(object.task, output);
}

function findContextId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const object = value as Record<string, unknown>;
  if (typeof object.contextId === "string") return object.contextId;
  for (const key of ["task", "message", "status"]) {
    const nested = findContextId(object[key]);
    if (nested) return nested;
  }
  return undefined;
}

export async function askHermes(
  config: AppConfig,
  message: string,
  contextId?: string,
): Promise<{ contextId: string; text: string; raw: unknown }> {
  if (!config.hermesA2aUrl || !config.hermesA2aToken) {
    throw new Error(
      "Hermes A2A is not configured. Set VENTNEUF_HERMES_A2A_URL and VENTNEUF_HERMES_A2A_TOKEN.",
    );
  }
  const requestId = randomUUID();
  const activeContextId = contextId ?? randomUUID();
  const response = await fetch(config.hermesA2aUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.hermesA2aToken}`,
      "content-type": "application/json",
      "a2a-version": "1.0",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: requestId,
      method: "SendMessage",
      params: {
        message: {
          role: "ROLE_USER",
          parts: [{ text: message, mediaType: "text/plain" }],
          messageId: randomUUID(),
          contextId: activeContextId,
        },
      },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    throw new Error(`Hermes A2A returned HTTP ${response.status}.`);
  }
  const payload = (await response.json()) as JsonRpcResponse;
  if (payload.error) {
    throw new Error(
      `Hermes A2A: ${payload.error.message ?? `error ${payload.error.code ?? "unknown"}`}`,
    );
  }
  const textParts: string[] = [];
  collectText(payload.result, textParts);
  const resultContext = findContextId(payload.result) ?? activeContextId;
  return {
    contextId: resultContext,
    text: [...new Set(textParts)].join("\n\n") || "Hermes returned no text.",
    raw: payload.result,
  };
}
