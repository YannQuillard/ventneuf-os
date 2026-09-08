import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { ClaudeModel, MissionAuthority, MissionExecutionPreferences, ReasoningEffort, RunnerExecutionHarnesses } from "@ventneuf/domain";
import type { Database } from "./client.js";
import { requireConversationAccess, requireProjectAccess, currentScopeForMission, requireCurrentMissionMemoryScope, WorkspaceAccessError } from "./workspace-access.js";
import { publicApproval } from "./mission-approvals.js";
import { repositoriesMatch } from "./repository-identity.js";
import { conversations, devices, members, messages, missionApprovals, missionEvents, missions, organizations, projects, projectMembers, projectRepositories } from "./schema.js";

export type DelegatedRunnerAdapter = "repository-check" | "orca-review" | "codex-development" | "claude-development";
const developmentAuthorityMs = 2 * 60 * 60_000;

function developmentAuthority(expiresAt: Date): MissionAuthority {
  return {
    version: 1,
    expiresAt: expiresAt.toISOString(),
    actions: {
      "repository.write": "allow",
      "development.command": "hermes",
      "network.access": "hermes",
      "pull_request.create": "hermes",
      "pull_request.merge": "human",
      "deployment.apply": "human",
      "connector.write": "hermes",
    },
  };
}

export interface HermesDispatchScope {
  organizationId: string;
  parentMissionId: string;
  conversationId: string;
  memberId: string;
  targets: Array<{
    deviceId: string;
    repositoryId: string;
    projectId?: string;
    projectName?: string;
    adapters: DelegatedRunnerAdapter[];
    codexModels?: string[];
    claudeModels?: ClaudeModel[];
  }>;
}

function repositorySupports(
  repository: {
    id: string;
    orcaReview?: boolean;
  },
  harnesses: RunnerExecutionHarnesses,
  repositoryId: string,
  adapter: DelegatedRunnerAdapter,
  model?: string,
) {
  return repository.id === repositoryId
    && (adapter !== "orca-review" || repository.orcaReview === true)
    && (adapter !== "codex-development" || (harnesses.codex !== undefined
      && (model === undefined ? !harnesses.codex.models?.length : harnesses.codex.models?.includes(model) === true)))
    && (adapter !== "claude-development" || (harnesses.claude !== undefined
      && model !== undefined && (harnesses.claude.models as readonly string[]).includes(model)))
    && (!adapter.endsWith("development") ? model === undefined : true);
}

export class ConversationRuntimeRepository {
  constructor(private readonly database: Database) {}

  ensureOrganization(input: { id: string; slug: string; name: string }) {
    return this.database.withOrganization(input.id, (transaction) =>
      transaction.insert(organizations).values(input).onConflictDoNothing(),
    );
  }

  enqueuePrivateMessage(input: {
    organizationId: string;
    externalSubject: string;
    content: string;
    contextId?: string;
    conversationId?: string;
    runner?: { deviceId: string; repositoryId: string; adapter?: DelegatedRunnerAdapter; model?: string;
      reasoningEffort?: ReasoningEffort; subagents?: MissionExecutionPreferences["subagents"] };
    execution?: MissionExecutionPreferences;
  }) {
    const acceptedAt = new Date();
    return this.database.withOrganization(input.organizationId, async (transaction) => {
      let [member] = await transaction
        .select()
        .from(members)
        .where(
          and(
            eq(members.organizationId, input.organizationId),
            eq(members.externalSubject, input.externalSubject),
          ),
        )
        .limit(1);

      if (!member) {
        [member] = await transaction
          .insert(members)
          .values({
            organizationId: input.organizationId,
            externalSubject: input.externalSubject,
            handle: input.externalSubject,
            displayName: "Member",
          })
          .onConflictDoNothing()
          .returning();
      }

      if (!member) {
        [member] = await transaction
          .select()
          .from(members)
          .where(
            and(
              eq(members.organizationId, input.organizationId),
              eq(members.externalSubject, input.externalSubject),
            ),
          )
          .limit(1);
      }
      if (!member) throw new Error("Failed to resolve the authenticated member.");

      // Keep concurrent submissions in the same private conversation.
      await transaction.select({ id: members.id }).from(members).where(and(
        eq(members.organizationId, input.organizationId), eq(members.id, member.id),
      )).for("update");

      if (input.runner) {
        const [device] = await transaction.select().from(devices).where(and(
          eq(devices.organizationId, input.organizationId),
          eq(devices.id, input.runner.deviceId),
          eq(devices.memberId, member.id),
          isNull(devices.revokedAt),
        )).for("share").limit(1);
        if (!device?.repositories.some((repository) => repositorySupports(
          repository,
          device.executionHarnesses,
          input.runner!.repositoryId,
          input.runner!.adapter ?? "repository-check",
          input.runner!.model,
        ))) {
          throw new RunnerAssignmentError();
        }
      }

      const authorized = input.conversationId
        ? await requireConversationAccess(transaction, input, input.conversationId)
        : undefined;
      let conversation = authorized?.conversation;
      if (!conversation) {
        [conversation] = await transaction
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.organizationId, input.organizationId),
            eq(conversations.ownerMemberId, member.id),
            eq(conversations.isPrimary, true),
          ),
        )
        .orderBy(asc(conversations.createdAt))
        .limit(1);

      }

