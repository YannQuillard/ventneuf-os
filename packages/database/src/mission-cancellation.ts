import { and, eq, inArray, sql } from "drizzle-orm";
import type { DatabaseTransaction } from "./client.js";
import { missions, missionApprovals, missionEvents } from "./schema.js";

export async function cancelMissionInTransaction(transaction: DatabaseTransaction, organizationId: string, missionId: string, context: Record<string, unknown>) {
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
}
