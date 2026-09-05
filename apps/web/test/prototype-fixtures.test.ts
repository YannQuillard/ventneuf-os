import assert from "node:assert/strict";
import test from "node:test";
import { prototypeData } from "../lib/prototype/fixtures";
import type { ApprovalState, MissionStatus } from "../lib/prototype/types";

test("every conversation entry, mission, and approval references existing fixtures", () => {
  const conversationIds = new Set(prototypeData.conversations.map(({ id }) => id));
  const missionIds = new Set(prototypeData.missions.map(({ id }) => id));
  const approvalIds = new Set(prototypeData.approvals.map(({ id }) => id));
  const memberIds = new Set(prototypeData.members.map(({ id }) => id));
  const deviceIds = new Set(prototypeData.devices.map(({ id }) => id));

  for (const conversation of prototypeData.conversations) {
    if (conversation.parentId) assert.ok(conversationIds.has(conversation.parentId), `${conversation.id} parent`);
    if (conversation.projectId) {
      assert.ok(prototypeData.projects.some(({ id }) => id === conversation.projectId), `${conversation.id} project`);
    }
  }
  for (const mission of prototypeData.missions) {
    assert.ok(conversationIds.has(mission.conversationId), `${mission.id} conversation`);
    assert.ok(memberIds.has(mission.initiatedById), `${mission.id} initiator`);
    assert.ok(deviceIds.has(mission.deviceId), `${mission.id} device`);
  }
  for (const approval of prototypeData.approvals) {
    assert.ok(missionIds.has(approval.missionId), `${approval.id} mission`);
  }
  for (const [conversationId, entries] of Object.entries(prototypeData.entries)) {
    assert.ok(conversationIds.has(conversationId), `${conversationId} entries`);
    for (const entry of entries) {
      if (entry.kind === "mission" || entry.kind === "milestone") assert.ok(missionIds.has(entry.missionId), entry.id);
      if (entry.kind === "approval") assert.ok(approvalIds.has(entry.approvalId), entry.id);
      if (entry.kind === "message" && entry.authorId) assert.ok(memberIds.has(entry.authorId), entry.id);
    }
  }
});

test("fixtures cover every mission status and approval state the prototype must show", () => {
  const statuses = new Set(prototypeData.missions.map(({ status }) => status));
  for (const required of ["running", "waiting_for_approval", "completed", "failed", "cancelled"] satisfies MissionStatus[]) {
    assert.ok(statuses.has(required), `mission status ${required}`);
  }
  const states = new Set(prototypeData.approvals.map(({ state }) => state));
  for (const required of ["requested", "approved", "rejected", "escalated"] satisfies ApprovalState[]) {
    assert.ok(states.has(required), `approval state ${required}`);
  }
});

test("every conversation has entries in chronological order and every mission is surfaced in its conversation", () => {
  for (const conversation of prototypeData.conversations) {
    const entries = prototypeData.entries[conversation.id] ?? [];
    assert.ok(entries.length > 0, `${conversation.id} has entries`);
    const ordered = [...entries].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    assert.deepEqual(entries.map(({ id }) => id), ordered.map(({ id }) => id), `${conversation.id} order`);
  }
  for (const mission of prototypeData.missions) {
    const entries = prototypeData.entries[mission.conversationId] ?? [];
    assert.ok(entries.some((entry) => entry.kind === "mission" && entry.missionId === mission.id), `${mission.id} card`);
  }
});

test("a mission belongs to a thread or conversation, never to a project directly", () => {
  for (const mission of prototypeData.missions) {
    const conversation = prototypeData.conversations.find(({ id }) => id === mission.conversationId);
    assert.ok(conversation, mission.id);
    assert.ok(["thread", "personal-main", "personal"].includes(conversation.kind), `${mission.id} lives in ${conversation.kind}`);
  }
});
