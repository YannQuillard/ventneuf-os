import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationRuntimeRepository } from "@ventneuf/database";
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
      completeMission: async (input: { content: string; contextId: string }) => {
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
