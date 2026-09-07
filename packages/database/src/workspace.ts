import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DatabaseTransaction, Database } from "./client.js";
import {
  conversationGrants,
  conversations,
  devices,
  members,
  messages,
  missions,
  projectMembers,
  projectRepositories,
  projects,
} from "./schema.js";

export interface WorkspaceScope {
  organizationId: string;
  externalSubject: string;
}

type RowLock = "share" | "update";

export class WorkspaceAccessError extends Error {
  constructor(message = "Workspace resource not found or access denied.") {
    super(message);
    this.name = "WorkspaceAccessError";
  }
}

export class WorkspaceMemoryFenceError extends Error {
  constructor(message = "The Hermes memory scope is no longer current.") {
    super(message);
    this.name = "WorkspaceMemoryFenceError";
  }
}

export type HermesMemoryScopeKind = "personal" | "conversation";

/** Server-only routing information for an isolated native Hermes profile. */
export interface HermesMemoryScope {
  scopeId: string;
  kind: HermesMemoryScopeKind;
}

export interface ConversationMemoryFence {
  organizationId: string;
  conversationId: string;
  memoryEpoch: string;
}

export interface MissionMemoryScopeFence {
  organizationId: string;
  missionId: string;
  expectedScopeId: string;
}

async function selectOneForLock<T>(
  query: { for: (lock: RowLock) => Promise<T[]> },
  lock: RowLock,
) {
  const [row] = await query.for(lock);
  return row;
}

export async function requireWorkspaceMember(transaction: DatabaseTransaction, scope: WorkspaceScope) {
  const [member] = await transaction
    .select()
    .from(members)
    .where(and(
      eq(members.organizationId, scope.organizationId),
      eq(members.externalSubject, scope.externalSubject),
    ))
    .limit(1);
  if (!member) throw new WorkspaceAccessError("Workspace member not found or access denied.");
  return member;
}

export async function ensureWorkspaceMember(transaction: DatabaseTransaction, scope: WorkspaceScope) {
  try {
    return await requireWorkspaceMember(transaction, scope);
  } catch (error) {
    if (!(error instanceof WorkspaceAccessError)) throw error;
  }
  await transaction.insert(members).values({
    organizationId: scope.organizationId,
    externalSubject: scope.externalSubject,
    handle: scope.externalSubject,
    displayName: scope.externalSubject,
  }).onConflictDoNothing();
  return requireWorkspaceMember(transaction, scope);
}

async function requireProjectAccessForMember(
  transaction: DatabaseTransaction,
  organizationId: string,
  memberId: string,
  projectId: string,
  lock: RowLock,
) {
  const project = await selectOneForLock(
    transaction
      .select()
      .from(projects)
      .where(and(eq(projects.organizationId, organizationId), eq(projects.id, projectId)))
      .limit(1),
    lock,
  );
  if (!project) throw new WorkspaceAccessError("Project not found or access denied.");

  if (project.ownerMemberId === memberId) return { project, canManage: true };

  const membership = await selectOneForLock(
    transaction
      .select({ memberId: projectMembers.memberId })
      .from(projectMembers)
      .where(and(
        eq(projectMembers.organizationId, organizationId),
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.memberId, memberId),
      ))
      .limit(1),
    lock,
  );
  if (!membership) throw new WorkspaceAccessError("Project not found or access denied.");
  return { project, canManage: false };
}

export async function requireProjectAccess(
  transaction: DatabaseTransaction,
  scope: WorkspaceScope,
  projectId: string,
  options: { lock?: RowLock } = {},
) {
  const member = await requireWorkspaceMember(transaction, scope);
  const result = await requireProjectAccessForMember(
    transaction,
    scope.organizationId,
    member.id,
    projectId,
    options.lock ?? "share",
  );
  return { member, ...result };
}

