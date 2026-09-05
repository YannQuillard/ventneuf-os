import { assertAuthorized, type AuthorizationContext } from "@ventneuf/domain";
import type { ConversationRuntime } from "./runtime.js";

export type ReadOnlyRunnerAdapter = "repository-check" | "orca-review";

export interface ReadOnlyRunnerDispatch {
  deviceId: string;
  repositoryId: string;
  adapter: ReadOnlyRunnerAdapter;
  objective: string;
}

export async function dispatchReadOnlyRunnerMission(
  context: AuthorizationContext,
  runtime: Pick<ConversationRuntime, "repository">,
  input: ReadOnlyRunnerDispatch,
) {
  assertAuthorized(context, "mission:create");
  if (context.principalType !== "user") {
    throw new Error("Direct runner dispatch requires a user principal.");
  }
  const queued = await runtime.repository.enqueuePrivateMessage({
    organizationId: context.organizationId,
    externalSubject: context.principalId,
    content: input.objective,
    runner: {
      deviceId: input.deviceId,
      repositoryId: input.repositoryId,
      adapter: input.adapter,
    },
  });
  return {
    conversationId: queued.conversationId,
    missionId: queued.mission.id,
    status: queued.mission.status,
  };
}
