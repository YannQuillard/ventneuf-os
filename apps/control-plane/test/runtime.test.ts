import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationRuntimeRepository } from "@ventneuf/database";
import { HermesRequestTimeoutError } from "../src/hermes.js";
import { MissionWorker, type MissionQueue } from "../src/runtime.js";

function repository(overrides: Record<string, unknown> = {}) {
  return {
    getMission: async () => ({
      hermesContextId: "context-before",
      mission: {
        id: "mission-1",
        organizationId: "organization-1",
        conversationId: "conversation-1",
        status: "queued",
        goal: "Investigate the issue",
        context: {
          timing: {
            acceptedAt: new Date(Date.now() - 50).toISOString(),
            queuedAt: new Date(Date.now() - 40).toISOString(),
          },
        },
      },
    }),
    setMissionRunning: async () => undefined,
    completeMission: async () => undefined,
    failMission: async () => undefined,
    ...overrides,
  } as unknown as ConversationRuntimeRepository;
}

const unusedQueue = {} as MissionQueue;

test("processes a queued Hermes mission and persists its reply", async () => {
  const events: string[] = [];
  const worker = new MissionWorker(
    repository({
      setMissionRunning: async () => events.push("running"),
      completeMission: async (input: {
        content: string;
        contextId: string;
        context: { timing?: { queueMs?: number; hermesMs?: number; totalMs?: number } };
      }) => {
        assert.equal(typeof input.context.timing?.queueMs, "number");
        assert.equal(typeof input.context.timing?.hermesMs, "number");
        assert.equal(typeof input.context.timing?.totalMs, "number");
        events.push(`completed:${input.contextId}:${input.content}`);
      },
    }),
    unusedQueue,
    {
      ask: async (input) => {
        assert.equal(input.contextId, "context-before");
        assert.equal(input.message, "Investigate the issue");
        return { contextId: "context-after", text: "Issue found" };
      },
    },
  );

  await worker.process({ organizationId: "organization-1", missionId: "mission-1" });
  assert.deepEqual(events, ["running", "completed:context-after:Issue found"]);
});

test("does not run an already completed mission", async () => {
  let calls = 0;
  const worker = new MissionWorker(
    repository({
      getMission: async () => ({
        hermesContextId: "context",
        mission: { status: "completed" },
      }),
    }),
    unusedQueue,
    { ask: async () => { calls += 1; return { contextId: "context", text: "unused" }; } },
  );

  await worker.process({ organizationId: "organization-1", missionId: "mission-1" });
  assert.equal(calls, 0);
});

test("marks a mission failed before allowing SQS to retry it", async () => {
  let failure = "";
  const worker = new MissionWorker(
    repository({ failMission: async (_organizationId: string, _missionId: string, reason: string) => { failure = reason; } }),
    unusedQueue,
    { ask: async () => { throw new Error("Hermes unavailable"); } },
  );

  await assert.rejects(
    worker.process({ organizationId: "organization-1", missionId: "mission-1" }),
    /Hermes unavailable/,
  );
  assert.equal(failure, "Hermes unavailable");
});

test("deletes a timed-out mission instead of executing it twice", async () => {
  const abort = new AbortController();
  let deleted = 0;
  let released = 0;
  const queue = {
    receive: async () => ({
      Messages: [{
        Body: JSON.stringify({ organizationId: "organization-1", missionId: "mission-1" }),
        ReceiptHandle: "receipt-1",
      }],
    }),
    delete: async () => {
      deleted += 1;
      abort.abort();
    },
    release: async () => {
      released += 1;
      abort.abort();
    },
  } as unknown as MissionQueue;
  const worker = new MissionWorker(
    repository(),
    queue,
    { ask: async () => { throw new HermesRequestTimeoutError(); } },
  );

  await worker.run(abort.signal);

  assert.equal(deleted, 1);
  assert.equal(released, 0);
});
