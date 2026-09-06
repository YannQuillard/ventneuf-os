import type { AgentExecutionItem, AgentExecutionSnapshot } from "@ventneuf/domain";
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
}

export interface ExecutionNode { item: AgentExecutionItem; children: ExecutionNode[] }

/** Missing parents, cycles and deep native nesting remain inspectable as top-level rows. */
export function executionTree(items: AgentExecutionItem[]): ExecutionNode[] {
  const nodes = new Map(items.map((item) => [item.id, { item, children: [] } as ExecutionNode]));
  const roots: ExecutionNode[] = [];
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
