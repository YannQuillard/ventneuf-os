/** A bounded view of native agent activity, not a complete session transcript. */
export interface AgentExecutionItem {
  id: string;
  threadId: string;
  parentId?: string;
  kind: "message" | "tool" | "agent" | "plan" | "diff" | "status";
  label: string;
  status: "running" | "completed" | "failed" | "unknown";
  text: string;
  truncated?: boolean;
}

export interface AgentExecutionSnapshot {
  version: 1;
  provider: "codex" | "claude";
  revision: number;
  updatedAt: string;
  rootThreadId: string;
  omittedItems: number;
  items: AgentExecutionItem[];
}

export const executionSnapshotMaxBytes = 48_000;

export function isAgentExecutionSnapshot(value: unknown): value is AgentExecutionSnapshot {
  if (!value || typeof value !== "object") return false;
  const v = value as AgentExecutionSnapshot;
  const short = (text: unknown, limit: number) => typeof text === "string" && text.length <= limit;
  return v.version === 1 && ["codex", "claude"].includes(v.provider)
    && Number.isSafeInteger(v.revision) && v.revision > 0
    && Number.isSafeInteger(v.omittedItems) && v.omittedItems >= 0
    && short(v.rootThreadId, 200) && Boolean(v.rootThreadId)
    && short(v.updatedAt, 40) && Number.isFinite(Date.parse(v.updatedAt))
    && Array.isArray(v.items) && v.items.length <= 80
    && new Set(v.items.map((item) => item?.id)).size === v.items.length
    && v.items.every((item) => item && short(item.id, 400) && Boolean(item.id)
      && short(item.threadId, 200) && Boolean(item.threadId)
      && (item.parentId === undefined || short(item.parentId, 400))
      && ["message", "tool", "agent", "plan", "diff", "status"].includes(item.kind)
      && ["running", "completed", "failed", "unknown"].includes(item.status)
      && short(item.label, 200) && short(item.text, 4_000)
      && (item.truncated === undefined || typeof item.truncated === "boolean"))
    && new TextEncoder().encode(JSON.stringify(v)).length <= executionSnapshotMaxBytes;
}

/** Durable observable activity. Provider reasoning and configuration are never recorded. */
export interface MissionHistoryEntry {
  id: string;
  provider: "codex" | "claude";
  sessionId: string;
  occurredAt: string;
  item: AgentExecutionItem;
}
export const historyBatchMaxBytes = 90_000;
export const historyTextLimit = 32_000;
export function isMissionHistoryBatch(value: unknown): value is MissionHistoryEntry[] {
  if (!Array.isArray(value) || !value.length || value.length > 50) return false;
  if (new TextEncoder().encode(JSON.stringify(value)).length > historyBatchMaxBytes) return false;
  return new Set(value.map(entry => entry?.id)).size === value.length && value.every(entry => {
    if (!entry || typeof entry !== "object"
      || Object.keys(entry).some(key => !["id", "provider", "sessionId", "occurredAt", "item"].includes(key))
      || (entry.item && Object.keys(entry.item).some(key => !["id", "threadId", "parentId", "kind", "label", "status", "text", "truncated"].includes(key)))
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entry.id)
      || typeof entry.item?.text !== "string" || entry.item.text.length > historyTextLimit) return false;
    return isAgentExecutionSnapshot({ version: 1, provider: entry.provider, rootThreadId: entry.sessionId,
      revision: 1, omittedItems: 0, updatedAt: entry.occurredAt, items: [{ ...entry.item, text: entry.item.text.slice(0, 4_000) }] });
  });
}