      if (input.contextId !== undefined && conversation?.hermesContextId !== input.contextId) {
        throw new Error("The private conversation context is unavailable.");
      }

      if (!conversation) {
        [conversation] = await transaction
          .insert(conversations)
          .values({ organizationId: input.organizationId, ownerMemberId: member.id, title: "Hermes", isPrimary: true })
          .returning();
      }
      if (!conversation) throw new Error("Failed to resolve the private conversation.");

      const [message] = await transaction
        .insert(messages)
        .values({
          organizationId: input.organizationId,
          conversationId: conversation.id,
          memberId: member.id,
          role: "user",
          content: input.content,
          createdAt: acceptedAt,
        })
        .returning();
      if (!message) throw new Error("Failed to persist the message.");

      const [mission] = await transaction
        .insert(missions)
        .values({
          organizationId: input.organizationId,
          conversationId: conversation.id,
          projectId: conversation.projectId,
          requestedByMemberId: member.id,
          goal: input.content,
          assignedDeviceId: input.runner?.deviceId,
          context: {
            sourceMessageId: message.id,
            ...(input.conversationId ? { workspaceVersion: 1, projectId: conversation.projectId } : {}),
            type: input.runner ? `runner.${input.runner.adapter ?? "repository-check"}` : "hermes.conversation",
            ...(input.runner ? { repositoryId: input.runner.repositoryId } : {}),
            ...(input.runner?.adapter === "codex-development" ? {
              agent: { adapter: "codex", model: input.runner.model, reasoningEffort: input.runner.reasoningEffort,
                subagents: input.runner.subagents },
              authority: developmentAuthority(new Date(acceptedAt.getTime() + developmentAuthorityMs)),
            } : input.runner?.adapter === "claude-development" ? {
              agent: { adapter: "claude", model: input.runner.model, reasoningEffort: input.runner.reasoningEffort,
                subagents: input.runner.subagents },
              authority: developmentAuthority(new Date(acceptedAt.getTime() + developmentAuthorityMs)),
            } : {}),
            timing: { acceptedAt: acceptedAt.toISOString() },
            ...(input.execution ? { execution: input.execution } : {}),
          },
          createdAt: acceptedAt,
          updatedAt: acceptedAt,
        })
        .returning();
      if (!mission) throw new Error("Failed to create the Hermes mission.");

