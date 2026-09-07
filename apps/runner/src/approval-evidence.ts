import { scrubSensitiveText } from "./execution-activity.js";

export const approvalCommandLimit = 8_000;

function escaped(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface ApprovalCommandEvidence {
  command: string;
  commandLength: number;
  commandTruncated: boolean;
  commandRedacted: boolean;
}

export function approvalCommandSecrets(value: unknown) {
  if (typeof value !== "string") return [];
  const secrets = new Set<string>();
  const patterns = [
    /(?:^|[\s"';&|])(?:--?)(?:api[_-]?key|access[_-]?token|auth(?:orization)?|password|passwd|private[_-]?key|secret|token)(?:=|\s+)(?:"([^"]*)"|'([^']*)'|([^\s"';&|]+))/gi,
    /\b(?:api[_-]?key|access[_-]?token|auth(?:orization)?|password|passwd|private[_-]?key|secret|token)\s*[:=]\s*(?:"([^"]*)"|'([^']*)'|([^\s"',};&|]+))/gi,
    /\bBearer\s+([^\s]+)/gi,
    /https?:\/\/[^/\s:@]+:([^@\s]+)@/gi,
  ];
  for (const pattern of patterns) {
    for (const match of value.matchAll(pattern)) {
      const candidate = match[1] ?? match[2] ?? match[3];
      if (candidate && candidate !== "[redacted]") secrets.add(candidate);
    }
  }
  return [...secrets];
}

export function approvalCommand(value: unknown, privatePaths: readonly string[] = []): ApprovalCommandEvidence {
  const raw = typeof value === "string" ? value.trim() : "";
  const bounded = raw.slice(0, approvalCommandLimit);
  const scrubbed = scrubSensitiveText(bounded, privatePaths);
  return {
    command: scrubbed.text,
    commandLength: raw.length,
    commandTruncated: raw.length > approvalCommandLimit,
    commandRedacted: scrubbed.redacted,
  };
}

export function approvalReason(
  value: unknown,
  privatePaths: readonly string[] = [],
  sensitiveValues: readonly string[] = [],
) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const scrubbed = scrubSensitiveText(value.trim().slice(0, 2_000), privatePaths);
  let text = scrubbed.text;
  let redacted = scrubbed.redacted;
  for (const secret of [...sensitiveValues].sort((left, right) => right.length - left.length)) {
    if (!secret) continue;
    const next = text.replace(new RegExp(escaped(secret), "g"), "[redacted]");
    if (next !== text) redacted = true;
    text = next;
  }
  return { text, redacted };
}
