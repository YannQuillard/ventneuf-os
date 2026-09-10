import type { MissionApproval, MissionState } from "./conversations";

export const missionStatusPresentation: Record<MissionState["status"], { label: string; dot: "success" | "warning" | "error" | "accent" | "neutral"; isPulsing: boolean }> = {
  queued: { label: "Queued", dot: "neutral", isPulsing: false },
  running: { label: "Running", dot: "accent", isPulsing: true },
  waiting_for_approval: { label: "Awaiting approval", dot: "warning", isPulsing: true },
  completed: { label: "Completed", dot: "success", isPulsing: false },
  failed: { label: "Failed", dot: "error", isPulsing: false },
  cancelled: { label: "Cancelled", dot: "neutral", isPulsing: false },
};

export interface ApprovalPresentation {
  status: "info" | "warning" | "error" | "success";
  heading: string;
  route: string;
  note: string;
  isActionable: boolean;
  isReviewing: boolean;
}

const outcomeNote = "This records the authority decision. Whether the action then succeeded is visible in the mission session.";

/** Hermes review, the member's decision and the outcome of the action are separate states. */
export function approvalPresentation(approval: Pick<MissionApproval, "status" | "route" | "canDecide">): ApprovalPresentation {
  const decider = approval.route === "hermes" ? "Hermes" : approval.route === "automatic" ? "policy" : "the mission initiator";
  const route = approval.route === "human" ? "Escalated by Hermes to the mission initiator"
    : approval.route === "automatic" ? "Pre-authorised by the project policy" : "Hermes decides within its delegated authority";
  if (approval.status === "pending" && approval.route === "human" && approval.canDecide) {
    return { status: "warning", heading: "Needs your decision", route, isActionable: true, isReviewing: false,
      note: "The same agent session resumes with your answer." };
  }
  if (approval.status === "pending" && approval.route === "human") {
    return { status: "info", heading: "Waiting for the mission initiator", route, isActionable: false, isReviewing: false,
      note: "Only the mission initiator can decide this request. You can discuss it with Hermes here." };
  }
  if (approval.status === "pending") {
    return { status: "info", heading: "Hermes is reviewing", route, isActionable: false, isReviewing: true,
      note: "No action is needed from you. The agent resumes once Hermes decides." };
  }
  if (approval.status === "approved") {
    return { status: "success", heading: `Approved by ${decider}`, route, isActionable: false, isReviewing: false, note: outcomeNote };
  }
  if (approval.status === "rejected") {
    return { status: "error", heading: `Rejected by ${decider}`, route, isActionable: false, isReviewing: false, note: outcomeNote };
  }
  return { status: "info", heading: approval.status === "expired" ? "Expired without a decision" : "Cancelled", route,
    isActionable: false, isReviewing: false, note: "The agent did not receive an authorization for this action." };
}

export function pendingApprovalSummary(approvals: MissionApproval[]) {
  const pending = approvals.filter((approval) => approval.status === "pending");
  if (pending.some((approval) => approval.route === "human" && approval.canDecide)) return "your decision" as const;
  if (pending.some((approval) => approval.route === "human")) return "initiator decision" as const;
  if (pending.length) return "Hermes reviewing" as const;
  return undefined;
}