export async function requireConversationAccess(
  transaction: DatabaseTransaction,
  scope: WorkspaceScope,
  conversationId: string,
  options: { lock?: RowLock; requireProjectAccess?: boolean } = {},
) {
  const lock = options.lock ?? "share";
  const member = await requireWorkspaceMember(transaction, scope);
  const conversation = await selectOneForLock(
    transaction
      .select()
      .from(conversations)
      .where(and(
        eq(conversations.organizationId, scope.organizationId),
        eq(conversations.id, conversationId),
      ))
      .limit(1),
    lock,
  );
  if (!conversation) throw new WorkspaceAccessError("Conversation not found or access denied.");

  let canManage = conversation.ownerMemberId === member.id;
  if (!canManage) {
    const grant = await selectOneForLock(
      transaction
        .select({ memberId: conversationGrants.memberId })
        .from(conversationGrants)
        .where(and(
          eq(conversationGrants.organizationId, scope.organizationId),
          eq(conversationGrants.conversationId, conversation.id),
          eq(conversationGrants.memberId, member.id),
        ))
        .limit(1),
      lock,
    );
    if (!grant) throw new WorkspaceAccessError("Conversation not found or access denied.");
  }

  if (conversation.projectId && options.requireProjectAccess !== false) {
    await requireProjectAccessForMember(
      transaction,
      scope.organizationId,
      member.id,
      conversation.projectId,
      lock,
    );
  }
  return { member, conversation, canManage };
}

async function effectiveConversationAudience(
  transaction: DatabaseTransaction,
  conversation: typeof conversations.$inferSelect,
  lock: RowLock,
) {
  const grants = await transaction
    .select({ memberId: conversationGrants.memberId })
    .from(conversationGrants)
    .where(and(
      eq(conversationGrants.organizationId, conversation.organizationId),
      eq(conversationGrants.conversationId, conversation.id),
    ))
    .for(lock);
  const recipients = [conversation.ownerMemberId, ...grants.map(({ memberId }) => memberId)]
    .filter((memberId): memberId is string => memberId !== null);

  if (!conversation.projectId) return [...new Set(recipients)].sort();

  const project = await selectOneForLock(
    transaction
      .select()
      .from(projects)
      .where(and(
        eq(projects.organizationId, conversation.organizationId),
        eq(projects.id, conversation.projectId),
      ))
      .limit(1),
    lock,
  );
  if (!project) throw new WorkspaceAccessError("Project not found or access denied.");

  const memberships = await transaction
    .select({ memberId: projectMembers.memberId })
    .from(projectMembers)
    .where(and(
      eq(projectMembers.organizationId, conversation.organizationId),
      eq(projectMembers.projectId, project.id),
      inArray(projectMembers.memberId, recipients),
    ))
    .for(lock);
  const permitted = new Set([project.ownerMemberId, ...memberships.map(({ memberId }) => memberId)]);
  const audience = [...new Set(recipients.filter((memberId) => permitted.has(memberId)))].sort();
  if (!audience.includes(conversation.ownerMemberId ?? "")) {
    throw new WorkspaceAccessError("Project conversation owner no longer has access.");
  }
  return audience;
}

function opaqueScopeId(value: Record<string, unknown>) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function currentScopeForAccessibleConversation(
  transaction: DatabaseTransaction,
  conversation: typeof conversations.$inferSelect,
  lock: RowLock,
): Promise<HermesMemoryScope> {
  const audience = await effectiveConversationAudience(transaction, conversation, lock);
  if (audience.length === 1 && audience[0] === conversation.ownerMemberId) {
    return {
      scopeId: opaqueScopeId({ version: 1, kind: "personal", organizationId: conversation.organizationId, memberId: conversation.ownerMemberId }),
      kind: "personal",
    };
  }
  const audienceHash = createHash("sha256").update(JSON.stringify(audience)).digest("base64url");
  return {
    scopeId: opaqueScopeId({
      version: 1,
      kind: "conversation",
      organizationId: conversation.organizationId,
      conversationId: conversation.id,
      memoryEpoch: conversation.memoryEpoch,
      audienceHash,
    }),
    kind: "conversation",
  };
}

function conversationMemoryFence(
  conversation: typeof conversations.$inferSelect,
  scopeId: string,
): ConversationMemoryFence & { scopeId: string } {
  return {
    organizationId: conversation.organizationId,
    conversationId: conversation.id,
    memoryEpoch: conversation.memoryEpoch,
    scopeId,
  };
}

export async function currentPersonalScope(transaction: DatabaseTransaction, scope: WorkspaceScope): Promise<HermesMemoryScope> {
  const member = await requireWorkspaceMember(transaction, scope);
  return {
    scopeId: opaqueScopeId({ version: 1, kind: "personal", organizationId: scope.organizationId, memberId: member.id }),
    kind: "personal",
  };
}

