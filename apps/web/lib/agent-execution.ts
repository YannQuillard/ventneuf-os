import type { AgentExecutionItem, AgentExecutionSnapshot, MissionHistoryEntry } from "@ventneuf/domain";
import type { MissionState } from "./conversations";

export interface AgentExecution {
  missionId: string;
  title: string;
  provider: "codex" | "claude";
  repositoryId?: string;
  model?: string;
  result?: string;
  status: MissionState["status"];
  receivedAt?: string;
  snapshot: AgentExecutionSnapshot | null;
  canManage?: boolean;
}

/** A snapshot item enriched with the time its saved history first observed it. */
export interface TimelineItem extends AgentExecutionItem { occurredAt?: string }

export interface ExecutionNode<Item extends AgentExecutionItem = AgentExecutionItem> { item: Item; children: ExecutionNode<Item>[] }

/** Missing parents, cycles and deep native nesting remain inspectable as top-level rows. */
export function executionTree<Item extends AgentExecutionItem>(items: Item[]): ExecutionNode<Item>[] {
  const nodes = new Map(items.map((item) => [item.id, { item, children: [] } as ExecutionNode<Item>]));
  const roots: ExecutionNode<Item>[] = [];
  for (const node of nodes.values()) {
    let parent = node.item.parentId ? nodes.get(node.item.parentId) : undefined;
    let ancestor = parent;
    const visited = new Set([node.item.id]);
    while (ancestor) {
      if (visited.has(ancestor.item.id) || visited.size >= 5) { parent = undefined; break; }
      visited.add(ancestor.item.id);
      ancestor = ancestor.item.parentId ? nodes.get(ancestor.item.parentId) : undefined;
    }
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export function executionItemStatus(item: AgentExecutionItem, missionStatus: MissionState["status"]) {
  if (item.status === "running") {
    if (missionStatus === "waiting_for_approval") return "Waiting";
    if (["failed", "cancelled"].includes(missionStatus)) return "Interrupted";
    if (missionStatus === "completed") return "No completion event";
  }
  return { running: "Running", completed: "Done", failed: "Failed", unknown: "Reported" }[item.status];
}

interface SavedItem extends TimelineItem { savedAt: string }

function savedItems(history: MissionHistoryEntry[]) {
  const saved = new Map<string, SavedItem>();
  for (const { item, occurredAt } of history) {
    saved.set(item.id, { ...item, occurredAt: saved.get(item.id)?.occurredAt ?? occurredAt, savedAt: occurredAt });
  }
  return saved;
}

function reconcile(item: AgentExecutionItem, record: SavedItem | undefined, snapshotUpdatedAt: string): TimelineItem {
  if (!record) return item;
  const { savedAt, ...saved } = record;
  if (Date.parse(savedAt) > Date.parse(snapshotUpdatedAt)) return saved;
  const keepSavedText = item.status !== "running" && saved.text.length >= item.text.length;
  return keepSavedText
    ? { ...item, text: saved.text, truncated: saved.truncated, occurredAt: saved.occurredAt }
    : { ...item, occurredAt: saved.occurredAt };
}

/** Saved history supplies evicted activity; the live snapshot stays authoritative for what it still holds. */
export function mergeExecutionTimeline(history: MissionHistoryEntry[], snapshot: AgentExecutionSnapshot | null): TimelineItem[] {
  const saved = savedItems(history);
  const live = snapshot?.items ?? [];
  const liveIds = new Set(live.map((item) => item.id));
  const evicted = [...saved.values()].filter((item) => !liveIds.has(item.id)).map(({ savedAt: _savedAt, ...item }) => item);
  return [...evicted, ...live.map((item) => reconcile(item, saved.get(item.id), snapshot?.updatedAt ?? ""))];
}

export function hasFailure(node: ExecutionNode<TimelineItem>): boolean {
  return node.item.status === "failed" || node.children.some(hasFailure);
}

export function countNodes(node: ExecutionNode<TimelineItem>): number {
  return node.children.reduce((total, child) => total + countNodes(child), node.children.length);
}
