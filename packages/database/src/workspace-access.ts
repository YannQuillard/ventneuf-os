export {
  currentPersonalScope,
  currentScopeForConversation,
  currentScopeForMission,
  requireCurrentConversationMemoryFence,
  requireCurrentMissionMemoryScope,
  requireConversationAccess,
  requireProjectAccess,
  requireWorkspaceMember,
  WorkspaceAccessError,
  WorkspaceMemoryFenceError,
  type ConversationMemoryFence,
  type HermesMemoryScope,
  type MissionMemoryScopeFence,
  type WorkspaceScope,
} from "./workspace.js";

import { and, eq, isNull, or } from "drizzle-orm";
import type { DatabaseTransaction } from "./client.js";
import { repositoriesMatch } from "./repository-identity.js";
import { conversationGrants, conversations, devices, missions, projectMembers, projectRepositories, projects } from "./schema.js";

// Recheck delegated project access when execution or an approval resumes.
export async function hasWorkspaceMissionAuthority(transaction: DatabaseTransaction, mission: typeof missions.$inferSelect) {
  if (mission.context.workspaceVersion !== 1) return true;
  if (!mission.projectId || !mission.assignedDeviceId || typeof mission.context.repositoryId !== "string") return false;
  const [authorized] = await transaction.select({ id: conversations.id }).from(conversations)
    .innerJoin(projects, and(eq(projects.organizationId, conversations.organizationId), eq(projects.id, conversations.projectId)))
    .leftJoin(projectMembers, and(eq(projectMembers.organizationId, projects.organizationId), eq(projectMembers.projectId, projects.id), eq(projectMembers.memberId, mission.requestedByMemberId)))
    .leftJoin(conversationGrants, and(eq(conversationGrants.organizationId, conversations.organizationId), eq(conversationGrants.conversationId, conversations.id), eq(conversationGrants.memberId, mission.requestedByMemberId)))
    .where(and(eq(conversations.organizationId, mission.organizationId), eq(conversations.id, mission.conversationId), eq(projects.id, mission.projectId),
      or(eq(projects.ownerMemberId, mission.requestedByMemberId), eq(projectMembers.memberId, mission.requestedByMemberId)),
      or(eq(conversations.ownerMemberId, mission.requestedByMemberId), eq(conversationGrants.memberId, mission.requestedByMemberId))))
    .limit(1);
  if (!authorized) return false;
  const [targetDevice] = await transaction.select({ repositories: devices.repositories }).from(devices).where(and(
    eq(devices.organizationId, mission.organizationId),
    eq(devices.id, mission.assignedDeviceId),
    eq(devices.memberId, mission.requestedByMemberId),
    isNull(devices.revokedAt),
  )).limit(1);
  const targetRepository = targetDevice?.repositories.find(({ id }) => id === mission.context.repositoryId);
  if (!targetRepository) return false;
  const associations = await transaction.select({ association: projectRepositories, repositories: devices.repositories })
    .from(projectRepositories)
    .innerJoin(devices, and(
      eq(devices.organizationId, projectRepositories.organizationId),
      eq(devices.id, projectRepositories.deviceId),
      isNull(devices.revokedAt),
    ))
    .where(and(
      eq(projectRepositories.organizationId, mission.organizationId),
      eq(projectRepositories.projectId, mission.projectId),
    ));
  return associations.some(({ association, repositories }) => {
    const sourceRepository = repositories.find(({ id }) => id === association.repositoryId);
    return Boolean(sourceRepository && repositoriesMatch(sourceRepository, targetRepository));
  });
}