export async function currentScopeForConversation(
  transaction: DatabaseTransaction,
  scope: WorkspaceScope,
  conversationId: string,
) {
  const access = await requireConversationAccess(transaction, scope, conversationId, { lock: "share" });
  const hermesMemoryScope = await currentScopeForAccessibleConversation(transaction, access.conversation, "share");
  return { ...access, hermesMemoryScope, memoryFence: conversationMemoryFence(access.conversation, hermesMemoryScope.scopeId) };
}

export async function currentScopeForMission(
  transaction: DatabaseTransaction,
  scope: WorkspaceScope,
  missionId: string,
) {
  const [mission] = await transaction
    .select()
    .from(missions)
    .where(and(eq(missions.organizationId, scope.organizationId), eq(missions.id, missionId)))
    .limit(1)
    .for("share");
  if (!mission) throw new WorkspaceAccessError("Mission not found or access denied.");
  const access = await requireConversationAccess(transaction, scope, mission.conversationId, { lock: "share" });
  const hermesMemoryScope = await currentScopeForAccessibleConversation(transaction, access.conversation, "share");
  return {
    ...access,
    mission,
    hermesMemoryScope,
    memoryFence: conversationMemoryFence(access.conversation, hermesMemoryScope.scopeId),
  };
}

/**
 * Lock the conversation before writing a Hermes result. A grant or project
 * audience change rotates this value in the same transaction, fencing stale
 * native-profile runs from appending messages or restoring a context ID.
 */
export async function requireCurrentConversationMemoryFence(
  transaction: DatabaseTransaction,
  fence: ConversationMemoryFence,
) {
  const conversation = await selectOneForLock(
    transaction
      .select()
      .from(conversations)
      .where(and(
        eq(conversations.organizationId, fence.organizationId),
        eq(conversations.id, fence.conversationId),
      ))
      .limit(1),
    "update",
  );
  if (!conversation || conversation.memoryEpoch !== fence.memoryEpoch) {
    throw new WorkspaceMemoryFenceError();
  }
  return conversation;
}

/**
 * Runtime-only fence for mission results and events. Call this inside the same
 * transaction that persists the output, before any mission or message write.
 */
export async function requireCurrentMissionMemoryScope(
  transaction: DatabaseTransaction,
  fence: MissionMemoryScopeFence,
) {
  const [mission] = await transaction
    .select()
    .from(missions)
    .where(and(
      eq(missions.organizationId, fence.organizationId),
      eq(missions.id, fence.missionId),
    ))
    .limit(1)
    .for("update");
  if (!mission) throw new WorkspaceMemoryFenceError();
  const [requester] = await transaction
    .select({ externalSubject: members.externalSubject })
    .from(members)
    .where(and(
      eq(members.organizationId, fence.organizationId),
      eq(members.id, mission.requestedByMemberId),
    ))
    .limit(1);
  if (!requester) throw new WorkspaceMemoryFenceError();
  let access: Awaited<ReturnType<typeof requireConversationAccess>>;
  try {
    access = await requireConversationAccess(
      transaction,
      { organizationId: fence.organizationId, externalSubject: requester.externalSubject },
      mission.conversationId,
      { lock: "update" },
    );
  } catch (error) {
    if (error instanceof WorkspaceAccessError) throw new WorkspaceMemoryFenceError();
    throw error;
  }
  const { conversation } = access;
  const hermesMemoryScope = await currentScopeForAccessibleConversation(transaction, conversation, "update");
  if (hermesMemoryScope.scopeId !== fence.expectedScopeId) throw new WorkspaceMemoryFenceError();
  return {
    mission,
    conversation,
    hermesMemoryScope,
    memoryFence: conversationMemoryFence(conversation, hermesMemoryScope.scopeId),
  };
}

async function rotateConversationMemoryEpoch(
  transaction: DatabaseTransaction,
  organizationId: string,
  conversationId: string,
) {
  const [conversation] = await transaction
    .update(conversations)
    .set({ memoryEpoch: sql`gen_random_uuid()`, hermesContextId: null, updatedAt: new Date() })
    .where(and(
      eq(conversations.organizationId, organizationId),
      eq(conversations.id, conversationId),
    ))
    .returning();
  if (!conversation) throw new WorkspaceAccessError("Conversation not found or access denied.");
  return conversation;
}

