import assert from "node:assert/strict";
import test from "node:test";
import { prototypeData } from "../lib/prototype/fixtures";
import {
  approvalById,
  approvalsForMission,
  isPendingApproval,
  missionById,
  pendingMemberApprovals,
  prototypeReducer,
} from "../lib/prototype/state";

const decidedAt = "2026-09-05T14:40:00.000Z";

function lastEntry(conversationId: string, data = prototypeData) {
  const entries = data.entries[conversationId] ?? [];
  return entries[entries.length - 1];
}

test("approving an escalated request resumes the waiting mission in the same session", () => {
  const next = prototypeReducer(prototypeData, {
    type: "decideApproval",
    approvalId: "ap-real-cleanup",
    outcome: "approved",
    at: decidedAt,
  });
  const approval = approvalById(next, "ap-real-cleanup");
  const mission = missionById(next, "m-retention");

  assert.equal(approval?.state, "approved");
  assert.equal(approval?.decision?.by, "member");
  assert.equal(approval?.resumedAt, decidedAt);
  assert.equal(mission?.status, "running");
  assert.equal(mission?.steps.find(({ kind, status }) => kind === "approval" && status === "running"), undefined);
  assert.match(lastEntry("thread-retention", next).kind === "system" ? (lastEntry("thread-retention", next) as { content: string }).content : "", /resumed with your approval/);
  assert.equal(pendingMemberApprovals(next, "m-retention").length, 0);
});

test("rejecting an escalated request keeps the mission running with the rejection as a constraint", () => {
  const next = prototypeReducer(prototypeData, {
    type: "decideApproval",
    approvalId: "ap-real-cleanup",
    outcome: "rejected",
    at: decidedAt,
  });
  assert.equal(approvalById(next, "ap-real-cleanup")?.state, "rejected");
  assert.equal(missionById(next, "m-retention")?.status, "running");
  assert.match(missionById(next, "m-retention")?.currentStep ?? "", /working around the rejected operation/);
});

test("requests awaiting Hermes cannot be decided by the member from the conversation", () => {
  const next = prototypeReducer(prototypeData, {
    type: "decideApproval",
    approvalId: "ap-sentry-read",
    outcome: "approved",
    at: decidedAt,
  });
  assert.equal(approvalById(next, "ap-sentry-read")?.state, "approved");
  assert.equal(pendingMemberApprovals(prototypeData, "m-sentry").length, 0);
});

test("already decided approvals are immutable", () => {
  const next = prototypeReducer(prototypeData, {
    type: "decideApproval",
    approvalId: "ap-dependency",
    outcome: "approved",
    at: decidedAt,
  });
  assert.equal(next, prototypeData);
});

test("cancelling a mission ends it, skips remaining steps, and leaves pending approvals non-actionable", () => {
  const next = prototypeReducer(prototypeData, { type: "cancelMission", missionId: "m-retention", at: decidedAt });
  const mission = missionById(next, "m-retention");

  assert.equal(mission?.status, "cancelled");
  assert.equal(mission?.endedAt, decidedAt);
  assert.equal(mission?.cancellation?.byId, "mem-ada");
  assert.ok(mission?.steps.every(({ status }) => status !== "running" && status !== "pending"));
  assert.ok(approvalsForMission(next, "m-retention").some(isPendingApproval));
  assert.equal(pendingMemberApprovals(next, "m-retention").length, 0);
  assert.equal(prototypeReducer(next, { type: "cancelMission", missionId: "m-retention", at: decidedAt }), next);
});

test("retrying a failed mission starts a new attempt with a fresh lease", () => {
  const next = prototypeReducer(prototypeData, { type: "retryMission", missionId: "m-expiry", at: decidedAt });
  const mission = missionById(next, "m-expiry");

  assert.equal(mission?.status, "running");
  assert.equal(mission?.attempt, 4);
  assert.equal(mission?.failure, undefined);
  assert.equal(mission?.startedAt, decidedAt);
  assert.equal(mission?.steps.at(-1)?.status, "running");
  assert.equal(prototypeReducer(prototypeData, { type: "retryMission", missionId: "m-retention", at: decidedAt }), prototypeData);
});

test("sending a message appends it to the conversation and bumps its activity", () => {
  const next = prototypeReducer(prototypeData, {
    type: "sendMessage",
    conversationId: "conv-quick",
    content: "And the --json flag?",
    at: decidedAt,
  });
  const entry = lastEntry("conv-quick", next);

  assert.equal(entry.kind, "message");
  assert.equal(entry.kind === "message" ? entry.role : undefined, "user");
  assert.equal(next.conversations.find(({ id }) => id === "conv-quick")?.lastActivityAt, decidedAt);
  assert.equal(prototypeData.entries["conv-quick"].length + 1, next.entries["conv-quick"].length);
});
