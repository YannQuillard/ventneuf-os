import type { AgentExecutionItem, AgentExecutionSnapshot, MissionHistoryEntry } from "@ventneuf/domain";
import type { MissionApproval, MissionState } from "./conversations";

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

export type TimelineEntry =
  | { kind: "node"; node: ExecutionNode<TimelineItem> }
  | { kind: "approval"; approval: MissionApproval };

/** Approvals slot in by time among dated activity; activity only known from the live snapshot stays last. */
export function interleaveApprovals(nodes: ExecutionNode<TimelineItem>[], approvals: MissionApproval[]): TimelineEntry[] {
  const dated = nodes.filter((node) => node.item.occurredAt);
  const live = nodes.filter((node) => !node.item.occurredAt);
  const sorted = [...approvals].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
  const slotOf = (approval: MissionApproval) => {
    const index = dated.findIndex((node) => Date.parse(node.item.occurredAt!) >= Date.parse(approval.createdAt));
    return index === -1 ? dated.length : index;
  };
  const slotted = sorted.map((approval) => ({ approval, slot: slotOf(approval) }));
  const before = (slot: number): TimelineEntry[] => slotted.filter((entry) => entry.slot === slot).map(({ approval }) => ({ kind: "approval", approval }));
  return [
    ...dated.flatMap((node, index): TimelineEntry[] => [...before(index), { kind: "node", node }]),
    ...before(dated.length),
    ...live.map((node): TimelineEntry => ({ kind: "node", node })),
  ];
}

export type ActionCategory = "read" | "searched" | "edited" | "ran" | "fetched" | "delegated" | "planned" | "changed" | "hooked";

const toolCategories: Record<string, ActionCategory> = {
  read: "read", glob: "searched", grep: "searched", ls: "searched", edit: "edited", write: "edited", multiedit: "edited",
  notebookedit: "edited", bash: "ran", skill: "ran", webfetch: "fetched", websearch: "fetched", task: "delegated", agent: "delegated", todowrite: "planned",
};

const phrases: Record<ActionCategory, [one: string, many: string]> = {
  read: ["Read 1 file", "Read N files"], searched: ["Searched the code", "Searched the code N times"],
  edited: ["Edited 1 file", "Edited N files"], ran: ["Ran 1 command", "Ran N commands"], fetched: ["Fetched 1 page", "Fetched N pages"],
  delegated: ["Delegated 1 task", "Delegated N tasks"], planned: ["Updated the plan", "Updated the plan N times"],
  changed: ["Changed files", "Changed files N times"], hooked: ["Ran 1 hook", "Ran N hooks"],
};

export function actionCategory(item: AgentExecutionItem): ActionCategory {
  if (item.kind === "agent") return "delegated";
  if (item.kind === "plan") return "planned";
  if (item.kind === "diff") return "changed";
  if (item.kind === "status") return "hooked";
  return toolCategories[item.label.split(/\s/)[0]?.toLowerCase() ?? ""] ?? "ran";
}

/** One readable line for a run of actions, in the spirit of "Read 3 files, ran 2 commands". */
export function summarizeActions(items: AgentExecutionItem[]): string {
  const counts = items.reduce<Partial<Record<ActionCategory, number>>>((totals, item) => {
    const category = actionCategory(item);
    return { ...totals, [category]: (totals[category] ?? 0) + 1 };
  }, {});
  return (Object.keys(phrases) as ActionCategory[]).filter((category) => counts[category])
    .map((category) => counts[category] === 1 ? phrases[category][0] : phrases[category][1].replace("N", String(counts[category])))
    .map((part, index) => index ? `${part[0]?.toLowerCase()}${part.slice(1)}` : part)
    .join(", ");
}

/** Bare tool names read better with their argument: "Read" becomes "Read apps/web/app/page.tsx". */
export function actionTitle(item: AgentExecutionItem): string {
  const label = item.label || item.kind;
  if (/\s/.test(label)) return label;
  const argument = item.text.split("\n")[0]?.trim() ?? "";
  return argument && argument.length <= 120 ? `${label} ${argument}` : label;
}