async function rotateProjectConversationAudiencesForMember(
  transaction: DatabaseTransaction,
  organizationId: string,
  projectId: string,
  memberId: string,
) {
  const affected = await transaction
    .select({ id: conversations.id })
    .from(conversations)
    .innerJoin(conversationGrants, and(
      eq(conversationGrants.organizationId, conversations.organizationId),
      eq(conversationGrants.conversationId, conversations.id),
    ))
    .where(and(
      eq(conversations.organizationId, organizationId),
      eq(conversations.projectId, projectId),
      eq(conversationGrants.memberId, memberId),
    ))
    .for("update");
  if (affected.length === 0) return;
  await transaction
    .update(conversations)
    .set({ memoryEpoch: sql`gen_random_uuid()`, hermesContextId: null, updatedAt: new Date() })
    .where(and(
      eq(conversations.organizationId, organizationId),
      inArray(conversations.id, affected.map(({ id }) => id)),
    ));
}

type ProjectRepositoryAssociation = { deviceId: string; repositoryId: string };
type ConversationKind = "private" | "topic" | "mission";

export class WorkspaceRepository {
  constructor(private readonly database: Database) {}

  private memberView(member: typeof members.$inferSelect) {
    return {
      id: member.id,
      name: member.displayName === "Member" ? member.handle : member.displayName,
    };
  }

  private async projectRecipients(transaction: DatabaseTransaction, organizationId: string, projectId: string) {
    return transaction
      .select({ id: members.id, name: members.displayName })
      .from(projectMembers)
      .innerJoin(members, and(
        eq(members.organizationId, projectMembers.organizationId),
        eq(members.id, projectMembers.memberId),
      ))
      .where(and(
        eq(projectMembers.organizationId, organizationId),
        eq(projectMembers.projectId, projectId),
      ))
      .orderBy(asc(members.displayName), asc(members.id));
  }

  private async projectAssociations(transaction: DatabaseTransaction, organizationId: string, projectId: string) {
    return transaction
      .select({ id: projectRepositories.id, deviceId: projectRepositories.deviceId, repositoryId: projectRepositories.repositoryId })
      .from(projectRepositories)
      .where(and(
        eq(projectRepositories.organizationId, organizationId),
        eq(projectRepositories.projectId, projectId),
      ))
      .orderBy(asc(projectRepositories.createdAt), asc(projectRepositories.id));
  }

