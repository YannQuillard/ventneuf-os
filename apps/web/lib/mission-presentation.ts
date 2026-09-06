import type { MissionState } from "./conversations";

export const missionStatusPresentation: Record<MissionState["status"], { label: string; dot: "success" | "warning" | "error" | "accent" | "neutral"; isPulsing: boolean }> = {
  queued: { label: "Queued", dot: "neutral", isPulsing: false },
  running: { label: "Running", dot: "accent", isPulsing: true },
  waiting_for_approval: { label: "Awaiting approval", dot: "warning", isPulsing: true },
  completed: { label: "Completed", dot: "success", isPulsing: false },
  failed: { label: "Failed", dot: "error", isPulsing: false },
  cancelled: { label: "Cancelled", dot: "neutral", isPulsing: false },
};
