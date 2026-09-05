import { conversationHref, missionHref, projectHref } from "../../../lib/prototype/navigation";
import { isPendingApproval } from "../../../lib/prototype/state";
import type { PrototypeData } from "../../../lib/prototype/types";

export type SearchItemKind =
  | "action"
  | "conversation"
  | "thread"
  | "channel"
  | "project"
  | "mission"
  | "approval"
  | "pull-request"
  | "file"
  | "knowledge"
  | "device"
  | "usage";

export interface SearchItem {
  id: string;
  label: string;
  auxiliaryData: { group: string; kind: SearchItemKind; href?: string; detail?: string };
}

export const SEARCH_ACTIONS = {
  newConversation: "action:new-conversation",
  newTemporaryConversation: "action:new-temporary-conversation",
} as const;

function conversationKind(kind: PrototypeData["conversations"][number]["kind"]): SearchItemKind {
  if (kind === "thread") return "thread";
  if (kind === "project-channel") return "channel";
  return "conversation";
}

export function buildSearchItems(data: PrototypeData): SearchItem[] {
  const actions: SearchItem[] = [
    { id: SEARCH_ACTIONS.newConversation, label: "New conversation", auxiliaryData: { group: "Actions", kind: "action", detail: "Persistent, personal knowledge" } },
    { id: SEARCH_ACTIONS.newTemporaryConversation, label: "New temporary conversation", auxiliaryData: { group: "Actions", kind: "action", detail: "Nothing written to memory" } },
    { id: "action:devices", label: "Devices and connections", auxiliaryData: { group: "Actions", kind: "device", href: "/prototype/devices" } },
    { id: "action:usage", label: "Usage and costs", auxiliaryData: { group: "Actions", kind: "usage", href: "/prototype/usage" } },
  ];
  const conversations = data.conversations.map((conversation): SearchItem => {
    const parent = conversation.parentId ? data.conversations.find((entry) => entry.id === conversation.parentId) : undefined;
    const project = conversation.projectId ? data.projects.find((entry) => entry.id === conversation.projectId) : undefined;
    const detail = [
      conversation.isArchived ? "Archived" : undefined,
      conversation.kind === "temporary" ? "Temporary" : undefined,
      parent ? `in ${parent.kind === "project-channel" ? "#" : ""}${parent.title}` : project ? project.name : undefined,
    ].filter(Boolean).join(" · ");
    return {
      id: `conversation:${conversation.id}`,
      label: conversation.title,
      auxiliaryData: {
        group: conversation.kind === "thread" ? "Threads" : conversation.kind === "project-channel" ? "Channels" : "Conversations",
        kind: conversationKind(conversation.kind),
        href: conversationHref(conversation.id),
        detail: detail || undefined,
      },
    };
  });
  const projects = data.projects.map((project): SearchItem => ({
    id: `project:${project.id}`,
    label: project.name,
    auxiliaryData: { group: "Projects", kind: "project", href: projectHref(project.id), detail: project.description },
  }));
  const missions = data.missions.map((mission): SearchItem => ({
    id: `mission:${mission.id}`,
    label: mission.title,
    auxiliaryData: {
      group: "Missions",
      kind: "mission",
      href: missionHref(mission.conversationId, mission.id),
      detail: `${mission.agent === "codex" ? "Codex" : "Claude"} · ${mission.status.replace("_", " ")}`,
    },
  }));
  const approvals = data.approvals.filter(isPendingApproval).map((approval): SearchItem => {
    const mission = data.missions.find((entry) => entry.id === approval.missionId);
    return {
      id: `approval:${approval.id}`,
      label: approval.operation,
      auxiliaryData: {
        group: "Pending approvals",
        kind: "approval",
        href: mission ? conversationHref(mission.conversationId) : undefined,
        detail: approval.state === "escalated" ? "Needs your decision" : "Awaiting Hermes",
      },
    };
  });
  const pullRequests = data.missions.flatMap((mission) => mission.pullRequest ? [{
    id: `pr:${mission.id}`,
    label: `#${mission.pullRequest.number} ${mission.pullRequest.title}`,
    auxiliaryData: { group: "Pull requests", kind: "pull-request" as const, href: missionHref(mission.conversationId, mission.id), detail: mission.pullRequest.state },
  } satisfies SearchItem] : []);
  const files = data.missions.flatMap((mission) => mission.files.map((file): SearchItem => ({
    id: `file:${mission.id}:${file.path}`,
    label: file.path,
    auxiliaryData: { group: "Changed files", kind: "file", href: missionHref(mission.conversationId, mission.id, "changes"), detail: mission.title },
  })));
  const knowledge = data.knowledgeNotes.map((note): SearchItem => {
    const source = data.knowledgeSources.find((entry) => entry.id === note.sourceId);
    const project = source?.projectId ? data.projects.find((entry) => entry.id === source.projectId) : undefined;
    return {
      id: `knowledge:${note.id}`,
      label: note.title,
      auxiliaryData: {
        group: "Knowledge",
        kind: "knowledge",
        href: project ? `${projectHref(project.id)}?tab=knowledge` : undefined,
        detail: `${source?.name ?? "Vault"} · ${note.path}`,
      },
    };
  });
  const devices = data.devices.filter((device) => !device.isRevoked).map((device): SearchItem => ({
    id: `device:${device.id}`,
    label: device.name,
    auxiliaryData: { group: "Devices", kind: "device", href: "/prototype/devices", detail: device.isOnline ? "Runner online" : "Runner offline" },
  }));
  return [...actions, ...conversations, ...projects, ...missions, ...approvals, ...pullRequests, ...files, ...knowledge, ...devices];
}