  private async projectView(
    transaction: DatabaseTransaction,
    project: typeof projects.$inferSelect,
    actingMemberId: string,
  ) {
    return {
      id: project.id,
      name: project.name,
      context: project.context,
      ownerMemberId: project.ownerMemberId,
      repositoryAssociations: await this.projectAssociations(transaction, project.organizationId, project.id),
      recipients: await this.projectRecipients(transaction, project.organizationId, project.id),
      isOwner: project.ownerMemberId === actingMemberId,
      canManage: project.ownerMemberId === actingMemberId,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
  }

  private async conversationRecipients(transaction: DatabaseTransaction, organizationId: string, conversationId: string) {
    return transaction
      .select({ id: members.id, name: members.displayName })
      .from(conversationGrants)
      .innerJoin(members, and(
        eq(members.organizationId, conversationGrants.organizationId),
        eq(members.id, conversationGrants.memberId),
      ))
      .where(and(
        eq(conversationGrants.organizationId, organizationId),
        eq(conversationGrants.conversationId, conversationId),
      ))
      .orderBy(asc(members.displayName), asc(members.id));
  }

  private async conversationView(
    transaction: DatabaseTransaction,
    conversation: typeof conversations.$inferSelect,
    actingMemberId: string,
  ) {
    const [linkedMission] = conversation.missionId ? [] : conversation.kind === "mission"
      ? await transaction.select({ id: missions.id }).from(missions).where(and(
        eq(missions.organizationId, conversation.organizationId),
        eq(missions.conversationId, conversation.id),
        sql`${missions.context}->>'type' like 'runner.%'`,
      )).orderBy(desc(missions.createdAt), desc(missions.id)).limit(1)
      : [];
    const [parent] = conversation.parentConversationId
      ? await transaction.select({ ownerMemberId: conversations.ownerMemberId }).from(conversations).where(and(
        eq(conversations.organizationId, conversation.organizationId),
        eq(conversations.id, conversation.parentConversationId),
      )).limit(1)
      : [];
    const [parentGrant] = parent && parent.ownerMemberId !== actingMemberId
      ? await transaction.select({ memberId: conversationGrants.memberId }).from(conversationGrants).where(and(
        eq(conversationGrants.organizationId, conversation.organizationId),
        eq(conversationGrants.conversationId, conversation.parentConversationId!),
        eq(conversationGrants.memberId, actingMemberId),
      )).limit(1)
      : [];
    const canSeeParent = parent?.ownerMemberId === actingMemberId || parentGrant !== undefined;
    return {
      id: conversation.id,
      title: conversation.title,
      kind: conversation.kind,
      projectId: conversation.projectId ?? undefined,
      parentConversationId: canSeeParent ? conversation.parentConversationId ?? undefined : undefined,
      missionId: conversation.missionId ?? linkedMission?.id,
      ownerMemberId: conversation.ownerMemberId,
      recipients: await this.conversationRecipients(transaction, conversation.organizationId, conversation.id),
      isOwner: conversation.ownerMemberId === actingMemberId,
      canManage: conversation.ownerMemberId === actingMemberId,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };
  }

  private async validateAssociations(
    transaction: DatabaseTransaction,
    organizationId: string,
    associations: ProjectRepositoryAssociation[],
    deviceOwnerMemberId: string,
  ) {
    const distinct = new Set(associations.map(({ deviceId, repositoryId }) => `${deviceId}\u0000${repositoryId}`));
    if (distinct.size !== associations.length) throw new WorkspaceAccessError("Repository associations must be unique.");
    if (associations.length === 0) return;

    const deviceIds = [...new Set(associations.map(({ deviceId }) => deviceId))];
    const availableDevices = await transaction
      .select()
      .from(devices)
      .where(and(
        eq(devices.organizationId, organizationId),
        inArray(devices.id, deviceIds),
        isNull(devices.revokedAt),
      ));
    if (availableDevices.length !== deviceIds.length) {
      throw new WorkspaceAccessError("Repository device not found or access denied.");
    }

    const deviceById = new Map(availableDevices.map((device) => [device.id, device]));
    for (const association of associations) {
      const device = deviceById.get(association.deviceId);
      if (!device?.repositories.some((repository) => repository.id === association.repositoryId)) {
        throw new WorkspaceAccessError("Repository association is not authorized by the device.");
      }
      if (device.memberId !== deviceOwnerMemberId) {
        throw new WorkspaceAccessError("Repository device not found or access denied.");
      }
    }
  }

  private async replaceAssociations(
    transaction: DatabaseTransaction,
    organizationId: string,
    projectId: string,
    deviceOwnerMemberId: string,
    associations: ProjectRepositoryAssociation[],
  ) {
    const existing = await this.projectAssociations(transaction, organizationId, projectId);
    const existingKeys = new Set(existing.map(({ deviceId, repositoryId }) => `${deviceId}\u0000${repositoryId}`));
    await this.validateAssociations(
      transaction,
      organizationId,
      associations.filter(({ deviceId, repositoryId }) => !existingKeys.has(`${deviceId}\u0000${repositoryId}`)),
      deviceOwnerMemberId,
    );
    await transaction.delete(projectRepositories).where(and(
      eq(projectRepositories.organizationId, organizationId),
      eq(projectRepositories.projectId, projectId),
    ));
    if (associations.length > 0) {
      await transaction.insert(projectRepositories).values(associations.map((association) => ({
        organizationId,
        projectId,
        ...association,
      })));
    }
  }

  listOrganizationMembers(scope: WorkspaceScope) {
    return this.database.withOrganization(scope.organizationId, async (transaction) => {
      await ensureWorkspaceMember(transaction, scope);
      const organizationMembers = await transaction
        .select({ id: members.id, name: members.displayName, handle: members.handle })
        .from(members)
        .where(eq(members.organizationId, scope.organizationId))
        .orderBy(asc(members.displayName), asc(members.id));
      return organizationMembers.map(({ id, name, handle }) => ({ id, name: name === "Member" ? handle : name }));
    });
  }

  listMembers(scope: WorkspaceScope) {
    return this.listOrganizationMembers(scope);
  }

  getCurrentMember(scope: WorkspaceScope) {
    return this.database.withOrganization(scope.organizationId, async (transaction) =>
      this.memberView(await ensureWorkspaceMember(transaction, scope)));
  }

  getMemoryScope(scope: WorkspaceScope, conversationId?: string) {
    return this.database.withOrganization(scope.organizationId, async transaction => conversationId
      ? (await currentScopeForConversation(transaction, scope, conversationId)).hermesMemoryScope
      : currentPersonalScope(transaction, scope));
  }

  updateCurrentMember(scope: WorkspaceScope, name: string) {
    return this.database.withOrganization(scope.organizationId, async transaction => {
      const member = await requireWorkspaceMember(transaction, scope);
      const [updated] = await transaction.update(members).set({ displayName: name }).where(and(
        eq(members.organizationId, scope.organizationId), eq(members.id, member.id),
      )).returning();
      if (!updated) throw new WorkspaceAccessError();
      return this.memberView(updated);
    });
  }

  listDevices(scope: WorkspaceScope) {
    return this.database.withOrganization(scope.organizationId, async (transaction) => {
      const member = await requireWorkspaceMember(transaction, scope);
      return transaction
        .select({ id: devices.id, name: devices.name, repositories: devices.repositories })
        .from(devices)
        .where(and(
          eq(devices.organizationId, scope.organizationId),
          eq(devices.memberId, member.id),
          isNull(devices.revokedAt),
        ))
        .orderBy(asc(devices.name), asc(devices.id));
    });
  }

  listProjects(scope: WorkspaceScope) {
    return this.database.withOrganization(scope.organizationId, async (transaction) => {
      const member = await requireWorkspaceMember(transaction, scope);
      const owned = await transaction
        .select()
        .from(projects)
        .where(and(eq(projects.organizationId, scope.organizationId), eq(projects.ownerMemberId, member.id)));
      const shared = await transaction
        .select({ project: projects })
        .from(projectMembers)
        .innerJoin(projects, and(
          eq(projects.organizationId, projectMembers.organizationId),
          eq(projects.id, projectMembers.projectId),
        ))
        .where(and(
          eq(projectMembers.organizationId, scope.organizationId),
          eq(projectMembers.memberId, member.id),
        ));
      const visible = [...owned, ...shared.map(({ project }) => project)]
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
      return Promise.all(visible.map((project) => this.projectView(transaction, project, member.id)));
    });
  }

  getProject(scope: WorkspaceScope, projectId: string) {
    return this.database.withOrganization(scope.organizationId, async (transaction) => {
      const { member, project } = await requireProjectAccess(transaction, scope, projectId);
      return this.projectView(transaction, project, member.id);
    });
  }

  createProject(scope: WorkspaceScope, input: {
    name: string;
    context?: Record<string, unknown>;
    repositoryAssociations?: ProjectRepositoryAssociation[];
  }) {
    return this.database.withOrganization(scope.organizationId, async (transaction) => {
      const member = await requireWorkspaceMember(transaction, scope);
      const associations = input.repositoryAssociations ?? [];
      const [project] = await transaction.insert(projects).values({
        organizationId: scope.organizationId,
        ownerMemberId: member.id,
        name: input.name,
        context: input.context ?? {},
      }).returning();
      if (!project) throw new Error("Failed to create the project.");
      if (associations.length > 0) {
        await this.validateAssociations(transaction, scope.organizationId, associations, member.id);
        await transaction.insert(projectRepositories).values(associations.map((association) => ({
          organizationId: scope.organizationId,
          projectId: project.id,
          ...association,
        })));
      }
      return this.projectView(transaction, project, member.id);
    });
  }

  updateProject(scope: WorkspaceScope, projectId: string, input: {
    name?: string;
    context?: Record<string, unknown>;
    repositoryAssociations?: ProjectRepositoryAssociation[];
  }) {
    return this.database.withOrganization(scope.organizationId, async (transaction) => {
      const { member, project, canManage } = await requireProjectAccess(transaction, scope, projectId, { lock: "update" });
      if (!canManage) throw new WorkspaceAccessError("Project not found or access denied.");
      if (input.repositoryAssociations) {
        await this.replaceAssociations(transaction, scope.organizationId, projectId, member.id, input.repositoryAssociations);
      }
      const changes = {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.context === undefined ? {} : { context: input.context }),
        updatedAt: new Date(),
      };
      const [updated] = await transaction.update(projects).set(changes).where(and(
        eq(projects.organizationId, scope.organizationId),
        eq(projects.id, project.id),
      )).returning();
      if (!updated) throw new WorkspaceAccessError("Project not found or access denied.");
      return this.projectView(transaction, updated, member.id);
    });
  }

