import assert from "node:assert/strict";
import test from "node:test";
import type { AgentExecutionItem } from "@ventneuf/domain";
import { executionItemStatus, executionTree } from "../lib/agent-execution";

const item = (id: string, parentId?: string): AgentExecutionItem => ({ id, parentId, threadId: "thread", kind: "tool",
  label: id, status: "running", text: "Output" });

test("execution tree retains child order and exposes missing or cyclic parents", () => {
  const tree = executionTree([item("root"), item("first", "root"), item("second", "root"), item("orphan", "missing"), item("a", "b"), item("b", "a")]);
  assert.deepEqual(tree.map(({ item }) => item.id), ["root", "orphan", "a", "b"]);
  assert.deepEqual(tree[0]?.children.map(({ item }) => item.id), ["first", "second"]);
});

test("terminal mission states never present unfinished native tools as still running or successfully completed", () => {
  assert.equal(executionItemStatus(item("tool"), "cancelled"), "Interrupted");
  assert.equal(executionItemStatus(item("tool"), "waiting_for_approval"), "Waiting");
  assert.equal(executionItemStatus(item("tool"), "completed"), "No completion event");
});
