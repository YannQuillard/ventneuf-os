import { assertAuthorized, type AuthorizationContext, type ClaudeModel } from "@ventneuf/domain";
import type { ConversationRuntime } from "./runtime.js";
import type { MissionDelegationVerifier } from "./mission-delegation.js";

export type RunnerAdapter = "repository-check" | "orca-review" | "codex-development" | "claude-development";

export interface RunnerDispatch {
  deviceId: string;
  repositoryId: string;
  projectId?: string;
  adapter: RunnerAdapter;
  model?: ClaudeModel;
  objective: string;
  delegationToken?: string;
  requestId?: string;
}

export async function dispatchRunnerMission(
  context: AuthorizationContext,
  runtime: Pick<ConversationRuntime, "repository">,
  input: RunnerDispatch,
  delegations?: MissionDelegationVerifier,
) {
  if ((input.adapter === "claude-development") !== (input.model !== undefined)) {
    throw new Error("Claude development missions require one explicit model; other adapters do not accept one.");
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
    || !input.delegationToken || !input.requestId) {
    throw new Error("Delegated runner dispatch requires a service principal and mission delegation.");
  }
  const claims = await delegations.verify(input.delegationToken);
  if (claims.organizationId !== context.organizationId || claims.serviceId !== context.principalId
    || !("targets" in claims)
    || !claims.targets.some((target) => target.deviceId === input.deviceId
      && target.repositoryId === input.repositoryId
      && target.projectId === input.projectId
      && target.adapters.includes(input.adapter)
      && (input.adapter !== "claude-development"
        || (input.model !== undefined && target.claudeModels?.includes(input.model) === true)))) {
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
  });
  return {
    conversationId: queued.conversationId,
    missionId: queued.mission.id,
    status: queued.mission.status,
  };
}