  shareProject(scope: WorkspaceScope, projectId: string, recipientMemberId: string) {
    return this.database.withOrganization(scope.organizationId, async (transaction) => {
      const { member, project, canManage } = await requireProjectAccess(transaction, scope, projectId, { lock: "update" });
      if (!canManage) throw new WorkspaceAccessError("Project not found or access denied.");
      const [recipient] = await transaction.select({ id: members.id }).from(members).where(and(
        eq(members.organizationId, scope.organizationId),
        eq(members.id, recipientMemberId),
      )).limit(1);
      if (!recipient || recipient.id === member.id) throw new WorkspaceAccessError("Project recipient not found or access denied.");
      const added = await transaction.insert(projectMembers).values({
        organizationId: scope.organizationId,
        projectId: project.id,
        memberId: recipient.id,
      }).onConflictDoNothing().returning({ memberId: projectMembers.memberId });
      if (added.length > 0) {
        await rotateProjectConversationAudiencesForMember(transaction, scope.organizationId, project.id, recipient.id);
      }
      return this.projectView(transaction, project, member.id);
    });
  }

  revokeProject(scope: WorkspaceScope, projectId: string, recipientMemberId: string) {
    return this.database.withOrganization(scope.organizationId, async (transaction) => {
      const { member, project, canManage } = await requireProjectAccess(transaction, scope, projectId, { lock: "update" });
      if (!canManage || recipientMemberId === member.id) throw new WorkspaceAccessError("Project recipient not found or access denied.");
      const removed = await transaction.delete(projectMembers).where(and(
        eq(projectMembers.organizationId, scope.organizationId),
        eq(projectMembers.projectId, project.id),
        eq(projectMembers.memberId, recipientMemberId),
      )).returning({ memberId: projectMembers.memberId });
      if (removed.length > 0) {
        await rotateProjectConversationAudiencesForMember(transaction, scope.organizationId, project.id, recipientMemberId);
      }
      return this.projectView(transaction, project, member.id);
    });
  }

