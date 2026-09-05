export type MissionStatus =
  | "queued"
  | "running"
  | "waiting_for_approval"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentKind = "codex" | "claude";

export type ApprovalState = "requested" | "approved" | "rejected" | "escalated";

export type ApprovalDecider = "hermes" | "member";

export type ApprovalCategory =
  | "network"
  | "dependency"
  | "filesystem"
  | "git"
  | "process"
  | "connector";

export type ConversationKind =
  | "personal-main"
  | "personal"
  | "temporary"
  | "project-channel"
  | "thread";

export type KnowledgeScope = "personal" | "project" | "none";

export interface Member {
  id: string;
  name: string;
  isCurrentUser?: boolean;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  repositories: string[];
  memberIds: string[];
  channelId: string;
}

export interface Device {
  id: string;
  name: string;
  platform: string;
  isOnline: boolean;
  lastSeenAt: string;
}

export interface Conversation {
  id: string;
  kind: ConversationKind;
  title: string;
  parentId?: string;
  projectId?: string;
  isPinned?: boolean;
  lastActivityAt: string;
  lastVisitedAt?: string;
  knowledgeScope: KnowledgeScope;
  summary?: string;
}

export interface MessageTiming {
  totalMs?: number;
  model?: string;
  tokens?: number;
}

export type ConversationEntry =
  | {
      id: string;
      kind: "message";
      role: "user" | "hermes";
      authorId?: string;
      content: string;
      createdAt: string;
      timing?: MessageTiming;
    }
  | {
      id: string;
      kind: "system";
      icon: "thread" | "mission" | "knowledge" | "device";
      content: string;
      createdAt: string;
    }
  | { id: string; kind: "mission"; missionId: string; createdAt: string }
  | { id: string; kind: "approval"; approvalId: string; createdAt: string }
  | {
      id: string;
      kind: "milestone";
      missionId: string;
      title: string;
      description: string;
      href?: string;
      createdAt: string;
    };

export type MissionStepKind =
  | "read"
  | "edit"
  | "command"
  | "test"
  | "approval"
  | "git"
  | "browser"
  | "hermes";

export type MissionStepStatus = "completed" | "running" | "failed" | "pending" | "skipped";

export interface MissionStep {
  id: string;
  kind: MissionStepKind;
  label: string;
  detail?: string;
  status: MissionStepStatus;
  startedAt: string;
  durationMs?: number;
  output?: string;
  additions?: number;
  deletions?: number;
}

export type FileChangeStatus = "added" | "modified" | "deleted" | "renamed";

export interface ChangedFile {
  path: string;
  status: FileChangeStatus;
  additions: number;
  deletions: number;
  diff: string;
}

export interface TerminalLine {
  id: string;
  kind: "command" | "output" | "error" | "notice";
  text: string;
}

export interface Screenshot {
  id: string;
  label: string;
  caption: string;
  viewport: string;
  capturedAt: string;
}

export interface EvidenceCheck {
  id: string;
  label: string;
  status: "passed" | "failed" | "running" | "pending";
  detail: string;
  durationMs?: number;
}

export interface Artifact {
  id: string;
  kind: "log" | "report" | "bundle";
  label: string;
  size: string;
}

export interface PullRequest {
  number: number;
  title: string;
  url: string;
  state: "draft" | "open" | "merged" | "closed";
}

export interface MissionAuthority {
  permitted: string[];
  requiresApproval: string[];
  forbidden: string[];
  expiresAt: string;
  budgetMinutes: number;
}

export interface MissionUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface Mission {
  id: string;
  conversationId: string;
  title: string;
  objective: string;
  status: MissionStatus;
  agent: AgentKind;
  model: string;
  deviceId: string;
  repository: string;
  branch?: string;
  baseBranch: string;
  worktree?: string;
  pullRequest?: PullRequest;
  initiatedById: string;
  dispatchedBy: "hermes" | "member";
  startedAt: string;
  endedAt?: string;
  attempt: number;
  currentStep?: string;
  summary: string;
  authority: MissionAuthority;
  usage?: MissionUsage;
  steps: MissionStep[];
  files: ChangedFile[];
  terminal: { sessionId: string; lines: TerminalLine[] };
  checks: EvidenceCheck[];
  screenshots: Screenshot[];
  artifacts: Artifact[];
  failure?: { reason: string; detail: string; retainedUntil: string };
  cancellation?: { byId: string; reason: string; at: string };
}

export interface ApprovalDecision {
  by: ApprovalDecider;
  outcome: "approved" | "rejected";
  note: string;
  authority: string;
  at: string;
}

export interface Approval {
  id: string;
  missionId: string;
  state: ApprovalState;
  requestedAt: string;
  expiresAt: string;
  operation: string;
  category: ApprovalCategory;
  target: string;
  reason: string;
  expectedEffect: string;
  digest: string;
  hermesNote?: string;
  decision?: ApprovalDecision;
  resumedAt?: string;
  sessionRef: string;
}

export interface PrototypeData {
  now: string;
  members: Member[];
  projects: Project[];
  devices: Device[];
  conversations: Conversation[];
  entries: Record<string, ConversationEntry[]>;
  missions: Mission[];
  approvals: Approval[];
}
