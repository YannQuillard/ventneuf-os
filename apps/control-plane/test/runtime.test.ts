import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationRuntimeRepository } from "@ventneuf/database";
import { HermesRequestTimeoutError, RunsHermesClient, StaticTokenProvider } from "../src/hermes.js";
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
    setMissionRunning: async () => true,
    completeMission: async () => true,
    failMission: async () => undefined,
    ...overrides,
  } as unknown as ConversationRuntimeRepository;
}

const unusedQueue = {} as MissionQueue;

test("processes a queued Hermes mission and persists its reply", async () => {
  const events: string[] = [];
  let persistedRunId: unknown;
  const runEvents: string[] = [];
  const worker = new MissionWorker(
    repository({
      setMissionRunning: async (
        _organizationId: string,
        _missionId: string,
        context: Record<string, unknown>,
      ) => {
        persistedRunId = context.hermesRunId ?? persistedRunId;
        events.push("running");
        return true;
      },
      appendMissionEvent: async (input: { type: string }) => { runEvents.push(input.type); },
      completeMission: async (input: {
        content: string;
        contextId: string;
        context: { timing?: { queueMs?: number; hermesMs?: number; totalMs?: number } };
      }) => {
        assert.equal(typeof input.context.timing?.queueMs, "number");
        assert.equal(typeof input.context.timing?.hermesMs, "number");
        assert.equal(typeof input.context.timing?.totalMs, "number");
        events.push(`completed:${input.contextId}:${input.content}`);
        return true;
      },
    }),
    unusedQueue,
    {
      ask: async (input) => {
        assert.equal(input.contextId, "context-before");
        assert.equal(input.message, "Investigate the issue");
        assert.equal(input.sessionKey, "organization:organization-1:conversation:conversation-1");
        await input.onRunStarted?.("run-1");
        await input.onEvent?.({ event: "tool.started", tool: "terminal", timestamp: 1 });
        await input.onEvent?.({ event: "reasoning.available", text: "private reasoning" });
        return { contextId: "context-after", text: "Issue found" };
      },
    },
  );

  await worker.process({ organizationId: "organization-1", missionId: "mission-1" });
  assert.equal(persistedRunId, "run-1");
  assert.deepEqual(runEvents, ["tool.started"]);
  assert.deepEqual(events, ["running", "running", "completed:context-after:Issue found"]);
});

