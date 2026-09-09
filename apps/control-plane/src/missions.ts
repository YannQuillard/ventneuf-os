import { assertAuthorized, claudeModelAliases, type AuthorizationContext, type MissionExecutionPreferences, type ReasoningEffort } from "@ventneuf/domain";
import type { ConversationRuntime } from "./runtime.js";
import type { MissionDelegationVerifier } from "./mission-delegation.js";
import { readStoredDispatchDelegation } from "./mission-delegation.js";

export type RunnerAdapter = "repository-check" | "orca-review" | "codex-development" | "claude-development";

export interface RunnerDispatch {
  deviceId: string;
  repositoryId: string;
  projectId?: string;
  adapter: RunnerAdapter;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  subagents?: MissionExecutionPreferences["subagents"];
  objective: string;
  delegationToken?: string;
  delegationId?: string;
  requestId?: string;
}

export async function dispatchRunnerMission(
  context: AuthorizationContext,
  runtime: Pick<ConversationRuntime, "repository">,
  input: RunnerDispatch,
  delegations?: MissionDelegationVerifier,
) {
  if ((input.adapter === "claude-development" && (!input.model || !(claudeModelAliases as readonly string[]).includes(input.model)))
    || (!input.adapter.endsWith("development") && (input.model !== undefined || input.reasoningEffort !== undefined || input.subagents !== undefined))) {
    throw new Error("Development model and sub-agent settings must match the selected native harness.");
  }
  if (context.principalType === "user") {
    assertAuthorized(context, "mission:create");
    if (input.projectId) throw new Error("Start a project mission from its Hermes conversation.");
    const queued = await runtime.repository.enqueuePrivateMessage({
      organizationId: context.organizationId,
      externalSubject: context.principalId,
      content: input.objective,
      runner: {
        deviceId: input.deviceId,
        repositoryId: input.repositoryId,
        adapter: input.adapter,
        model: input.model,
        ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
        ...(input.subagents ? { subagents: input.subagents } : {}),
      },
    });
    return {
      conversationId: queued.conversationId,
      missionId: queued.mission.id,
      status: queued.mission.status,
    };
  }

  assertAuthorized(context, "mission:dispatch");
  if (context.principalType !== "service" || !delegations
    || (!input.delegationToken && !input.delegationId) || !input.requestId) {
    throw new Error("Delegated runner dispatch requires a service principal and mission delegation.");
  }
  const claims = input.delegationId
    ? readStoredDispatchDelegation(await runtime.repository.getMissionDispatchDelegation({
      organizationId: context.organizationId, serviceId: context.principalId, delegationId: input.delegationId,
    }))
    : await delegations.verify(input.delegationToken!);
  if (claims.organizationId !== context.organizationId || claims.serviceId !== context.principalId
    || (input.delegationId !== undefined && claims.delegationId !== input.delegationId)
    || !("targets" in claims)
    || !claims.targets.some((target) => target.deviceId === input.deviceId
      && target.repositoryId === input.repositoryId
      && target.projectId === input.projectId
      && target.adapters.includes(input.adapter)
      && (input.adapter !== "claude-development" || (target.claudeModels as readonly string[] | undefined)?.includes(input.model ?? "") === true)
      && (input.adapter !== "codex-development" || (input.model === undefined
        ? !target.codexModels?.length : target.codexModels?.includes(input.model) === true))
      && (input.subagents === undefined || input.subagents.models.every(model => model === "inherit"
        || (input.adapter === "claude-development" ? (target.claudeModels as readonly string[] | undefined)?.includes(model) === true
          : target.codexModels?.includes(model) === true))))) {
    throw new Error("The requested runner target is outside the delegated mission scope.");
  }
  const queued = await runtime.repository.enqueueDelegatedRunnerMission({
    organizationId: claims.organizationId,
    parentMissionId: claims.parentMissionId,
    conversationId: claims.conversationId,
    memberId: claims.memberId,
    serviceId: claims.serviceId,
    delegationId: claims.delegationId,
    requestId: input.requestId,
    expiresAt: new Date(claims.expiresAt),
    objective: input.objective,
    deviceId: input.deviceId,
    repositoryId: input.repositoryId,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    adapter: input.adapter,
    model: input.model,
    ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
    ...(input.subagents ? { subagents: input.subagents } : {}),
  });
  return {
    conversationId: queued.conversationId,
    missionId: queued.mission.id,
    status: queued.mission.status,
  };
}
