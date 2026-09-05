import { assertAuthorized, type AuthorizationContext } from "@ventneuf/domain";
import type { ConversationRuntime } from "./runtime.js";

export async function submitPrivateMessage(
  context: AuthorizationContext,
  conversations: Pick<ConversationRuntime, "repository" | "queue">,
  input: { content: string; contextId?: string },
) {
  assertAuthorized(context, "hermes:ask");
  if (context.principalType !== "user") throw new Error("Private messages require a user principal.");
  const queued = await conversations.repository.enqueuePrivateMessage({
    organizationId: context.organizationId,
    externalSubject: context.principalId,
    content: input.content,
    contextId: input.contextId,
  });
  const queuedAt = new Date();
  const missionContext = queued.mission.context ?? {};
  const queuedContext = {
    ...missionContext,
    timing: {
      ...(missionContext.timing && typeof missionContext.timing === "object"
        ? missionContext.timing as Record<string, unknown>
        : {}),
      queuedAt: queuedAt.toISOString(),
    },
  };
  await conversations.repository.setMissionQueued(
    context.organizationId,
    queued.mission.id,
    queuedContext,
  );
  try {
    await conversations.queue.publish(
      { organizationId: context.organizationId, missionId: queued.mission.id },
      queued.conversationId,
    );
  } catch (error) {
    const failedAt = new Date();
    await conversations.repository.failMission(
      context.organizationId,
      queued.mission.id,
      "Mission dispatch failed.",
      {
        ...queuedContext,
        timing: {
          ...queuedContext.timing,
          failedAt: failedAt.toISOString(),
          totalMs: queued.message.createdAt instanceof Date
            ? failedAt.getTime() - queued.message.createdAt.getTime()
            : undefined,
        },
      },
    );
    throw error;
  }
  console.info(JSON.stringify({
    component: "conversation-api",
    event: "mission.queued",
    organizationId: context.organizationId,
    missionId: queued.mission.id,
    conversationId: queued.conversationId,
    acceptedToQueueMs: queued.message.createdAt instanceof Date
      ? queuedAt.getTime() - queued.message.createdAt.getTime()
      : undefined,
  }));
  return {
    conversationId: queued.conversationId,
    message: queued.message,
    missionId: queued.mission.id,
    status: queued.mission.status,
    timing: queuedContext.timing,
  };
}
