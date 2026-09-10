import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { isMissionHistoryBatch } from "../src/execution.js";

test("history accepts bounded observable output and rejects hidden provider data", () => {
  const entry = { id: randomUUID(), provider: "claude", sessionId: "session", occurredAt: new Date().toISOString(),
    item: { id: "tool", threadId: "session", kind: "tool", label: "Build", status: "completed", text: "x".repeat(8000) } };
  assert.equal(isMissionHistoryBatch([entry]), true);
  assert.equal(isMissionHistoryBatch([{ ...entry, rawProviderEvent: { secret: "hidden" } }]), false);
  assert.equal(isMissionHistoryBatch([{ ...entry, item: { ...entry.item, kind: "reasoning" } }]), false);
  assert.equal(isMissionHistoryBatch([{ ...entry, item: { ...entry.item, text: "x".repeat(32001) } }]), false);
  assert.equal(isMissionHistoryBatch([entry, entry]), false);
  assert.equal(isMissionHistoryBatch([]), false);
});