test("gives Hermes a short parent-scoped dispatch grant without persisting the token", async () => {
  const parentMissionId = "00000000-0000-4000-8000-000000000001";
  const conversationId = "00000000-0000-4000-8000-000000000002";
  const memberId = "00000000-0000-4000-8000-000000000003";
  const deviceId = "00000000-0000-4000-8000-000000000004";
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const persisted: unknown[] = [];
  const base = repository();
  const worker = new MissionWorker(repository({
    getMission: async () => ({
      ...(await base.getMission("organization-1", parentMissionId)),
      mission: {
        ...(await base.getMission("organization-1", parentMissionId))!.mission,
        id: parentMissionId,
        conversationId,
      },
    }),
    getHermesDispatchScope: async () => ({
      organizationId: "00000000-0000-4000-8000-000000000005",
      parentMissionId,
      conversationId,
      memberId,
      targets: [{ deviceId, repositoryId: "ventneuf-os", adapters: ["orca-review"] }],
    }),
    appendMissionEvent: async (input: unknown) => { persisted.push(input); },
    completeMission: async (input: unknown) => { persisted.push(input); return true; },
  }), unusedQueue, {
    ask: async ({ message }) => {
      assert.match(message, /Investigate the issue/);
      assert.match(message, /signed-delegation/);
      assert.match(message, new RegExp(parentMissionId));
      assert.match(message, new RegExp(deviceId));
      return { contextId: "context-after", text: "Delegated" };
    },
  }, {
    serviceId: "hermes-supervisor",
    issuer: {
      verify: async () => assert.fail("The worker only issues delegations"),
      issue: async () => ({
        token: "signed-delegation",
        claims: {
          version: 1,
          issuer: "ventneuf-control-plane",
          audience: "ventneuf-mcp",
          delegationId: "00000000-0000-4000-8000-000000000006",
          serviceId: "hermes-supervisor",
          organizationId: "00000000-0000-4000-8000-000000000005",
          parentMissionId,
          conversationId,
          memberId,
          capabilities: ["mission:dispatch"],
          targets: [{ deviceId, repositoryId: "ventneuf-os", adapters: ["orca-review"] }],
          issuedAt,
          expiresAt,
        },
      }),
    },
  });

  await worker.process({ organizationId: "organization-1", missionId: parentMissionId });
  assert.equal(JSON.stringify(persisted).includes("signed-delegation"), false);
  assert.equal((persisted[0] as { type: string }).type, "mission.delegation_issued");
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


test("Hermes worker never executes a device-assigned mission", async () => {
  const repository = {
    getMission: async () => ({ mission: { status: "queued", assignedDeviceId: "device-1", context: { type: "runner.repository-check" } } }),
    setMissionRunning: async () => { throw new Error("Must not run a runner mission through Hermes."); },
  };
  const worker = new MissionWorker(repository as never, {} as never, {
    ask: async () => { throw new Error("Must not call Hermes."); },
  });
  await worker.process({ organizationId: "organization-1", missionId: "mission-1" });
});

test("cancellation between the mission read and running transition prevents submission", async () => {
  const worker = new MissionWorker(repository({ setMissionRunning: async () => false }), unusedQueue, {
    ask: async () => assert.fail("Cancelled work must not be submitted"),
  });
  await worker.process({ organizationId: "organization-1", missionId: "mission-1" });
});

test("cancellation before a new run is recorded stops it and preserves the ID for retry", async () => {
  let transitions = 0;
  let remembered: string | undefined;
  let stopAttempts = 0;
  let cancelled = false;
  const base = repository();
  const worker = new MissionWorker(repository({
    getMission: async () => cancelled
      ? { mission: { status: "cancelled", context: { hermesRunId: remembered } } }
      : base.getMission("organization-1", "mission-1"),
    setMissionRunning: async () => ++transitions === 1,
    rememberCancelledHermesRun: async (_org: string, _mission: string, runId: string) => { remembered = runId; },
    failMission: async () => {},
    completeMission: async () => assert.fail("Cancelled work must not complete"),
  }), unusedQueue, {
    ask: async (input) => {
      cancelled = true;
      await input.onRunStarted?.("late-run");
      return assert.fail("Must stop before continuing the new run");
    },
    stop: async (runId) => {
      assert.equal(runId, "late-run");
      assert.equal(remembered, runId);
      if (++stopAttempts === 1) throw new Error("Stop temporarily unavailable");
    },
  });
  await assert.rejects(worker.process({ organizationId: "organization-1", missionId: "mission-1" }), /Stop temporarily unavailable/);
  await worker.process({ organizationId: "organization-1", missionId: "mission-1" });
  assert.equal(stopAttempts, 2);
  assert.equal(transitions, 2);
});

test("a successful stop after cancellation does not persist a reply or failure", async () => {
  let transitions = 0;
  let stopped = false;
  const worker = new MissionWorker(repository({
    setMissionRunning: async () => ++transitions === 1,
    rememberCancelledHermesRun: async () => {},
    completeMission: async () => assert.fail("No cancelled reply"),
    failMission: async () => assert.fail("Cancellation is not failure"),
  }), unusedQueue, {
    ask: async (input) => {
      await input.onRunStarted?.("late-run");
      return assert.fail("Must stop before polling");
    },
    stop: async () => { stopped = true; },
  });
  await worker.process({ organizationId: "organization-1", missionId: "mission-1" });
  assert.equal(stopped, true);
});

test("the sequential queue persists results and advances despite open Hermes event streams", { timeout: 2_000 }, async () => {
  const abort = new AbortController();
  const completed: string[] = [];
  let deliveries = 0;
  let closedStreams = 0;
  const queue = {
    receive: async () => ({ Messages: [{
      Body: JSON.stringify({ organizationId: "organization-1", missionId: `mission-${++deliveries}` }),
      ReceiptHandle: `receipt-${deliveries}`,
    }] }),
    delete: async () => { if (deliveries === 2) abort.abort(); },
    release: async () => assert.fail("Completed work must not be retried"),
  } as unknown as MissionQueue;
  const hermes = new RunsHermesClient("http://hermes.internal", new StaticTokenProvider("token"), (async (url) => {
    if (String(url).endsWith("/v1/runs")) return Response.json({ run_id: `run-${deliveries}` });
    if (String(url).endsWith("/events")) return new Response(new ReadableStream({ cancel() { closedStreams++; } }));
    return Response.json({ status: "completed", output: "Result" });
  }) as typeof fetch, 1, 500);
  const worker = new MissionWorker(repository({
    completeMission: async (input: { missionId: string }) => { completed.push(input.missionId); return true; },
  }), queue, hermes);
  await worker.run(abort.signal);
  assert.deepEqual(completed, ["mission-1", "mission-2"]);
  assert.equal(closedStreams, 2);
});
