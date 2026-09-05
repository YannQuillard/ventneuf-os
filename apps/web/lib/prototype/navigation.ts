import { isPendingApproval, isTerminal } from "./state";
import type { Conversation, PrototypeData } from "./types";

export const RECENT_CONVERSATION_LIMIT = 5;
const RECENT_VISIT_WINDOW_MS = 24 * 60 * 60 * 1000;

export type NavigationEntryKind = "main" | "conversation" | "temporary" | "thread" | "channel";

export type NavigationStatus = "running" | "attention";

export interface NavigationEntry {
  id: string;
  kind: NavigationEntryKind;
  label: string;
  href?: string;
  isSelected: boolean;
  isDisabled?: boolean;
  status?: NavigationStatus;
  children: NavigationEntry[];
}

export interface NavigationGroup {
  id: "personal" | "projects";
  title: string;
  entries: NavigationEntry[];
}

export function conversationHref(conversationId: string): string {
  return `/prototype/c/${conversationId}`;
}

export type MissionTab = "overview" | "activity" | "changes" | "terminal" | "evidence";

export const MISSION_TABS: readonly MissionTab[] = ["overview", "activity", "changes", "terminal", "evidence"];

export function isMissionTab(value: string | null | undefined): value is MissionTab {
  return MISSION_TABS.includes(value as MissionTab);
}

export function missionHref(conversationId: string, missionId: string, tab?: MissionTab): string {
  const params = new URLSearchParams({ mission: missionId });
  if (tab && tab !== "overview") params.set("tab", tab);
  return `${conversationHref(conversationId)}?${params.toString()}`;
}

export function isThreadVisible(thread: Conversation, selectedId: string | undefined, now: string): boolean {
  if (thread.isPinned || thread.id === selectedId) return true;
  if (!thread.lastVisitedAt) return false;
  return new Date(now).getTime() - new Date(thread.lastVisitedAt).getTime() < RECENT_VISIT_WINDOW_MS;
}

export function conversationStatus(data: PrototypeData, conversationId: string): NavigationStatus | undefined {
  const missions = data.missions.filter((mission) => mission.conversationId === conversationId && !isTerminal(mission.status));
  if (missions.length === 0) return undefined;
  const needsMember = data.approvals.some((approval) => approval.state === "escalated"
    && isPendingApproval(approval)
    && missions.some((mission) => mission.id === approval.missionId));
  return needsMember ? "attention" : "running";
}

function threadEntries(data: PrototypeData, parentId: string, selectedId: string | undefined): NavigationEntry[] {
  return data.conversations
    .filter((conversation) => conversation.kind === "thread" && conversation.parentId === parentId)
    .filter((thread) => isThreadVisible(thread, selectedId, data.now))
    .sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt))
    .map((thread) => ({
      id: thread.id,
      kind: "thread",
      label: thread.title,
      href: conversationHref(thread.id),
      isSelected: thread.id === selectedId,
      status: conversationStatus(data, thread.id),
      children: [],
    }));
}

export function recentPersonalConversations(data: PrototypeData): Conversation[] {
  return data.conversations
    .filter((conversation) => conversation.kind === "personal" || conversation.kind === "temporary")
    .sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt))
    .slice(0, RECENT_CONVERSATION_LIMIT);
}

export function buildNavigation(data: PrototypeData, selectedId: string | undefined): NavigationGroup[] {
  const main = data.conversations.find((conversation) => conversation.kind === "personal-main");
  const personalEntries: NavigationEntry[] = [
    ...(main ? [{
      id: main.id,
      kind: "main" as const,
      label: main.title,
      href: conversationHref(main.id),
      isSelected: main.id === selectedId,
      status: conversationStatus(data, main.id),
      children: threadEntries(data, main.id, selectedId),
    }] : []),
    ...recentPersonalConversations(data).map((conversation): NavigationEntry => ({
      id: conversation.id,
      kind: conversation.kind === "temporary" ? "temporary" : "conversation",
      label: conversation.title,
      href: conversationHref(conversation.id),
      isSelected: conversation.id === selectedId,
      status: conversationStatus(data, conversation.id),
      children: threadEntries(data, conversation.id, selectedId),
    })),
  ];

  const projectEntries: NavigationEntry[] = data.projects.map((project) => ({
    id: project.id,
    kind: "channel",
    label: project.name,
    href: conversationHref(project.channelId),
    isSelected: project.channelId === selectedId,
    status: conversationStatus(data, project.channelId),
    children: threadEntries(data, project.channelId, selectedId),
  }));

  return [
    { id: "personal", title: "Personal", entries: personalEntries },
    { id: "projects", title: "Projects", entries: projectEntries },
  ];
}

export function conversationTrail(data: PrototypeData, conversation: Conversation): Conversation[] {
  const trail: Conversation[] = [];
  let current: Conversation | undefined = conversation;
  while (current) {
    trail.unshift(current);
    const parentId: string | undefined = current.parentId;
    current = parentId ? data.conversations.find((entry) => entry.id === parentId) : undefined;
  }
  return trail;
}
