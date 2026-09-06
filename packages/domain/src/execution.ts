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
