export interface WorkspaceMember {
  id: string;
  name: string;
}

export interface RepositoryAssociation {
  id: string;
  deviceId: string;
  repositoryId: string;
  repository?: { name: string; github?: { owner: string; name: string } };
}

export interface WorkspaceProject {
  id: string;
  name: string;
  context: Record<string, unknown>;
  ownerMemberId: string;
  repositoryAssociations: RepositoryAssociation[];
  recipients: WorkspaceMember[];
  canManage: boolean;
  isOwner: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ConversationKind = "private" | "topic" | "mission";

export interface WorkspaceConversation {
  id: string;
  title: string;
  kind: ConversationKind;
  projectId?: string;
  parentConversationId?: string;
  missionId?: string;
  ownerMemberId: string;
  recipients: WorkspaceMember[];
  canManage: boolean;
  isOwner: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceSnapshot {
  currentMember: WorkspaceMember;
  members: WorkspaceMember[];
  projects: WorkspaceProject[];
  conversations: WorkspaceConversation[];
}

export interface WorkspaceDevice {
  id: string;
  name: string;
  lastSeenAt?: string;
  repositories?: Array<{ id: string; name: string; github?: { owner: string; name: string } }>;
}

export interface MemoryEntry {
  id: string;
  title: string;
  summary?: string;
  path?: string;
  updatedAt: string;
  content?: string;
}

export async function workspaceRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/workspace${path}`, {
    cache: "no-store",
    ...init,
    headers: init?.body ? { "content-type": "application/json", ...init.headers } : init?.headers,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => undefined) as { error?: string; message?: string } | undefined;
    throw new Error(payload?.message ?? payload?.error ?? "The workspace request failed.");
  }
  return response.json() as Promise<T>;
}

export function conversationHref(conversation: Pick<WorkspaceConversation, "id" | "kind" | "projectId">): string {
  return conversation.kind === "mission" && conversation.projectId
    ? `/projects/${encodeURIComponent(conversation.projectId)}/missions/${encodeURIComponent(conversation.id)}`
    : `/c/${encodeURIComponent(conversation.id)}`;
}
