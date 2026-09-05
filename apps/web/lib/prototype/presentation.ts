import type { AgentKind, ApprovalState, FileChangeStatus, MissionStatus, MissionStepKind, MissionStepStatus } from "./types";

export type DotVariant = "success" | "warning" | "error" | "accent" | "neutral";

export interface StatusPresentation {
  label: string;
  dot: DotVariant;
  isPulsing: boolean;
}

export const missionStatusPresentation: Record<MissionStatus, StatusPresentation> = {
  queued: { label: "Queued", dot: "neutral", isPulsing: false },
  running: { label: "Running", dot: "accent", isPulsing: true },
  waiting_for_approval: { label: "Awaiting approval", dot: "warning", isPulsing: true },
  completed: { label: "Completed", dot: "success", isPulsing: false },
  failed: { label: "Failed", dot: "error", isPulsing: false },
  cancelled: { label: "Cancelled", dot: "neutral", isPulsing: false },
};

export type BannerStatus = "info" | "warning" | "error" | "success";

export interface ApprovalPresentation {
  banner: BannerStatus;
  heading: string;
  tokenColor: "blue" | "yellow" | "green" | "red";
}

export const approvalStatePresentation: Record<ApprovalState, ApprovalPresentation> = {
  requested: { banner: "info", heading: "Awaiting Hermes decision", tokenColor: "blue" },
  escalated: { banner: "warning", heading: "Needs your decision", tokenColor: "yellow" },
  approved: { banner: "success", heading: "Approved", tokenColor: "green" },
  rejected: { banner: "error", heading: "Rejected", tokenColor: "red" },
};

export const agentPresentation: Record<AgentKind, { label: string; color: "purple" | "orange" }> = {
  codex: { label: "Codex", color: "purple" },
  claude: { label: "Claude", color: "orange" },
};

export const stepStatusPresentation: Record<MissionStepStatus, StatusPresentation> = {
  completed: { label: "Done", dot: "success", isPulsing: false },
  running: { label: "Running", dot: "accent", isPulsing: true },
  failed: { label: "Failed", dot: "error", isPulsing: false },
  pending: { label: "Pending", dot: "neutral", isPulsing: false },
  skipped: { label: "Skipped", dot: "neutral", isPulsing: false },
};

export const stepKindLabel: Record<MissionStepKind, string> = {
  read: "Read",
  edit: "Edit",
  command: "Command",
  test: "Test",
  approval: "Approval",
  git: "Git",
  browser: "Browser",
  hermes: "Hermes",
};

export const fileStatusPresentation: Record<FileChangeStatus, { label: string; short: string; color: "green" | "blue" | "red" | "purple" }> = {
  added: { label: "Added", short: "A", color: "green" },
  modified: { label: "Modified", short: "M", color: "blue" },
  deleted: { label: "Deleted", short: "D", color: "red" },
  renamed: { label: "Renamed", short: "R", color: "purple" },
};

export type MissionPhase = "dispatched" | "prepared" | "working" | "approval" | "pull-request" | "verified";

export const missionPhases: Array<{ id: MissionPhase; label: string; description: string }> = [
  { id: "dispatched", label: "Dispatched", description: "Hermes selected the agent, device, and authority" },
  { id: "prepared", label: "Worktree ready", description: "Owned branch and terminal on the runner" },
  { id: "working", label: "Working", description: "Explore, edit, test, and iterate autonomously" },
  { id: "approval", label: "Approvals", description: "Decisions by Hermes or the initiating member" },
  { id: "pull-request", label: "Pull request", description: "Pushed branch with a reviewable PR" },
  { id: "verified", label: "Verified", description: "Checks, evidence, and cleanup recorded" },
];

export function activePhaseIndex(status: MissionStatus, hasPullRequest: boolean): number {
  if (status === "queued") return 0;
  if (status === "waiting_for_approval") return 3;
  if (status === "running") return hasPullRequest ? 5 : 2;
  if (status === "completed") return 6;
  return hasPullRequest ? 4 : 2;
}
