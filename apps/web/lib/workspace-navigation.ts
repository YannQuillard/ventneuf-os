import { conversationHref, type WorkspaceSnapshot } from "./workspace";

export type NavigationEntryKind = "main" | "conversation" | "temporary" | "thread" | "mission" | "project" | "memory" | "channel" | "devices" | "usage";

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
  id: "personal" | "projects" | "workspace";
  title: string;
  entries: NavigationEntry[];
}

export function workspaceNavigation(pathname: string, runnerOnline: boolean, snapshot?: WorkspaceSnapshot): NavigationGroup[] {
  const conversations = snapshot?.conversations ?? [];
  const personalRoots = conversations.filter((conversation) => !conversation.projectId && !conversation.parentConversationId);
  const personalEntries: NavigationEntry[] = personalRoots.map((conversation) => ({
    id: conversation.id,
    kind: conversation.kind === "topic" ? "thread" : "conversation",
    label: conversation.title || "Untitled conversation",
    href: conversationHref(conversation),
    isSelected: pathname === conversationHref(conversation),
    children: conversations.filter((child) => child.parentConversationId === conversation.id).map((child) => ({
      id: child.id,
      kind: "thread",
      label: child.title || "Untitled thread",
      href: conversationHref(child),
      isSelected: pathname === conversationHref(child),
      children: [],
    })),
  }));
  const projectEntries: NavigationEntry[] = (snapshot?.projects ?? []).map((project) => ({
    id: project.id,
    kind: "project",
    label: project.name,
    href: `/projects/${encodeURIComponent(project.id)}`,
    isSelected: pathname === `/projects/${encodeURIComponent(project.id)}`,
    children: conversations.filter((conversation) => conversation.projectId === project.id).map((conversation) => ({
      id: conversation.id,
      kind: conversation.kind === "mission" ? "mission" : "thread",
      label: conversation.title || (conversation.kind === "mission" ? "Untitled mission" : "Untitled thread"),
      href: conversationHref(conversation),
      isSelected: pathname === conversationHref(conversation),
      children: [],
    })),
  }));
  return [
    { id: "personal", title: "Personal", entries: personalEntries },
    { id: "projects", title: "Projects", entries: projectEntries },
    { id: "workspace", title: "Workspace", entries: [
      { id: "memory", kind: "memory", label: "Memory", href: "/memory", isSelected: pathname === "/memory", children: [] },
      { id: "devices", kind: "devices", label: "Devices", href: "/devices",
        isSelected: pathname === "/devices", status: runnerOnline ? "running" : undefined, children: [] },
    ] },
  ];
}