  revokeProjectMember(scope: WorkspaceScope, projectId: string, recipientMemberId: string) {
    return this.revokeProject(scope, projectId, recipientMemberId);
  }

  listConversations(scope: WorkspaceScope, input: { projectId?: string } = {}) {
    return this.database.withOrganization(scope.organizationId, async (transaction) => {
      const member = await requireWorkspaceMember(transaction, scope);
      const owned = await transaction.select().from(conversations).where(and(
        eq(conversations.organizationId, scope.organizationId),
        eq(conversations.ownerMemberId, member.id),
      ));
      const granted = await transaction.select({ conversation: conversations }).from(conversationGrants)
        .innerJoin(conversations, and(
          eq(conversations.organizationId, conversationGrants.organizationId),
          eq(conversations.id, conversationGrants.conversationId),
        ))
        .where(and(
          eq(conversationGrants.organizationId, scope.organizationId),
          eq(conversationGrants.memberId, member.id),
        ));
      const candidates = [...owned, ...granted.map(({ conversation }) => conversation)];
      const visible: typeof conversations.$inferSelect[] = [];
      for (const conversation of candidates) {
        if (input.projectId && conversation.projectId !== input.projectId) continue;
        if (conversation.projectId) {
          try {
            await requireProjectAccessForMember(transaction, scope.organizationId, member.id, conversation.projectId, "share");
          } catch (error) {
            if (error instanceof WorkspaceAccessError) continue;
            throw error;
          }
        }
        visible.push(conversation);
      }
      visible.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
      return Promise.all(visible.map((conversation) => this.conversationView(transaction, conversation, member.id)));
    });
  }

  getConversation(scope: WorkspaceScope, conversationId: string) {
    return this.database.withOrganization(scope.organizationId, async (transaction) => {
      const { member, conversation } = await requireConversationAccess(transaction, scope, conversationId);
      return this.conversationView(transaction, conversation, member.id);
    });
  }

  createConversation(scope: WorkspaceScope, input: {
    title?: string;
    kind: ConversationKind;
    projectId?: string;
    parentConversationId?: string;
  }) {
    return this.database.withOrganization(scope.organizationId, async (transaction) => {
      const member = await requireWorkspaceMember(transaction, scope);
      let projectId = input.projectId;
      if (input.parentConversationId) {
        const { conversation: parent } = await requireConversationAccess(transaction, scope, input.parentConversationId);
        if (projectId && projectId !== parent.projectId) {
          throw new WorkspaceAccessError("Topic conversation must remain in its parent project.");
        }
        projectId = parent.projectId ?? undefined;
      }
      if (projectId) await requireProjectAccessForMember(transaction, scope.organizationId, member.id, projectId, "share");
      const [conversation] = await transaction.insert(conversations).values({
        organizationId: scope.organizationId,
        ownerMemberId: member.id,
        title: input.title,
        kind: input.kind,
        projectId,
        parentConversationId: input.parentConversationId,
      }).returning();
      if (!conversation) throw new Error("Failed to create the conversation.");
      return this.conversationView(transaction, conversation, member.id);
    });
  }

