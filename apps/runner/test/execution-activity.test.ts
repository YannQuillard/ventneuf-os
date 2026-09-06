import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExecutionActivity, executionRecorder, publishExecution } from "../src/execution-activity.js";
import { isAgentExecutionSnapshot } from "@ventneuf/domain";

test("Codex activity correlates concurrent tools by native IDs and retains subagent identity", () => {
  const activity = new ExecutionActivity("codex", "root", "/workspace");
  const send = (method: string, params: Record<string, unknown>) => activity.codex({ method, params });
  send("item/started", { threadId: "root", item: { id: "spawn", type: "collabToolCall", tool: "spawnAgent", receiverThreadIds: ["child"], prompt: "Review" } });
  for (const id of ["one", "two"]) send("item/started", { threadId: "child", item: { id, type: "commandExecution", command: `check ${id}` } });
  send("item/commandExecution/outputDelta", { threadId: "child", itemId: "two", delta: "two output" });
  send("item/completed", { threadId: "child", item: { id: "two", type: "commandExecution", status: "completed", command: "check two", aggregatedOutput: "Finished" } });
  const snapshot = activity.snapshot();
  assert.equal(isAgentExecutionSnapshot(snapshot), true);
  assert.equal(snapshot.items.find((item) => item.id === "child:one")?.status, "running");
  assert.equal(snapshot.items.find((item) => item.id === "child:two")?.status, "completed");
  assert.equal(snapshot.items.find((item) => item.id === "child:two")?.parentId, "agent:child");
  assert.match(snapshot.items.find((item) => item.id === "child:two")?.text ?? "", /Finished/);
  assert.equal(snapshot.items.find((item) => item.id === "agent:child")?.status, "running");
});

test("Claude partial text converges with the complete message and nested tools keep their parent", () => {
  const activity = new ExecutionActivity("claude", "root", "/workspace");
  activity.claude({ type: "assistant", message: { id: "m1", content: [{ type: "tool_use", id: "agent", name: "Agent", input: { description: "Review tests" } }] } });
  activity.claude({ type: "stream_event", parent_tool_use_id: "agent", event: { type: "message_start", message: { id: "m2" } } });
  activity.claude({ type: "stream_event", parent_tool_use_id: "agent", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Working" } } });
  activity.claude({ type: "assistant", parent_tool_use_id: "agent", message: { id: "m2", content: [{ type: "text", text: "Working on tests" }, { type: "tool_use", id: "read", name: "Read", input: { file_path: "/workspace/test.ts" } }] } });
  activity.claude({ type: "user", parent_tool_use_id: "agent", message: { content: [{ type: "tool_result", tool_use_id: "read", content: "No such file", is_error: true }] } });
  const snapshot = activity.snapshot();
  assert.equal(snapshot.items.filter((item) => item.kind === "message").length, 1);
  assert.equal(snapshot.items.find((item) => item.kind === "message")?.text, "Working on tests");
  assert.equal(snapshot.items.find((item) => item.id === "tool:read")?.parentId, "tool:agent");
  assert.equal(snapshot.items.find((item) => item.id === "tool:read")?.status, "failed");
  assert.ok(!JSON.stringify(snapshot).includes("/workspace"));
});

test("activity storage is bounded in UTF-8 bytes and excludes configuration and reasoning events", () => {
  const activity = new ExecutionActivity("codex", "root", "/workspace");
  activity.codex({ method: "account/updated", params: { accessToken: "sensitive fixture" } });
  activity.codex({ method: "item/completed", params: { item: { id: "thought", type: "reasoning", text: "private reasoning" } } });
  for (let index = 0; index < 200; index += 1) activity.codex({ method: "item/completed", params: {
    item: { id: String(index), type: "agentMessage", text: "界".repeat(5_000) },
  } });
  const snapshot = activity.snapshot();
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) <= 48_000);
  assert.ok(snapshot.omittedItems > 0);
  assert.ok(snapshot.items.every((item) => item.truncated));
  assert.equal(isAgentExecutionSnapshot(snapshot), true);
  assert.equal(isAgentExecutionSnapshot({ ...snapshot, items: [...snapshot.items, snapshot.items[0]] }), false);
  assert.ok(!JSON.stringify(snapshot).includes("sensitive fixture"));
  assert.ok(!JSON.stringify(snapshot).includes("private reasoning"));
});

test("atomic snapshots restore revisions and publishers retry the latest state after a lost response", async () => {
  const directory = await mkdtemp(join(tmpdir(), "execution-activity-"));
  const activity = new ExecutionActivity("codex", "root", "/workspace");
  const recorder = await executionRecorder(directory, activity);
  let sends = 0;
  const publisher = publishExecution(directory, async () => { sends += 1; if (sends === 1) throw new Error("Lost response"); });
  try {
    activity.codex({ method: "item/agentMessage/delta", params: { itemId: "m", delta: "Hello" } });
    await recorder.flush();
    await publisher.flush();
    await publisher.flush();
    await publisher.flush();
    assert.equal(sends, 2);
    const resumed = new ExecutionActivity("codex", "root", "/workspace");
    resumed.restore(JSON.parse(await readFile(join(directory, "execution.json"), "utf8")));
    resumed.codex({ method: "item/agentMessage/delta", params: { itemId: "m", delta: " again" } });
    assert.equal(resumed.snapshot().revision, 2);
    assert.equal(resumed.snapshot().items[0]?.text, "Hello again");
  } finally { await recorder.close(); await publisher.close(); await rm(directory, { recursive: true, force: true }); }
});


test("background Claude subagents stay running until their task notification arrives", () => {
  const activity = new ExecutionActivity("claude", "root", "/workspace");
  activity.claude({ type: "assistant", message: { id: "m", content: [{ type: "tool_use", id: "agent", name: "Agent", input: { description: "Review" } }] } });
  activity.claude({ type: "user", tool_use_result: { status: "async_launched" },
    message: { content: [{ type: "tool_result", tool_use_id: "agent", content: "Launched" }] } });
  assert.equal(activity.snapshot().items[0]?.status, "running");
  activity.claude({ type: "system", subtype: "task_progress", tool_use_id: "agent", task_id: "task", description: "Checking tests" });
  activity.claude({ type: "system", subtype: "task_notification", tool_use_id: "agent", task_id: "task", status: "completed", summary: "Review complete" });
  assert.equal(activity.snapshot().items.length, 1);
  assert.equal(activity.snapshot().items[0]?.kind, "agent");
  assert.equal(activity.snapshot().items[0]?.status, "completed");
  assert.equal(activity.snapshot().items[0]?.text, "Review complete");
});
