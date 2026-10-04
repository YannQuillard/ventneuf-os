import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExecutionActivity, executionRecorder } from "../src/execution-activity.js";
import { hasPendingHistory, uploadHistory } from "../src/mission-history.js";

test("durable history survives snapshot eviction, redacts secrets and retries identical events", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mission-history-"));
  const activity = new ExecutionActivity("claude", "session", "/workspace");
  const recorder = await executionRecorder(directory, activity);
  try {
    for (let index = 0; index < 100; index++) activity.claude({ type: "assistant", message: {
      id: `message-${index}`, content: [{ type: "text", text: `${index} /workspace/file token=private-value ${"x".repeat(5000)}` }],
    } });
    await recorder.flush();
    assert.ok(activity.snapshot().omittedItems > 0);
    assert.equal(await hasPendingHistory(directory), true);
    const files = await readdir(join(directory, "history-pending"));
    assert.equal(files.length, 100);
    const first = JSON.parse(await readFile(join(directory, "history-pending", files.sort()[0]!), "utf8"))[0];
    assert.ok(first.item.text.length > 4000);
    assert.ok(!first.item.text.includes("private-value"));
    assert.ok(!first.item.text.includes("/workspace"));
    const attempts: string[] = [];
    await assert.rejects(uploadHistory(directory, async entries => { attempts.push(entries[0]!.id); throw Error("lost response"); }));
    await uploadHistory(directory, async entries => { attempts.push(entries[0]!.id); }, 1);
    assert.equal(attempts[0], attempts[1]);
    await uploadHistory(directory, async () => {}, 100);
    assert.equal(await hasPendingHistory(directory), false);
  } finally { await recorder.close(); await rm(directory, { recursive: true, force: true }); }
});

test("unfinished native output has a checkpoint even without a completion event", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mission-history-stream-"));
  const activity = new ExecutionActivity("codex", "thread", "/workspace");
  const recorder = await executionRecorder(directory, activity);
  try {
    activity.codex({ method: "item/commandExecution/outputDelta", params: { threadId: "thread", itemId: "tool", delta: "A build is still running" } });
    await recorder.close();
    const saved: string[] = [];
    await uploadHistory(directory, async entries => { saved.push(...entries.map(entry => entry.item.text)); });
    assert.deepEqual(saved, ["A build is still running"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("history marks oversized Unicode output and excludes provider reasoning", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mission-history-unicode-"));
  const activity = new ExecutionActivity("claude", "session", "/workspace");
  const recorder = await executionRecorder(directory, activity);
  try {
    activity.claude({ type: "assistant", message: { id: "message", content: [
      { type: "thinking", thinking: "Do not retain this" }, { type: "text", text: "界".repeat(32000) },
    ] } });
    await recorder.close();
    await uploadHistory(directory, async entries => {
      assert.equal(entries.length, 1);
      assert.equal(entries[0]!.item.truncated, true);
      assert.ok(Buffer.byteLength(JSON.stringify(entries)) < 90000);
      assert.ok(!JSON.stringify(entries).includes("Do not retain this"));
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("streamed output keeps its observed position and later checkpoints carry the accumulated text", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mission-history-order-"));
  const activity = new ExecutionActivity("codex", "thread", "/workspace");
  const recorder = await executionRecorder(directory, activity);
  try {
    activity.codex({ method: "item/agentMessage/delta", params: { threadId: "thread", itemId: "message", delta: "Reading" } });
    activity.codex({ method: "item/started", params: { threadId: "thread", item: { id: "tool", type: "commandExecution", command: "npm test" } } });
    activity.codex({ method: "item/agentMessage/delta", params: { threadId: "thread", itemId: "message", delta: " the tests" } });
    await recorder.close();
    const saved: Array<[string, string]> = [];
    await uploadHistory(directory, async entries => { saved.push(...entries.map(entry => [entry.item.id, entry.item.text] as [string, string])); });
    assert.deepEqual(saved.map(([id]) => id), ["thread:message", "thread:tool", "thread:message"]);
    assert.equal(saved.at(-1)?.[1], "Reading the tests");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
