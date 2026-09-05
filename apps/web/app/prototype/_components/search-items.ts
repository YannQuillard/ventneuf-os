import { conversationHref, missionHref } from "../../../lib/prototype/navigation";
import { isPendingApproval } from "../../../lib/prototype/state";
import type { PrototypeData } from "../../../lib/prototype/types";

export interface SearchItem {
  id: string;
  label: string;
  auxiliaryData: { group: string; href?: string; detail?: string };
}

const knowledgeNotes = [
  { id: "knowledge:daily", label: "Daily/2026-09-05.md", detail: "Personal knowledge" },
  { id: "knowledge:connectors", label: "Architecture/Connector registry.md", detail: "ventneuf-os knowledge" },
  { id: "knowledge:runbook", label: "Runbooks/First runner.md", detail: "ventneuf-os knowledge" },
];

export function buildSearchItems(data: PrototypeData): SearchItem[] {
  const conversations = data.conversations.map((conversation): SearchItem => ({
    id: `conversation:${conversation.id}`,
    label: conversation.title,
    auxiliaryData: {
      group: conversation.kind === "thread" ? "Threads" : conversation.kind === "project-channel" ? "Channels" : "Conversations",
      href: conversationHref(conversation.id),
    },
  }));
  const missions = data.missions.map((mission): SearchItem => ({
    id: `mission:${mission.id}`,
    label: mission.title,
    auxiliaryData: { group: "Missions", href: missionHref(mission.conversationId, mission.id) },
  }));
  const approvals = data.approvals.filter(isPendingApproval).map((approval): SearchItem => {
    const mission = data.missions.find((entry) => entry.id === approval.missionId);
    return {
      id: `approval:${approval.id}`,
      label: approval.operation,
      auxiliaryData: { group: "Pending approvals", href: mission ? conversationHref(mission.conversationId) : undefined },
    };
  });
  const files = data.missions.flatMap((mission) => mission.files.map((file): SearchItem => ({
    id: `file:${mission.id}:${file.path}`,
    label: file.path,
    auxiliaryData: { group: "Changed files", href: missionHref(mission.conversationId, mission.id, "changes") },
  })));
  const pullRequests = data.missions.flatMap((mission) => mission.pullRequest ? [{
    id: `pr:${mission.id}`,
    label: `#${mission.pullRequest.number} ${mission.pullRequest.title}`,
    auxiliaryData: { group: "Pull requests", href: missionHref(mission.conversationId, mission.id) },
  } satisfies SearchItem] : []);
  const knowledge = knowledgeNotes.map((note): SearchItem => ({
    id: note.id,
    label: note.label,
    auxiliaryData: { group: "Knowledge", detail: note.detail },
  }));
  return [...conversations, ...missions, ...approvals, ...pullRequests, ...files, ...knowledge];
}
