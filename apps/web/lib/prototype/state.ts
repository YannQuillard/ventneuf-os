import type {
  Approval,
  Conversation,
  ConversationEntry,
  Member,
  Mission,
  MissionStatus,
  Project,
  PrototypeData,
} from "./types";

export type PrototypeAction =
  | { type: "decideApproval"; approvalId: string; outcome: "approved" | "rejected"; note?: string; at: string }
  | { type: "cancelMission"; missionId: string; at: string }
  | { type: "retryMission"; missionId: string; at: string }
  | { type: "sendMessage"; conversationId: string; content: string; at: string }
  | { type: "receiveReply"; conversationId: string; content: string; at: string }
  | { type: "visitConversation"; conversationId: string; at: string };

export const TERMINAL_STATUSES: readonly MissionStatus[] = ["completed", "failed", "cancelled"];

export function isTerminal(status: MissionStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function isPendingApproval(approval: Approval): boolean {
  return approval.state === "requested" || approval.state === "escalated";
}

export function currentMember(data: PrototypeData): Member {
  const member = data.members.find((entry) => entry.isCurrentUser);
  if (!member) throw new Error("Prototype data must define the current member.");
  return member;
}

export function memberById(data: PrototypeData, id: string): Member | undefined {
  return data.members.find((member) => member.id === id);
}

export function conversationById(data: PrototypeData, id: string): Conversation | undefined {
  return data.conversations.find((conversation) => conversation.id === id);
}

export function missionById(data: PrototypeData, id: string): Mission | undefined {
  return data.missions.find((mission) => mission.id === id);
}

export function approvalById(data: PrototypeData, id: string): Approval | undefined {
  return data.approvals.find((approval) => approval.id === id);
}

export function projectForConversation(data: PrototypeData, conversation: Conversation): Project | undefined {
  return conversation.projectId
    ? data.projects.find((project) => project.id === conversation.projectId)
    : undefined;
}

export function missionsForConversation(data: PrototypeData, conversationId: string): Mission[] {
  return data.missions.filter((mission) => mission.conversationId === conversationId);
}

export function approvalsForMission(data: PrototypeData, missionId: string): Approval[] {
  return data.approvals
    .filter((approval) => approval.missionId === missionId)
    .sort((left, right) => left.requestedAt.localeCompare(right.requestedAt));
}

export function pendingMemberApprovals(data: PrototypeData, missionId: string): Approval[] {
  const mission = missionById(data, missionId);
  if (!mission || isTerminal(mission.status)) return [];
  return approvalsForMission(data, missionId).filter((approval) => approval.state === "escalated");
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

type EntryInput = DistributiveOmit<ConversationEntry, "id">;

function nextEntryId(entries: ConversationEntry[], prefix: string): string {
  return `${prefix}-${entries.length + 1}`;
}

function appendEntry(data: PrototypeData, conversationId: string, entry: EntryInput): PrototypeData {
  const existing = data.entries[conversationId] ?? [];
  const withId = { ...entry, id: nextEntryId(existing, conversationId) } as ConversationEntry;
  return {
    ...data,
    entries: { ...data.entries, [conversationId]: [...existing, withId] },
    conversations: data.conversations.map((conversation) => conversation.id === conversationId
      ? { ...conversation, lastActivityAt: entry.createdAt }
      : conversation),
  };
}

function replaceMission(data: PrototypeData, updated: Mission): PrototypeData {
  return { ...data, missions: data.missions.map((mission) => mission.id === updated.id ? updated : mission) };
}

function replaceApproval(data: PrototypeData, updated: Approval): PrototypeData {
  return { ...data, approvals: data.approvals.map((approval) => approval.id === updated.id ? updated : approval) };
}

function agentLabel(mission: Mission): string {
  return mission.agent === "codex" ? "Codex" : "Claude";
}

function decideApproval(data: PrototypeData, action: Extract<PrototypeAction, { type: "decideApproval" }>): PrototypeData {
  const approval = approvalById(data, action.approvalId);
  const mission = approval ? missionById(data, approval.missionId) : undefined;
  if (!approval || !mission || !isPendingApproval(approval) || isTerminal(mission.status)) return data;

  const member = currentMember(data);
  const isApproved = action.outcome === "approved";
  const decidedApproval: Approval = {
    ...approval,
    state: action.outcome,
    decision: {
      by: "member",
      outcome: action.outcome,
      note: action.note ?? (isApproved ? "Approved from the conversation." : "Rejected from the conversation."),
      authority: `${member.name} · initiating member`,
      at: action.at,
    },
    resumedAt: action.at,
  };

  const stepDetail = isApproved
    ? `Approved by ${member.name} · session resumed`
    : `Rejected by ${member.name} · ${agentLabel(mission)} continues within its remaining authority`;
  const steps = mission.steps.map((step) => step.kind === "approval" && step.status === "running"
    ? { ...step, status: "completed" as const, detail: stepDetail, durationMs: Math.max(0, new Date(action.at).getTime() - new Date(step.startedAt).getTime()) }
    : step);
  const otherPending = approvalsForMission(data, mission.id)
    .filter((entry) => entry.id !== approval.id && isPendingApproval(entry));
  const resumedMission: Mission = {
    ...mission,
    status: otherPending.length > 0 ? mission.status : "running",
    currentStep: isApproved
      ? `Resuming ${agentLabel(mission)} with your approval: ${approval.operation}`
      : `${agentLabel(mission)} is working around the rejected operation: ${approval.operation}`,
    steps,
    terminal: {
      ...mission.terminal,
      lines: [
        ...mission.terminal.lines,
        {
          id: `t-decision-${approval.id}`,
          kind: "notice",
          text: isApproved
            ? `Decision received: approved by ${member.name}. Resuming ${approval.sessionRef}…`
            : `Decision received: rejected by ${member.name}. Continuing without ${approval.operation.toLowerCase()}.`,
        },
      ],
    },
  };

  const withMission = replaceMission(replaceApproval(data, decidedApproval), resumedMission);
  return appendEntry(withMission, mission.conversationId, {
    kind: "system",
    icon: "mission",
    content: isApproved
      ? `${agentLabel(mission)} session resumed with your approval`
      : `${agentLabel(mission)} session resumed with your rejection as a constraint`,
    createdAt: action.at,
  });
}

function cancelMission(data: PrototypeData, action: Extract<PrototypeAction, { type: "cancelMission" }>): PrototypeData {
  const mission = missionById(data, action.missionId);
  if (!mission || isTerminal(mission.status)) return data;
  const member = currentMember(data);
  const cancelled: Mission = {
    ...mission,
    status: "cancelled",
    endedAt: action.at,
    currentStep: undefined,
    cancellation: { byId: member.id, reason: "Stopped from the conversation.", at: action.at },
    steps: mission.steps.map((step) => step.status === "running" || step.status === "pending"
      ? { ...step, status: "skipped" as const }
      : step),
    terminal: {
      ...mission.terminal,
      lines: [
        ...mission.terminal.lines,
        {
          id: "t-cancelled",
          kind: "notice",
          text: `Cancellation received from ${member.name}. Closing owned processes; clean worktrees are removed automatically.`,
        },
      ],
    },
  };
  return appendEntry(replaceMission(data, cancelled), mission.conversationId, {
    kind: "system",
    icon: "mission",
    content: `Mission cancelled by ${member.name}`,
    createdAt: action.at,
  });
}

function retryMission(data: PrototypeData, action: Extract<PrototypeAction, { type: "retryMission" }>): PrototypeData {
  const mission = missionById(data, action.missionId);
  if (!mission || !isTerminal(mission.status)) return data;
  const attempt = mission.attempt + 1;
  const retried: Mission = {
    ...mission,
    status: "running",
    startedAt: action.at,
    endedAt: undefined,
    attempt,
    failure: undefined,
    cancellation: undefined,
    currentStep: `Preparing a fresh worktree for attempt ${attempt}`,
    steps: [
      ...mission.steps,
      {
        id: `retry-${attempt}`,
        kind: "hermes",
        label: `Hermes redispatched the mission (attempt ${attempt})`,
        detail: "Fresh lease and permission check before resuming",
        status: "running",
        startedAt: action.at,
      },
    ],
    terminal: {
      ...mission.terminal,
      lines: [
        ...mission.terminal.lines,
        { id: `t-retry-${attempt}`, kind: "notice", text: `Attempt ${attempt} started with a fresh lease.` },
      ],
    },
  };
  return appendEntry(replaceMission(data, retried), mission.conversationId, {
    kind: "system",
    icon: "mission",
    content: `Mission retried · attempt ${attempt}`,
    createdAt: action.at,
  });
}

function visitConversation(data: PrototypeData, action: Extract<PrototypeAction, { type: "visitConversation" }>): PrototypeData {
  return {
    ...data,
    conversations: data.conversations.map((conversation) => conversation.id === action.conversationId
      ? { ...conversation, lastVisitedAt: action.at }
      : conversation),
  };
}

export function prototypeReducer(data: PrototypeData, action: PrototypeAction): PrototypeData {
  switch (action.type) {
    case "decideApproval":
      return decideApproval(data, action);
    case "cancelMission":
      return cancelMission(data, action);
    case "retryMission":
      return retryMission(data, action);
    case "sendMessage":
      return appendEntry(data, action.conversationId, {
        kind: "message",
        role: "user",
        authorId: currentMember(data).id,
        content: action.content,
        createdAt: action.at,
      });
    case "receiveReply":
      return appendEntry(data, action.conversationId, {
        kind: "message",
        role: "hermes",
        content: action.content,
        createdAt: action.at,
        timing: { totalMs: 1_400, model: "hermes-supervisor", tokens: 220 },
      });
    case "visitConversation":
      return visitConversation(data, action);
  }
}
