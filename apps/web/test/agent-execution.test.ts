import assert from "node:assert/strict";
import test from "node:test";
import type { AgentExecutionItem, AgentExecutionSnapshot, MissionHistoryEntry } from "@ventneuf/domain";
import { countNodes, executionItemStatus, executionTree, hasFailure, mergeExecutionTimeline } from "../lib/agent-execution";
import { approvalPresentation, pendingApprovalSummary } from "../lib/mission-presentation";
import type { MissionApproval } from "../lib/conversations";

const item = (id: string, parentId?: string, extra: Partial<AgentExecutionItem> = {}): AgentExecutionItem => ({ id, parentId, threadId: "thread", kind: "tool",
  label: id, status: "running", text: "Output", ...extra });

const entry = (occurredAt: string, value: AgentExecutionItem): MissionHistoryEntry => ({
  id: `${value.id}-${occurredAt}`, provider: "claude", sessionId: "thread", occurredAt, item: value,
});

const snapshot = (items: AgentExecutionItem[], updatedAt = "2026-09-10T10:00:30.000Z"): AgentExecutionSnapshot => ({
  version: 1, provider: "claude", revision: 3, updatedAt, rootThreadId: "thread", omittedItems: 0, items,
});

test("execution tree retains child order and exposes missing or cyclic parents", () => {
  const tree = executionTree([item("root"), item("first", "root"), item("second", "root"), item("orphan", "missing"), item("a", "b"), item("b", "a")]);
  assert.deepEqual(tree.map(({ item }) => item.id), ["root", "orphan", "a", "b"]);
  assert.deepEqual(tree[0]?.children.map(({ item }) => item.id), ["first", "second"]);
  assert.equal(countNodes(tree[0]!), 2);
});

test("terminal mission states never present unfinished native tools as still running or successfully completed", () => {
  assert.equal(executionItemStatus(item("tool"), "cancelled"), "Interrupted");
  assert.equal(executionItemStatus(item("tool"), "waiting_for_approval"), "Waiting");
  assert.equal(executionItemStatus(item("tool"), "completed"), "No completion event");
});

test("the timeline places evicted history before the live snapshot and keeps the first observation time", () => {
  const history = [
    entry("2026-09-10T10:00:00.000Z", item("old", undefined, { status: "completed" })),
    entry("2026-09-10T10:00:05.000Z", item("stream", undefined, { text: "Read" })),
    entry("2026-09-10T10:00:15.000Z", item("stream", undefined, { text: "Reading the tests", status: "completed" })),
  ];
  const timeline = mergeExecutionTimeline(history, snapshot([item("stream", undefined, { text: "the tests", status: "completed", truncated: true }), item("new")]));
  assert.deepEqual(timeline.map(({ id }) => id), ["old", "stream", "new"]);
  assert.equal(timeline[1]?.occurredAt, "2026-09-10T10:00:05.000Z");
  assert.equal(timeline[1]?.text, "Reading the tests");
  assert.equal(timeline[1]?.truncated, undefined);
  assert.equal(timeline[2]?.occurredAt, undefined);
});

test("a running snapshot item shows its live tail, and history newer than the snapshot wins", () => {
  const live = mergeExecutionTimeline([entry("2026-09-10T10:00:00.000Z", item("stream", undefined, { text: "Old long saved text" }))],
    snapshot([item("stream", undefined, { text: "tail" })]));
  assert.equal(live[0]?.text, "tail");
  const newer = mergeExecutionTimeline([entry("2026-09-10T10:01:00.000Z", item("tool", undefined, { status: "failed", text: "exit 1" }))],
    snapshot([item("tool")]));
  assert.equal(newer[0]?.status, "failed");
  assert.equal(newer[0]?.text, "exit 1");
});

test("issues cover failed steps nested under a subagent", () => {
  const [agent] = executionTree([item("agent", undefined, { kind: "agent", status: "completed" }), item("step", "agent", { status: "failed" })]);
  assert.equal(hasFailure(agent!), true);
  assert.equal(hasFailure(executionTree([item("ok", undefined, { status: "completed" })])[0]!), false);
});

const approval = (overrides: Partial<MissionApproval>): MissionApproval => ({
  id: "approval", missionId: "mission", action: { category: "git", target: "main", argumentsDigest: "d", summary: "Push", expectedEffect: "Pushes" },
  reason: "Needed", evidence: {}, route: "hermes", status: "pending", expiresAt: "2026-09-10T11:00:00.000Z", createdAt: "2026-09-10T10:00:00.000Z", ...overrides,
});

test("approval presentation separates Hermes review, the member's decision and the recorded outcome", () => {
  assert.equal(approvalPresentation(approval({})).isReviewing, true);
  assert.equal(approvalPresentation(approval({ route: "human", canDecide: true })).isActionable, true);
  assert.equal(approvalPresentation(approval({ route: "human", canDecide: false })).heading, "Waiting for the mission initiator");
  assert.equal(approvalPresentation(approval({ status: "approved" })).heading, "Approved by Hermes");
  assert.equal(approvalPresentation(approval({ status: "rejected", route: "human" })).status, "error");
  assert.equal(approvalPresentation(approval({ status: "expired" })).isActionable, false);
  assert.equal(pendingApprovalSummary([approval({}), approval({ route: "human", canDecide: true })]), "your decision");
  assert.equal(pendingApprovalSummary([approval({ status: "approved" })]), undefined);
});
