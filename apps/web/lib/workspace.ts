export interface WorkspaceMember {
  id: string;
  name: string;
  handle?: string;
}

export interface RepositoryAssociation {
  id: string;
  deviceId: string;
  repositoryId: string;
  repository?: { name: string; github?: { id?: string; owner: string; name: string } };
}

export interface WorkspaceProject {
  id: string;
  name: string;
  context: Record<string, unknown>;
  ownerMemberId: string;
  generalConversationId?: string;
  repositoryAssociations: RepositoryAssociation[];
  recipients: WorkspaceMember[];
  canManage: boolean;
  isOwner: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ConversationKind = "private" | "topic" | "mission";
export type ReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max";
export interface MissionExecutionPreferences {
  orchestrator: { model: string; reasoningEffort: ReasoningEffort };
  agents: Array<{ provider: "claude"; model: string; reasoningEffort: ReasoningEffort }>;
}

export interface WorkspaceConversation {
  id: string;
  title: string;
  kind: ConversationKind;
  isProjectGeneral?: boolean;
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
  notifications?: WorkspaceNotification[];
}

export interface WorkspaceNotification {
  id: string;
  kind: "project_mention";
  actorMemberId: string;
  actorName: string;
  projectId: string;
  projectName: string;
  conversationId: string;
  messageId: string;
  summary: string;
  readAt?: string;
  createdAt: string;
}

export interface WorkspaceDevice {
  id: string;
  name: string;
  lastSeenAt?: string;
  repositories?: Array<{ id: string; name: string; github?: { id?: string; owner: string; name: string } }>;
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

export function conversationHref(conversation: Pick<WorkspaceConversation, "id" | "kind" | "projectId" | "isProjectGeneral">): string {
  if (conversation.isProjectGeneral && conversation.projectId) return `/projects/${encodeURIComponent(conversation.projectId)}`;
  return conversation.kind === "mission" && conversation.projectId
    ? `/projects/${encodeURIComponent(conversation.projectId)}/missions/${encodeURIComponent(conversation.id)}`
    : `/c/${encodeURIComponent(conversation.id)}`;
}
