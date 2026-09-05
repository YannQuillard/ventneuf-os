import type { PrototypeData, UsageRecord } from "./types";

export type UsagePeriod = "7d" | "30d" | "90d";

export type UsageGroup = "mission" | "agent" | "model" | "project";

export const USAGE_PERIODS: Array<{ id: UsagePeriod; label: string; days: number }> = [
  { id: "7d", label: "7 days", days: 7 },
  { id: "30d", label: "30 days", days: 30 },
  { id: "90d", label: "90 days", days: 90 },
];

export const USAGE_GROUPS: Array<{ id: UsageGroup; label: string }> = [
  { id: "mission", label: "Mission" },
  { id: "agent", label: "Agent" },
  { id: "model", label: "Model" },
  { id: "project", label: "Project" },
];

export interface UsageRow {
  key: string;
  label: string;
  detail?: string;
  href?: string;
  missions: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  costUsd: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const agentLabels: Record<UsageRecord["agent"], string> = {
  codex: "Codex",
  claude: "Claude",
  hermes: "Hermes",
};

export function recordsInPeriod(records: UsageRecord[], period: UsagePeriod, now: string): UsageRecord[] {
  const days = USAGE_PERIODS.find((entry) => entry.id === period)?.days ?? 30;
  const cutoff = new Date(now).getTime() - days * DAY_MS;
  return records.filter((record) => new Date(`${record.date}T00:00:00.000Z`).getTime() >= cutoff);
}

interface GroupIdentity {
  key: string;
  label: string;
  detail?: string;
  href?: string;
}

function identity(data: PrototypeData, record: UsageRecord, group: UsageGroup): GroupIdentity {
  if (group === "agent") return { key: record.agent, label: agentLabels[record.agent] };
  if (group === "model") return { key: record.model, label: record.model, detail: agentLabels[record.agent] };
  if (group === "project") {
    const project = record.projectId ? data.projects.find((entry) => entry.id === record.projectId) : undefined;
    return project
      ? { key: project.id, label: project.name, detail: "Project", href: `/prototype/p/${project.id}` }
      : { key: "personal", label: "Personal", detail: "Private conversations" };
  }
  const mission = record.missionId ? data.missions.find((entry) => entry.id === record.missionId) : undefined;
  if (!mission) return { key: "conversations", label: "Hermes conversations", detail: "Replies without a mission" };
  const conversation = data.conversations.find((entry) => entry.id === mission.conversationId);
  return {
    key: mission.id,
    label: mission.title,
    detail: conversation?.title,
    href: `/prototype/c/${mission.conversationId}?mission=${mission.id}`,
  };
}

function emptyRow(id: GroupIdentity): UsageRow {
  return { ...id, missions: 0, inputTokens: 0, outputTokens: 0, durationMs: 0, costUsd: 0 };
}

function add(row: UsageRow, record: UsageRecord, missionIds: Set<string>): UsageRow {
  if (record.missionId) missionIds.add(record.missionId);
  return {
    ...row,
    missions: missionIds.size,
    inputTokens: row.inputTokens + record.inputTokens,
    outputTokens: row.outputTokens + record.outputTokens,
    durationMs: row.durationMs + record.durationMs,
    costUsd: Math.round((row.costUsd + record.costUsd) * 100) / 100,
  };
}

export function usageRows(
  data: PrototypeData,
  options: { period: UsagePeriod; group: UsageGroup },
): { rows: UsageRow[]; totals: UsageRow } {
  const records = recordsInPeriod(data.usage, options.period, data.now);
  const rows = new Map<string, UsageRow>();
  const missionsByRow = new Map<string, Set<string>>();
  const allMissions = new Set<string>();
  let totals = emptyRow({ key: "total", label: "Total" });

  for (const record of records) {
    const id = identity(data, record, options.group);
    const missionIds = missionsByRow.get(id.key) ?? new Set<string>();
    missionsByRow.set(id.key, missionIds);
    rows.set(id.key, add(rows.get(id.key) ?? emptyRow(id), record, missionIds));
    totals = add(totals, record, allMissions);
  }

  return {
    rows: [...rows.values()].sort((left, right) => right.costUsd - left.costUsd),
    totals,
  };
}
