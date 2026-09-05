import type {
  Approval,
  Conversation,
  ConversationEntry,
  Device,
  DeviceCapability,
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
  | { type: "visitConversation"; conversationId: string; at: string }
  | { type: "createConversation"; conversationId: string; title: string; isTemporary: boolean; at: string }
  | { type: "startThread"; threadId: string; conversationId: string; messageId: string; title: string; at: string }
  | { type: "keepConversation"; conversationId: string; at: string }
  | { type: "togglePin"; conversationId: string }
  | { type: "archiveConversation"; conversationId: string; at: string }
  | { type: "setDeviceCapability"; deviceId: string; repositoryId: string; capability: DeviceCapability; enabled: boolean }
  | { type: "enrollDevice"; deviceId: string; name: string; platform: string; at: string }
  | { type: "revokeDevice"; deviceId: string; at: string }
  | { type: "connectConnector"; connectorId: string; at: string }
  | { type: "setConnectorProjectAccess"; connectorId: string; projectId: string; enabled: boolean };

const TEMPORARY_LIFETIME_MS = 24 * 60 * 60 * 1000;

export function messageById(data: PrototypeData, conversationId: string, messageId: string) {
  const entry = (data.entries[conversationId] ?? []).find((candidate) => candidate.id === messageId);
  return entry?.kind === "message" ? entry : undefined;
}

export function threadsForMessage(data: PrototypeData, messageId: string): Conversation[] {
  return data.conversations.filter((conversation) => conversation.sourceMessageId === messageId && !conversation.isArchived);
}

export function suggestedThreadTitle(content: string): string {
  const firstLine = content.split("\n").map((line) => line.replace(/^[#>*\-\d.\s]+/, "").trim()).find(Boolean) ?? "Thread";
  const words = firstLine.replace(/[`*_]/g, "").split(/\s+/);
  return words.length > 8 ? `${words.slice(0, 8).join(" ")}…` : firstLine;
}

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

function updateConversation(data: PrototypeData, conversationId: string, patch: Partial<Conversation>): PrototypeData {
  return {
    ...data,
    conversations: data.conversations.map((conversation) => conversation.id === conversationId
      ? { ...conversation, ...patch }
      : conversation),
  };
}

function createConversation(data: PrototypeData, action: Extract<PrototypeAction, { type: "createConversation" }>): PrototypeData {
  if (conversationById(data, action.conversationId)) return data;
  const title = action.title.trim() || (action.isTemporary ? "Temporary conversation" : "New conversation");
  const conversation: Conversation = {
    id: action.conversationId,
    kind: action.isTemporary ? "temporary" : "personal",
    title,
    lastActivityAt: action.at,
    lastVisitedAt: action.at,
    knowledgeScope: action.isTemporary ? "none" : "personal",
    expiresAt: action.isTemporary ? new Date(new Date(action.at).getTime() + TEMPORARY_LIFETIME_MS).toISOString() : undefined,
  };
  const withConversation = { ...data, conversations: [...data.conversations, conversation] };
  return appendEntry(withConversation, conversation.id, {
    kind: "system",
    icon: action.isTemporary ? "knowledge" : "thread",
    content: action.isTemporary
      ? "Temporary conversation · discarded after 24 hours · nothing is written to durable knowledge"
      : "Persistent conversation · uses personal knowledge",
    createdAt: action.at,
  });
}

function startThread(data: PrototypeData, action: Extract<PrototypeAction, { type: "startThread" }>): PrototypeData {
  const parent = conversationById(data, action.conversationId);
  const source = messageById(data, action.conversationId, action.messageId);
  if (!parent || !source || conversationById(data, action.threadId)) return data;
  const author = source.role === "hermes"
    ? "Hermes"
    : memberById(data, source.authorId ?? "")?.name ?? currentMember(data).name;
  const thread: Conversation = {
    id: action.threadId,
    kind: "thread",
    parentId: parent.id,
    projectId: parent.projectId,
    sourceMessageId: source.id,
    title: action.title.trim() || suggestedThreadTitle(source.content),
    lastActivityAt: action.at,
    lastVisitedAt: action.at,
    knowledgeScope: parent.knowledgeScope === "none" ? "none" : parent.knowledgeScope,
  };
  const parentLabel = parent.kind === "project-channel" ? `#${parent.title}` : parent.title;
  const withThread: PrototypeData = {
    ...data,
    conversations: [...data.conversations, thread],
    entries: {
      ...data.entries,
      [parent.id]: (data.entries[parent.id] ?? []).map((entry) => entry.id === source.id && entry.kind === "message"
        ? { ...entry, threadId: thread.id }
        : entry),
    },
  };
  const withSystem = appendEntry(withThread, thread.id, {
    kind: "system",
    icon: "thread",
    content: `Thread started from a message in ${parentLabel}`,
    createdAt: action.at,
  });
  return appendEntry(withSystem, thread.id, {
    kind: "snapshot",
    content: source.content,
    authorName: author,
    sourceConversationId: parent.id,
    sourceMessageId: source.id,
    createdAt: action.at,
  });
}

function keepConversation(data: PrototypeData, action: Extract<PrototypeAction, { type: "keepConversation" }>): PrototypeData {
  const conversation = conversationById(data, action.conversationId);
  if (!conversation || conversation.kind !== "temporary") return data;
  const kept = updateConversation(data, conversation.id, {
    kind: "personal",
    knowledgeScope: "personal",
    expiresAt: undefined,
  });
  return appendEntry(kept, conversation.id, {
    kind: "system",
    icon: "knowledge",
    content: "Conversation kept · it now uses personal knowledge and will not be discarded",
    createdAt: action.at,
  });
}

function archiveConversation(data: PrototypeData, action: Extract<PrototypeAction, { type: "archiveConversation" }>): PrototypeData {
  const conversation = conversationById(data, action.conversationId);
  if (!conversation || conversation.kind === "personal-main" || conversation.kind === "project-channel") return data;
  return updateConversation(data, conversation.id, { isArchived: true, isPinned: false, lastActivityAt: action.at });
}

function setDeviceCapability(data: PrototypeData, action: Extract<PrototypeAction, { type: "setDeviceCapability" }>): PrototypeData {
  return {
    ...data,
    devices: data.devices.map((device) => device.id === action.deviceId
      ? {
        ...device,
        repositories: device.repositories.map((repository) => repository.repositoryId === action.repositoryId
          ? { ...repository, capabilities: { ...repository.capabilities, [action.capability]: action.enabled } }
          : repository),
      }
      : device),
  };
}

function enrollDevice(data: PrototypeData, action: Extract<PrototypeAction, { type: "enrollDevice" }>): PrototypeData {
  if (data.devices.some((device) => device.id === action.deviceId)) return data;
  const device: Device = {
    id: action.deviceId,
    name: action.name,
    platform: action.platform,
    isOnline: true,
    lastSeenAt: action.at,
    enrolledAt: action.at,
    ownerId: currentMember(data).id,
    runnerVersion: "0.6.2",
    repositories: [],
  };
  return { ...data, devices: [...data.devices, device] };
}

function revokeDevice(data: PrototypeData, action: Extract<PrototypeAction, { type: "revokeDevice" }>): PrototypeData {
  return {
    ...data,
    devices: data.devices.map((device) => device.id === action.deviceId
      ? { ...device, isRevoked: true, isOnline: false, lastSeenAt: action.at }
      : device),
  };
}

function connectConnector(data: PrototypeData, action: Extract<PrototypeAction, { type: "connectConnector" }>): PrototypeData {
  return {
    ...data,
    connectors: data.connectors.map((connector) => connector.id === action.connectorId
      ? { ...connector, status: "connected" as const, lastUsedAt: action.at }
      : connector),
  };
}

function setConnectorProjectAccess(data: PrototypeData, action: Extract<PrototypeAction, { type: "setConnectorProjectAccess" }>): PrototypeData {
  return {
    ...data,
    connectors: data.connectors.map((connector) => {
      if (connector.id !== action.connectorId) return connector;
      const without = connector.projectIds.filter((projectId) => projectId !== action.projectId);
      return { ...connector, projectIds: action.enabled ? [...without, action.projectId] : without };
    }),
  };
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
    case "createConversation":
      return createConversation(data, action);
    case "startThread":
      return startThread(data, action);
    case "keepConversation":
      return keepConversation(data, action);
    case "togglePin": {
      const conversation = conversationById(data, action.conversationId);
      return conversation ? updateConversation(data, conversation.id, { isPinned: !conversation.isPinned }) : data;
    }
    case "archiveConversation":
      return archiveConversation(data, action);
    case "setDeviceCapability":
      return setDeviceCapability(data, action);
    case "enrollDevice":
      return enrollDevice(data, action);
    case "revokeDevice":
      return revokeDevice(data, action);
    case "connectConnector":
      return connectConnector(data, action);
    case "setConnectorProjectAccess":
      return setConnectorProjectAccess(data, action);
  }
}