  updateConversation(scope: WorkspaceScope, conversationId: string, input: { title?: string }) {
    return this.database.withOrganization(scope.organizationId, async (transaction) => {
      const { member, conversation, canManage } = await requireConversationAccess(transaction, scope, conversationId, { lock: "update" });
      if (!canManage) throw new WorkspaceAccessError("Conversation not found or access denied.");
      const [updated] = await transaction.update(conversations).set({
        ...(input.title === undefined ? {} : { title: input.title }),
        updatedAt: new Date(),
      }).where(and(
        eq(conversations.organizationId, scope.organizationId),
        eq(conversations.id, conversation.id),
      )).returning();
      if (!updated) throw new WorkspaceAccessError("Conversation not found or access denied.");
      return this.conversationView(transaction, updated, member.id);
    });
  }

  shareConversation(scope: WorkspaceScope, conversationId: string, recipientMemberId: string) {
    return this.database.withOrganization(scope.organizationId, async (transaction) => {
      const { member, conversation, canManage } = await requireConversationAccess(transaction, scope, conversationId, { lock: "update" });
      if (!canManage) throw new WorkspaceAccessError("Conversation not found or access denied.");
      const [recipient] = await transaction.select({ id: members.id }).from(members).where(and(
        eq(members.organizationId, scope.organizationId),
        eq(members.id, recipientMemberId),
      )).limit(1);
      if (!recipient || recipient.id === member.id) throw new WorkspaceAccessError("Conversation recipient not found or access denied.");
      if (conversation.projectId) {
        await requireProjectAccessForMember(transaction, scope.organizationId, recipient.id, conversation.projectId, "share");
      }
      const added = await transaction.insert(conversationGrants).values({
        organizationId: scope.organizationId,
        conversationId: conversation.id,
        memberId: recipient.id,
      }).onConflictDoNothing().returning({ memberId: conversationGrants.memberId });
      if (added.length > 0) {
        await rotateConversationMemoryEpoch(transaction, scope.organizationId, conversation.id);
      }
      return this.conversationView(transaction, conversation, member.id);
    });
  }

  revokeConversation(scope: WorkspaceScope, conversationId: string, recipientMemberId: string) {
    return this.database.withOrganization(scope.organizationId, async (transaction) => {
      const { member, conversation, canManage } = await requireConversationAccess(transaction, scope, conversationId, { lock: "update" });
      if (!canManage || recipientMemberId === member.id) throw new WorkspaceAccessError("Conversation recipient not found or access denied.");
      const removed = await transaction.delete(conversationGrants).where(and(
        eq(conversationGrants.organizationId, scope.organizationId),
        eq(conversationGrants.conversationId, conversation.id),
        eq(conversationGrants.memberId, recipientMemberId),
      )).returning({ memberId: conversationGrants.memberId });
      if (removed.length > 0) {
        await rotateConversationMemoryEpoch(transaction, scope.organizationId, conversation.id);
      }
      return this.conversationView(transaction, conversation, member.id);
    });
  }

  revokeConversationMember(scope: WorkspaceScope, conversationId: string, recipientMemberId: string) {
    return this.revokeConversation(scope, conversationId, recipientMemberId);
  }

  listMessages(scope: WorkspaceScope, conversationId: string) {
    return this.database.withOrganization(scope.organizationId, async (transaction) => {
      await requireConversationAccess(transaction, scope, conversationId);
      return transaction.select().from(messages).where(and(
        eq(messages.organizationId, scope.organizationId),
        eq(messages.conversationId, conversationId),
      )).orderBy(asc(messages.createdAt), asc(messages.id));
    });
  }

  getMission(scope: WorkspaceScope, conversationId: string) {
    return this.database.withOrganization(scope.organizationId, async (transaction) => {
      const { conversation } = await requireConversationAccess(transaction, scope, conversationId);
      const [mission] = await transaction.select().from(missions).where(and(
        eq(missions.organizationId, scope.organizationId),
        eq(missions.conversationId, conversation.id),
      )).orderBy(desc(missions.createdAt), desc(missions.id)).limit(1);
      return mission;
    });
  }
}