      return { conversationId: conversation.id, message, mission };
    });
  }

  listPrivateMessages(input: { organizationId: string; externalSubject: string }) {
    return this.database.withOrganization(input.organizationId, async (transaction) => {
      const [member] = await transaction
        .select({ id: members.id })
        .from(members)
        .where(
          and(
            eq(members.organizationId, input.organizationId),
            eq(members.externalSubject, input.externalSubject),
          ),
        )
        .limit(1);
      if (!member) return [];

      const [conversation] = await transaction
        .select({ id: conversations.id })
        .from(conversations)
        .where(
          and(
            eq(conversations.organizationId, input.organizationId),
            eq(conversations.ownerMemberId, member.id),
            eq(conversations.isPrimary, true),
          ),
        )
        .orderBy(asc(conversations.createdAt))
        .limit(1);
      if (!conversation) return [];

      return transaction
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.organizationId, input.organizationId),
            eq(messages.conversationId, conversation.id),
          ),
        )
        .orderBy(asc(messages.createdAt), asc(messages.id));
    });
  }

  getOwnedConversationMission(input: { organizationId: string; externalSubject: string; conversationId: string; missionId: string }) {
    return this.database.withOrganization(input.organizationId, async transaction => {
      const { member } = await requireConversationAccess(transaction, input, input.conversationId);
      const [mission] = await transaction.select().from(missions).where(and(
        eq(missions.organizationId, input.organizationId), eq(missions.id, input.missionId),
        eq(missions.conversationId, input.conversationId), eq(missions.requestedByMemberId, member.id),
      )).limit(1);
      if (!mission) throw new WorkspaceAccessError();
      return mission;
    });
  }

  getConversationSnapshot(input: { organizationId: string; externalSubject: string; conversationId: string }) {
    return this.database.withOrganization(input.organizationId, async (transaction) => {
      const { member } = await requireConversationAccess(transaction, input, input.conversationId);
      const rows = await transaction.select({ message: messages, memberName: members.displayName }).from(messages)
        .leftJoin(members, and(eq(members.organizationId, messages.organizationId), eq(members.id, messages.memberId)))
        .where(and(eq(messages.organizationId, input.organizationId), eq(messages.conversationId, input.conversationId)))
        .orderBy(asc(messages.createdAt), asc(messages.id));
      const items = rows.map(({ message, memberName }) => ({ ...message, memberName }));
      const [latest] = await transaction.select().from(missions).where(and(
        eq(missions.organizationId, input.organizationId), eq(missions.conversationId, input.conversationId),
        sql`coalesce(${missions.context}->>'type', '') <> 'hermes.approval'`,
      )).orderBy(desc(missions.createdAt)).limit(1);
      const [execution] = await transaction.select().from(missions).where(and(
        eq(missions.organizationId, input.organizationId), eq(missions.conversationId, input.conversationId),
        sql`${missions.context}->>'type' in ('runner.codex-development', 'runner.claude-development')`,
      )).orderBy(desc(missions.createdAt)).limit(1);
      const events = latest ? await transaction.select().from(missionEvents).where(and(
        eq(missionEvents.organizationId, input.organizationId), eq(missionEvents.missionId, latest.id),
      )).orderBy(asc(missionEvents.occurredAt), asc(missionEvents.id)) : [];
      const [activity] = execution ? await transaction.select().from(missionEvents).where(and(
        eq(missionEvents.organizationId, input.organizationId), eq(missionEvents.missionId, execution.id),
        eq(missionEvents.id, execution.id), eq(missionEvents.type, "runner.execution"),
      )).limit(1) : [];
      const approvals = await transaction.select({ approval: missionApprovals, requestedByMemberId: missions.requestedByMemberId })
        .from(missionApprovals).innerJoin(missions, and(
          eq(missions.organizationId, missionApprovals.organizationId), eq(missions.id, missionApprovals.missionId),
        )).where(and(eq(missionApprovals.organizationId, input.organizationId),
          eq(missions.conversationId, input.conversationId))).orderBy(desc(missionApprovals.createdAt)).limit(20);
      return {
        messages: items,
        mission: latest ? { id: latest.id, status: latest.status, timing: latest.context.timing ?? {},
          failure: latest.context.failure, canManage: latest.requestedByMemberId === member.id } : null,
        events: events.filter(event => event.type !== "runner.execution"),
        approvals: approvals.map(({ approval, requestedByMemberId }) => ({ ...publicApproval(approval),
          canDecide: requestedByMemberId === member.id && approval.route === "human" })),
        agentExecution: execution ? {
          missionId: execution.id, status: execution.status, title: execution.goal,
          provider: execution.context.type === "runner.claude-development" ? "claude" : "codex",
          repositoryId: execution.context.repositoryId,
          model: (execution.context.agent as { model?: string } | undefined)?.model,
          result: execution.context.result,
          receivedAt: activity?.occurredAt.toISOString(), snapshot: activity?.payload.snapshot ?? null,
          canManage: execution.requestedByMemberId === member.id,
        } : null,
      };
    });
  }

  getPrivateAgentExecution(input: { organizationId: string; externalSubject: string }) {
    return this.database.withOrganization(input.organizationId, async (transaction) => {
      const [result] = await transaction.select({ id: missions.id, status: missions.status, goal: missions.goal, context: missions.context,
        snapshot: missionEvents.payload, occurredAt: missionEvents.occurredAt,
      }).from(missions).innerJoin(members, and(eq(members.organizationId, missions.organizationId),
        eq(members.id, missions.requestedByMemberId)))
        .innerJoin(conversations, and(eq(conversations.organizationId, missions.organizationId),
          eq(conversations.id, missions.conversationId), eq(conversations.isPrimary, true)))
        .leftJoin(missionEvents, and(eq(missionEvents.organizationId, missions.organizationId),
          eq(missionEvents.missionId, missions.id), eq(missionEvents.id, missions.id), eq(missionEvents.type, "runner.execution")))
        .where(and(eq(missions.organizationId, input.organizationId), eq(members.externalSubject, input.externalSubject),
          sql`${missions.context}->>'type' in ('runner.codex-development', 'runner.claude-development')`))
        .orderBy(desc(missions.createdAt)).limit(1);
      return result ? { missionId: result.id, status: result.status, title: result.goal,
        provider: result.context.type === "runner.claude-development" ? "claude" : "codex",
        repositoryId: typeof result.context.repositoryId === "string" ? result.context.repositoryId : undefined,
        model: typeof (result.context.agent as { model?: unknown } | undefined)?.model === "string"
          ? (result.context.agent as { model: string }).model : undefined,
        result: typeof result.context.result === "string" ? result.context.result : undefined,
        receivedAt: result.occurredAt?.toISOString(),
        snapshot: result.snapshot?.snapshot ?? null } : null;
    });
  }

  getLatestPrivateMission(input: { organizationId: string; externalSubject: string }) {
    return this.database.withOrganization(input.organizationId, async (transaction) => {
      const [result] = await transaction
        .select({ mission: missions })
        .from(missions)
        .innerJoin(
          members,
          and(
            eq(members.organizationId, missions.organizationId),
            eq(members.id, missions.requestedByMemberId),
          ),
        )
        .innerJoin(conversations, and(eq(conversations.organizationId, missions.organizationId),
          eq(conversations.id, missions.conversationId), eq(conversations.isPrimary, true)))
        .where(
          and(
            eq(missions.organizationId, input.organizationId),
            eq(members.externalSubject, input.externalSubject),
            sql`coalesce(${missions.context}->>'type', '') <> 'hermes.approval'`,
          ),
        )
        .orderBy(desc(missions.createdAt))
        .limit(1);
      return result?.mission;
    });
  }

  getMission(organizationId: string, missionId: string) {
    return this.database.withOrganization(organizationId, async (transaction) => {
      const [result] = await transaction
        .select({
          mission: missions,
          hermesContextId: conversations.hermesContextId,
        })
        .from(missions)
        .innerJoin(
          conversations,
          and(
            eq(conversations.organizationId, missions.organizationId),
            eq(conversations.id, missions.conversationId),
          ),
        )
        .where(
          and(eq(missions.organizationId, organizationId), eq(missions.id, missionId)),
        )
        .limit(1);
      return result;
    });
  }

  getHermesMemoryScope(organizationId: string, missionId: string) {
    return this.database.withOrganization(organizationId, async transaction => {
      const [actor] = await transaction.select({ externalSubject: members.externalSubject }).from(missions)
        .innerJoin(members, and(eq(members.organizationId, missions.organizationId), eq(members.id, missions.requestedByMemberId)))
        .where(and(eq(missions.organizationId, organizationId), eq(missions.id, missionId))).limit(1);
      if (!actor) throw new WorkspaceAccessError();
      const result = await currentScopeForMission(transaction, { organizationId, externalSubject: actor.externalSubject }, missionId);
      return { ...result.hermesMemoryScope, cancelled: result.mission.status === "cancelled" };
    });
  }

  async canProcessConversationMission(organizationId: string, missionId: string) {
    try {
      return await this.database.withOrganization(organizationId, async transaction => {
        const [record] = await transaction.select({ mission: missions, actor: members }).from(missions)
          .innerJoin(members, and(eq(members.organizationId, missions.organizationId), eq(members.id, missions.requestedByMemberId)))
          .where(and(eq(missions.organizationId, organizationId), eq(missions.id, missionId))).limit(1);
        if (!record) return false;
        await requireConversationAccess(transaction, { organizationId, externalSubject: record.actor.externalSubject }, record.mission.conversationId);
        return true;
      });
    } catch (error) {
      if (error instanceof WorkspaceAccessError) return false;
      throw error;
    }
  }

  getMissionConversationContext(organizationId: string, missionId: string) {
    return this.database.withOrganization(organizationId, async transaction => {
      const [record] = await transaction.select({ mission: missions, actor: members }).from(missions)
        .innerJoin(members, and(eq(members.organizationId, missions.organizationId), eq(members.id, missions.requestedByMemberId)))
        .where(and(eq(missions.organizationId, organizationId), eq(missions.id, missionId))).limit(1);
      if (!record) throw new WorkspaceAccessError();
      const scope = { organizationId, externalSubject: record.actor.externalSubject };
      const { conversation } = await requireConversationAccess(transaction, scope, record.mission.conversationId);
      const project = conversation.projectId
        ? (await requireProjectAccess(transaction, scope, conversation.projectId)).project : undefined;
      const history = await transaction.select({ role: messages.role, content: messages.content, memberId: messages.memberId }).from(messages)
        .where(and(eq(messages.organizationId, organizationId), eq(messages.conversationId, conversation.id),
          sql`${messages.id}::text <> ${String(record.mission.context.sourceMessageId ?? "")}`))
        .orderBy(desc(messages.createdAt), desc(messages.id)).limit(30);
      let remaining = 30_000;
      const boundedHistory = history.flatMap(message => {
        if (remaining <= 0) return [];
        const content = message.content.slice(0, Math.min(6_000, remaining));
        remaining -= content.length;
        return [{ ...message, content, truncated: content.length < message.content.length }];
      }).reverse();
      const [execution] = await transaction.select({ id: missions.id, status: missions.status, goal: missions.goal }).from(missions)
        .where(and(eq(missions.organizationId, organizationId), eq(missions.conversationId, conversation.id),
          sql`${missions.context}->>'type' like 'runner.%'`)).orderBy(desc(missions.createdAt)).limit(1);
      const approvals = await transaction.select({ approval: missionApprovals }).from(missionApprovals)
        .innerJoin(missions, and(eq(missions.organizationId, missionApprovals.organizationId), eq(missions.id, missionApprovals.missionId)))
        .where(and(eq(missionApprovals.organizationId, organizationId), eq(missions.conversationId, conversation.id),
          eq(missionApprovals.status, "pending"))).limit(10);
      return { conversationId: conversation.id, title: conversation.title,
        requestingMember: { id: record.actor.id, name: record.actor.displayName },
        project: project ? { id: project.id, name: project.name, context: project.context } : undefined,
        history: boundedHistory, execution, pendingApprovals: approvals.map(({ approval }) => publicApproval(approval)) };
    });
  }

  getHermesDispatchScope(organizationId: string, missionId: string) {
    return this.database.withOrganization(organizationId, async (transaction) => {
      const [result] = await transaction
        .select({
          mission: missions,
          ownerMemberId: conversations.ownerMemberId,
          projectId: conversations.projectId,
        })
        .from(missions)
        .innerJoin(conversations, and(
          eq(conversations.organizationId, missions.organizationId),
          eq(conversations.id, missions.conversationId),
        ))
        .where(and(eq(missions.organizationId, organizationId), eq(missions.id, missionId)))
        .limit(1);
      const mission = result?.mission;
      if (!mission || !["running", "waiting_for_approval"].includes(mission.status)
        || mission.context?.type !== "hermes.conversation") return undefined;
      if (mission.context.workspaceVersion === 1) {
        const [actor] = await transaction.select().from(members).where(and(
          eq(members.organizationId, organizationId), eq(members.id, mission.requestedByMemberId),
        )).limit(1);
        if (!actor) return undefined;
        await requireConversationAccess(transaction, { organizationId, externalSubject: actor.externalSubject }, mission.conversationId);
      } else if (result.ownerMemberId !== mission.requestedByMemberId) return undefined;

      const ownedDevices = await transaction
        .select({ id: devices.id, repositories: devices.repositories, executionHarnesses: devices.executionHarnesses })
        .from(devices)
        .where(and(
          eq(devices.organizationId, organizationId),
          eq(devices.memberId, mission.requestedByMemberId),
          isNull(devices.revokedAt),
        ));
      let targets: HermesDispatchScope["targets"] = ownedDevices.flatMap((device) => device.repositories.map((repository) => {
        const codexModels = device.executionHarnesses.codex?.models;
        const claudeModels = device.executionHarnesses.claude?.models;
        return {
          deviceId: device.id,
          repositoryId: repository.id,
          adapters: [
            "repository-check" as const,
            ...(repository.orcaReview ? ["orca-review" as const] : []),
            ...(device.executionHarnesses.codex ? ["codex-development" as const] : []),
            ...(device.executionHarnesses.claude ? ["claude-development" as const] : []),
          ],
          ...(claudeModels?.length ? { claudeModels } : {}),
          ...(codexModels?.length ? { codexModels } : {}),
        };
      }));
      if (mission.context.workspaceVersion === 1) {
        const associations = await transaction.select({ association: projectRepositories, project: projects, device: devices })
          .from(projectRepositories)
          .innerJoin(projects, and(eq(projects.organizationId, projectRepositories.organizationId), eq(projects.id, projectRepositories.projectId)))
          .innerJoin(devices, and(eq(devices.organizationId, projectRepositories.organizationId), eq(devices.id, projectRepositories.deviceId), isNull(devices.revokedAt)))
          .leftJoin(projectMembers, and(eq(projectMembers.organizationId, projects.organizationId), eq(projectMembers.projectId, projects.id), eq(projectMembers.memberId, mission.requestedByMemberId)))
          .where(and(eq(projects.organizationId, organizationId),
            or(eq(projects.ownerMemberId, mission.requestedByMemberId), eq(projectMembers.memberId, mission.requestedByMemberId)),
            result.projectId ? eq(projects.id, result.projectId) : undefined));
        const seen = new Set<string>();
        targets = associations.flatMap(({ association, project, device }) => {
          const associatedRepository = device.repositories.find(repository => repository.id === association.repositoryId);
          if (!associatedRepository) return [];
          return ownedDevices.flatMap((ownedDevice) => ownedDevice.repositories.flatMap((repository) => {
            if (!repositoriesMatch(associatedRepository, repository)) return [];
            const key = `${project.id}\u0000${ownedDevice.id}\u0000${repository.id}`;
            if (seen.has(key)) return [];
            seen.add(key);
            const codexModels = ownedDevice.executionHarnesses.codex?.models;
            const claudeModels = ownedDevice.executionHarnesses.claude?.models;
            return [{ deviceId: ownedDevice.id, repositoryId: repository.id, projectId: project.id, projectName: project.name,
              adapters: ["repository-check" as const, ...(repository.orcaReview ? ["orca-review" as const] : []),
                ...(ownedDevice.executionHarnesses.codex ? ["codex-development" as const] : []),
                ...(ownedDevice.executionHarnesses.claude ? ["claude-development" as const] : [])],
              ...(claudeModels?.length ? { claudeModels } : {}),
              ...(codexModels?.length ? { codexModels } : {}),
            }];
          }));
        });
      }
      if (targets.length > 50) throw new Error("The mission has too many runner targets to delegate.");
      return {
        organizationId,
        parentMissionId: mission.id,
        conversationId: mission.conversationId,
        memberId: mission.requestedByMemberId,
        targets,
      } satisfies HermesDispatchScope;
    });
  }

  enqueueDelegatedRunnerMission(input: {
    organizationId: string;
    parentMissionId: string;
    conversationId: string;
    memberId: string;
    serviceId: string;
    delegationId: string;
    requestId: string;
    expiresAt: Date;
    objective: string;
    deviceId: string;
    repositoryId: string;
    projectId?: string;
    adapter: DelegatedRunnerAdapter;
    model?: string;
    reasoningEffort?: ReasoningEffort;
    subagents?: MissionExecutionPreferences["subagents"];
  }) {
    const acceptedAt = new Date();
    return this.database.withOrganization(input.organizationId, async (transaction) => {
      const [parent] = await transaction.select().from(missions).where(and(
        eq(missions.organizationId, input.organizationId),
        eq(missions.id, input.parentMissionId),
      )).for("update").limit(1);
      if (!parent || !["running", "waiting_for_approval"].includes(parent.status)
        || parent.context?.type !== "hermes.conversation"
        || parent.conversationId !== input.conversationId
        || parent.requestedByMemberId !== input.memberId
        || input.expiresAt <= acceptedAt) throw new DelegatedMissionError();

      if (typeof parent.context.hermesScopeId === "string") {
        await requireCurrentMissionMemoryScope(transaction, { organizationId: input.organizationId,
          missionId: parent.id, expectedScopeId: parent.context.hermesScopeId });
      }
      const [conversation] = await transaction.select()
        .from(conversations).where(and(
          eq(conversations.organizationId, input.organizationId),
          eq(conversations.id, input.conversationId),
        )).limit(1);
      if (!conversation) throw new DelegatedMissionError();
      if (parent.context.workspaceVersion === 1) {
        const [actor] = await transaction.select().from(members).where(and(
          eq(members.organizationId, input.organizationId), eq(members.id, input.memberId),
        )).limit(1);
        if (!actor) throw new DelegatedMissionError();
        await requireConversationAccess(transaction, { organizationId: input.organizationId, externalSubject: actor.externalSubject }, conversation.id);
      } else if (conversation.ownerMemberId !== input.memberId) throw new DelegatedMissionError();

      const [existing] = await transaction.select().from(missions).where(and(
        eq(missions.organizationId, input.organizationId),
        sql`${missions.context}->>'parentMissionId' = ${input.parentMissionId}`,
        sql`${missions.context}->'delegation'->>'id' = ${input.delegationId}`,
        sql`${missions.context}->'delegation'->>'requestId' = ${input.requestId}`,
      )).limit(1);
      if (existing) {
        const existingAgent = existing.context?.agent as { model?: unknown; subagents?: unknown } | undefined;
        if (existing.goal !== input.objective || existing.assignedDeviceId !== input.deviceId
          || existing.context?.repositoryId !== input.repositoryId
          || existing.context?.type !== `runner.${input.adapter}`
          || existing.projectId !== (input.projectId ?? null)
          || existingAgent?.model !== input.model
          || JSON.stringify(existingAgent?.subagents) !== JSON.stringify(input.subagents)) throw new DelegatedMissionError();
        return { conversationId: existing.conversationId, mission: existing };
      }

      const workspaceMission = parent.context.workspaceVersion === 1;
      if (workspaceMission && !input.projectId) throw new DelegatedMissionError();
      const [device] = await transaction.select().from(devices).where(and(
        eq(devices.organizationId, input.organizationId),
        eq(devices.id, input.deviceId),
        eq(devices.memberId, input.memberId),
        isNull(devices.revokedAt),
      )).for("share").limit(1);
      const targetRepository = device?.repositories.find((repository) => repositorySupports(
        repository,
        device.executionHarnesses,
        input.repositoryId,
        input.adapter,
        input.model,
      ));
      if (!device || !targetRepository) throw new DelegatedMissionError();

      if (input.projectId) {
        const [actor] = await transaction.select().from(members).where(and(
          eq(members.organizationId, input.organizationId), eq(members.id, input.memberId),
        )).limit(1);
        if (!actor) throw new DelegatedMissionError();
        await requireProjectAccess(transaction, { organizationId: input.organizationId, externalSubject: actor.externalSubject }, input.projectId);
        if (conversation.projectId && conversation.projectId !== input.projectId) throw new DelegatedMissionError();
        const associations = await transaction.select({ association: projectRepositories, repositories: devices.repositories })
          .from(projectRepositories)
          .innerJoin(devices, and(
            eq(devices.organizationId, projectRepositories.organizationId),
            eq(devices.id, projectRepositories.deviceId),
            isNull(devices.revokedAt),
          ))
          .where(and(
            eq(projectRepositories.organizationId, input.organizationId),
            eq(projectRepositories.projectId, input.projectId),
          )).for("share");
        const authorized = associations.some(({ association, repositories }) => {
          const associatedRepository = repositories.find(({ id }) => id === association.repositoryId);
          return Boolean(associatedRepository && repositoriesMatch(associatedRepository, targetRepository));
        });
        if (!authorized) throw new DelegatedMissionError();
      }

      let missionConversationId = input.conversationId;
      if (workspaceMission) {
        const [previousExecution] = await transaction.select({ id: missions.id }).from(missions).where(and(
          eq(missions.organizationId, input.organizationId), eq(missions.conversationId, input.conversationId),
          sql`${missions.context}->>'type' like 'runner.%'`,
        )).limit(1);
        const [sharedDraft] = await transaction.select({ id: conversations.id }).from(conversations)
          .where(and(eq(conversations.id, input.conversationId), sql`exists (
            select 1 from conversation_grants g where g.organization_id = ${input.organizationId}::uuid
              and g.conversation_id = ${input.conversationId}::uuid)`)).limit(1);
        if (conversation.kind !== "mission" || conversation.ownerMemberId !== input.memberId || previousExecution || sharedDraft) {
          const [thread] = await transaction.insert(conversations).values({
            organizationId: input.organizationId, ownerMemberId: input.memberId, projectId: input.projectId,
            parentConversationId: input.conversationId, kind: "mission", title: input.objective.slice(0, 200),
          }).returning();
          if (!thread) throw new Error("Failed to create the mission thread.");
          missionConversationId = thread.id;
          await transaction.insert(messages).values({ organizationId: input.organizationId, conversationId: thread.id,
            memberId: input.memberId, role: "user", content: parent.goal,
            metadata: { sourceConversationId: input.conversationId, sourceMissionId: parent.id },
          });
        }
      }

      const [mission] = await transaction.insert(missions).values({
        organizationId: input.organizationId,
        conversationId: missionConversationId,
        projectId: input.projectId,
        requestedByMemberId: input.memberId,
        assignedDeviceId: input.deviceId,
        goal: input.objective,
        context: {
          type: `runner.${input.adapter}`,
          repositoryId: input.repositoryId,
          ...(workspaceMission ? { workspaceVersion: 1, projectId: input.projectId, sourceConversationId: input.conversationId } : {}),
          parentMissionId: input.parentMissionId,
          delegation: {
            id: input.delegationId,
            requestId: input.requestId,
            serviceId: input.serviceId,
            capability: "mission:dispatch",
            expiresAt: input.expiresAt.toISOString(),
          },
          ...(input.adapter === "codex-development" ? {
            agent: { adapter: "codex", model: input.model, reasoningEffort: input.reasoningEffort,
              subagents: input.subagents },
            authority: developmentAuthority(new Date(acceptedAt.getTime() + developmentAuthorityMs)),
          } : input.adapter === "claude-development" ? {
            agent: { adapter: "claude", model: input.model, reasoningEffort: input.reasoningEffort,
              subagents: input.subagents },
            authority: developmentAuthority(new Date(acceptedAt.getTime() + developmentAuthorityMs)),
          } : {}),
          timing: { acceptedAt: acceptedAt.toISOString() },
        },
        createdAt: acceptedAt,
        updatedAt: acceptedAt,
      }).returning();
      if (!mission) throw new Error("Failed to create the delegated runner mission.");
      if (workspaceMission) {
        await transaction.update(conversations).set({ missionId: mission.id, updatedAt: acceptedAt }).where(and(
          eq(conversations.organizationId, input.organizationId), eq(conversations.id, missionConversationId),
        ));
      }
      await transaction.insert(missionEvents).values([
        {
          organizationId: input.organizationId,
          missionId: input.parentMissionId,
          type: "mission.child_dispatched",
          payload: {
            childMissionId: mission.id,
            conversationId: missionConversationId,
            ...(input.projectId ? { projectId: input.projectId } : {}),
            serviceId: input.serviceId,
            delegationId: input.delegationId,
            requestId: input.requestId,
          },
          occurredAt: acceptedAt,
        },
        {
          organizationId: input.organizationId,
          missionId: mission.id,
          type: "mission.delegated",
          payload: {
            parentMissionId: input.parentMissionId,
            serviceId: input.serviceId,
            delegationId: input.delegationId,
            requestId: input.requestId,
          },
          occurredAt: acceptedAt,
        },
      ]);
      return { conversationId: missionConversationId, mission };
    });
  }

  setMissionQueued(organizationId: string, missionId: string, context: Record<string, unknown>) {
    return this.database.withOrganization(organizationId, (transaction) =>
      transaction.update(missions).set({ context, updatedAt: new Date() }).where(and(
        eq(missions.organizationId, organizationId), eq(missions.id, missionId),
        eq(missions.status, "queued"),
      )),
    );
  }

  async setMissionRunning(organizationId: string, missionId: string, context: Record<string, unknown>) {
    const rows = await this.database.withOrganization(organizationId, async transaction => {
      if (typeof context.hermesScopeId === "string") {
        await requireCurrentMissionMemoryScope(transaction, { organizationId, missionId, expectedScopeId: context.hermesScopeId });
      }
      return transaction.update(missions).set({ status: "running", context, updatedAt: new Date() }).where(and(
        eq(missions.organizationId, organizationId), eq(missions.id, missionId),
        // Failed deliveries can be retried by SQS; cancellation and completion are final.
        inArray(missions.status, ["queued", "running", "waiting_for_approval", "failed"]),
      )).returning({ id: missions.id });
    });
    return rows.length > 0;
  }

  rememberCancelledHermesRun(organizationId: string, missionId: string, runId: string) {
    return this.database.withOrganization(organizationId, (transaction) =>
      transaction.update(missions).set({
        context: sql`coalesce(${missions.context}, '{}'::jsonb) || ${JSON.stringify({ hermesRunId: runId })}::jsonb`,
        updatedAt: new Date(),
      }).where(and(eq(missions.organizationId, organizationId), eq(missions.id, missionId),
        eq(missions.status, "cancelled"))),
    );
  }

  completeMission(input: {
    organizationId: string;
    missionId: string;
    conversationId: string;
    contextId: string;
    content: string;
    metadata?: Record<string, unknown>;
    context: Record<string, unknown>;
  }) {
    return this.database.withOrganization(input.organizationId, async (transaction) => {
      if (typeof input.context.hermesScopeId === "string") {
        await requireCurrentMissionMemoryScope(transaction, { organizationId: input.organizationId,
          missionId: input.missionId, expectedScopeId: input.context.hermesScopeId });
      }
      const [completed] = await transaction
        .update(missions)
        .set({ status: "completed", context: input.context, updatedAt: new Date() })
        .where(
          and(
            eq(missions.organizationId, input.organizationId),
            eq(missions.id, input.missionId),
            inArray(missions.status, ["queued", "running", "waiting_for_approval"]),
          ),
        )
        .returning({ id: missions.id });
      if (!completed) return false;
      await transaction.insert(messages).values({
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        role: "assistant",
        content: input.content,
        metadata: input.metadata,
      });
      await transaction
        .update(conversations)
        .set({ hermesContextId: input.contextId, updatedAt: new Date() })
        .where(
          and(
            eq(conversations.organizationId, input.organizationId),
            eq(conversations.id, input.conversationId),
          ),
        );
      return true;
    });
  }

  cancelMission(
    organizationId: string,
    missionId: string,
    context: Record<string, unknown>,
  ) {
    return this.database.withOrganization(organizationId, async (transaction) => {
      const cancelledAt = new Date();
      const cancelled = await transaction.update(missions)
        .set({ status: "cancelled",
          context: sql`coalesce(${missions.context}, '{}'::jsonb) || ${JSON.stringify({ cancelledAt: context.cancelledAt ?? cancelledAt.toISOString() })}::jsonb`,
          updatedAt: cancelledAt })
        .where(and(
          eq(missions.organizationId, organizationId), eq(missions.id, missionId),
          inArray(missions.status, ["queued", "running", "waiting_for_approval"]),
        ))
        .returning({ id: missions.id, assignedDeviceId: missions.assignedDeviceId, context: missions.context });
      if (!cancelled[0]) return [];
      if (cancelled[0]?.assignedDeviceId) {
        await transaction.insert(missionEvents).values({ organizationId, missionId,
          type: "run.cancelled", payload: { executor: "runner" }, occurredAt: cancelledAt });
      }
      const cancelledApprovals = await transaction.update(missionApprovals).set({
        status: "cancelled",
        updatedAt: cancelledAt,
      }).where(and(
        eq(missionApprovals.organizationId, organizationId),
        eq(missionApprovals.missionId, missionId),
        inArray(missionApprovals.status, ["pending", "approved"]),
      )).returning({ id: missionApprovals.id });
      if (cancelledApprovals.length) {
        await transaction.insert(missionEvents).values(cancelledApprovals.map(({ id }) => ({
          organizationId,
          missionId,
          type: "approval.cancelled",
          payload: { approvalId: id, reason: "mission_cancelled" },
          occurredAt: cancelledAt,
        })));
      }
      const [escalated] = await transaction.update(missionApprovals).set({
        route: "human",
        updatedAt: cancelledAt,
      }).where(and(
        eq(missionApprovals.organizationId, organizationId),
        eq(missionApprovals.reviewMissionId, missionId),
        eq(missionApprovals.status, "pending"),
        eq(missionApprovals.route, "hermes"),
      )).returning({ id: missionApprovals.id, missionId: missionApprovals.missionId });
      if (escalated) {
        await transaction.insert(missionEvents).values({
          organizationId,
          missionId: escalated.missionId,
          type: "approval.escalated",
          payload: { approvalId: escalated.id, decision: "escalated", deciderType: "system", reason: "review_cancelled" },
          occurredAt: cancelledAt,
        });
      }
      return cancelled.map(({ id, context }) => ({ id, context }));
    });
  }

  appendMissionEvent(input: {
    organizationId: string;
    missionId: string;
    type: string;
    payload: Record<string, unknown>;
    occurredAt: Date;
    expectedScopeId?: string;
  }) {
    return this.database.withOrganization(input.organizationId, async transaction => {
      const { expectedScopeId, ...event } = input;
      if (expectedScopeId) await requireCurrentMissionMemoryScope(transaction, {
        organizationId: input.organizationId, missionId: input.missionId, expectedScopeId,
      });
      return transaction.insert(missionEvents).values(event).returning();
    });
  }

  listMissionEvents(organizationId: string, missionId: string) {
    return this.database.withOrganization(organizationId, (transaction) =>
      transaction
        .select()
        .from(missionEvents)
        .where(
          and(
            eq(missionEvents.organizationId, organizationId),
            eq(missionEvents.missionId, missionId),
          ),
        )
        .orderBy(asc(missionEvents.createdAt), asc(missionEvents.id)),
    );
  }

  failMission(
    organizationId: string,
    missionId: string,
    reason: string,
    context: Record<string, unknown>,
  ) {
    return this.database.withOrganization(organizationId, async transaction => {
      if (typeof context.hermesScopeId === "string") {
        await requireCurrentMissionMemoryScope(transaction, { organizationId, missionId, expectedScopeId: context.hermesScopeId });
      }
      return transaction.update(missions)
        .set({ status: "failed", context: { ...context, failure: reason }, updatedAt: new Date() })
        .where(and(eq(missions.organizationId, organizationId), eq(missions.id, missionId),
          inArray(missions.status, ["queued", "running", "waiting_for_approval", "failed"])));
    });
  }
}

export class RunnerAssignmentError extends Error {
  constructor() { super("The device or registered repository is unavailable."); }
}

export class DelegatedMissionError extends Error {
  constructor() { super("The delegated mission scope is unavailable."); }
}
