import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LeaseRejectedError, RunnerMissionWorker, type MissionClient, type MissionReport } from "../src/mission-worker.js";
import { loadRepositories, MissionPausedError, RepositoryCheckAdapter } from "../src/repositories.js";

const device = { deviceId: "device-1", credential: "private-credential", name: "Test Mac", platform: "darwin" as const };
const mission = { id: "mission-1", repositoryId: "sample", adapter: "repository-check" as const,
  objective: "Check repository metadata", leaseToken: "lease-token",
  leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(), attempt: 1 };

test("repository check uses explicit configuration and never reads source contents or follows entries", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "runner-check-"));
  try {
    const root = join(temporary, "repository");
    await mkdir(root);
    await mkdir(join(root, ".git"));
    await writeFile(join(root, "secret.txt"), "sensitive source content");
    await symlink("/unavailable", join(root, "external"));
    const configuration = join(temporary, "repositories.json");
    await writeFile(configuration, JSON.stringify([{
      id: "sample", name: "Sample", path: root, codexDevelopment: true, claudeDevelopment: true,
    }]));
    const [repository] = await loadRepositories(configuration);
    assert.ok(repository);
    assert.equal(repository.codexDevelopment, true);
    assert.equal(repository.claudeDevelopment, true);
    const adapter = new RepositoryCheckAdapter();
    const result = await adapter.execute(mission, repository, new AbortController().signal);
    assert.match(result, /3 top-level entries/);
    assert.match(result, /Git metadata is present/);
    assert.ok(!result.includes(root) && !result.includes("secret") && !result.includes("sensitive"));
    assert.equal(await readFile(join(root, "secret.txt"), "utf8"), "sensitive source content");
    await assert.rejects(adapter.execute({ ...mission, repositoryId: "other" }, repository, new AbortController().signal));
    await assert.rejects(adapter.execute(mission, repository, AbortSignal.abort()));
    await writeFile(configuration, JSON.stringify([{ id: "sample", name: "Sample", path: "relative" }]));
    await assert.rejects(loadRepositories(configuration));
    assert.deepEqual(await loadRepositories(join(temporary, "missing.json")), []);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

function setup(overrides: Partial<MissionClient> = {}) {
  const reports: MissionReport[] = [];
  let executions = 0;
  const worker = new RunnerMissionWorker({
    store: { load: async () => device, save: async () => {} },
    repositories: async () => [{ id: "sample", name: "Sample", path: "/private/local/repository" }],
    adapter: { execute: async () => { executions += 1; return "Read-only result"; } },
    client: {
      registerRepositories: async (_device, repositories) => {
        assert.deepEqual(repositories, [{ id: "sample", name: "Sample" }]);
      },
      claimMission: async () => mission,
      reportMission: async (_device, _id, report) => { reports.push(report); },
      ...overrides,
    },
  });
  return { worker, reports, executions: () => executions };
}

test("worker scopes execution and reports progress before a durable result", async () => {
  const state = setup();
  await state.worker.tick();
  assert.equal(state.executions(), 1);
  assert.deepEqual(state.reports.map(({ kind }) => kind), ["progress", "completed"]);
  assert.equal(state.reports[0]?.token, mission.leaseToken);
  assert.equal(state.reports[0]?.owner, state.reports[1]?.owner);
});

test("lost completion responses retry the same event without re-execution", async () => {
  const events: MissionReport[] = [];
  const state = setup({ reportMission: async (_device, _id, report) => {
    if (report.kind === "completed") {
      events.push(report);
      if (events.length === 1) throw new Error("Response lost");
    }
  } });
  await state.worker.tick();
  assert.equal(state.executions(), 1);
  assert.equal(events.length, 2);
  assert.equal(events[0]?.eventId, events[1]?.eventId);
});

test("lost or cancelled lease prevents adapter execution", async () => {
  const state = setup({ reportMission: async () => { throw new LeaseRejectedError(); } });
  await assert.rejects(state.worker.tick(), LeaseRejectedError);
  assert.equal(state.executions(), 0);
});

test("unregistered repository fails without executing an adapter", async () => {
  const state = setup({ claimMission: async () => ({ ...mission, repositoryId: "unauthorized" }) });
  await state.worker.tick();
  assert.equal(state.executions(), 0);
  assert.equal(state.reports.at(-1)?.kind, "failed");
});

test("polls never overlap", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let claims = 0;
  const state = setup({ claimMission: async () => { claims += 1; await pending; return mission; } });
  const first = state.worker.tick();
  await state.worker.tick();
  release();
  await first;
  assert.equal(claims, 1);
});

test("long reviews renew their lease and abort when renewal is rejected", async () => {
  let renewals = 0;
  let aborted = false;
  const reports: MissionReport[] = [];
  const worker = new RunnerMissionWorker({
    store: { load: async () => device, save: async () => {} },
    repositories: async () => [{ id: "sample", name: "Sample", path: "/repository", orcaReview: true }],
    renewalIntervalMs: 10,
    client: {
      registerRepositories: async () => {},
      claimMission: async () => ({ ...mission, adapter: "orca-review" }),
      reportMission: async (_device, _id, report) => { reports.push(report); },
      renewMission: async () => {
        renewals += 1;
        if (renewals > 1) throw new LeaseRejectedError("Cancelled");
        return new Date(Date.now() + 60_000).toISOString();
      },
    },
    adapter: { execute: async (_mission, _repository, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => { aborted = true; reject(signal.reason); }, { once: true });
    }) },
  });
  await worker.tick();
  assert.equal(renewals, 2);
  assert.equal(aborted, true);
  assert.equal(reports.some(({ kind }) => kind === "completed"), false);
});

test("routes a Claude approval through the leased worker and pauses without failure", async () => {
  const reports: MissionReport[] = [];
  let request: unknown;
  const worker = new RunnerMissionWorker({
    store: { load: async () => device, save: async () => {} },
    repositories: async () => [{
      id: "sample", name: "Sample", path: "/repository", orcaReview: true, codexDevelopment: true,
      claudeDevelopment: true,
    }],
    client: {
      registerRepositories: async (_device, repositories) => {
        assert.equal(repositories[0]?.codexDevelopment, true);
        assert.equal(repositories[0]?.claudeDevelopment, true);
      },
      claimMission: async () => ({
        ...mission,
        adapter: "claude-development",
        authorityExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
      reportMission: async (_device, _id, report) => { reports.push(report); },
      renewMission: async () => new Date(Date.now() + 60_000).toISOString(),
      requestApproval: async (_device, _id, input) => {
        request = input;
        return { approval: { id: "approval-1", route: "hermes", status: "pending", expiresAt: new Date(Date.now() + 60_000).toISOString() } };
      },
    },
    adapter: { execute: async (_mission, _repository, _signal, execution) => {
      await execution!.requestApproval({
        requestId: "00000000-0000-4000-8000-000000000010",
        action: { category: "network.access", target: "github.com", argumentsDigest: "a".repeat(64), summary: "Push branch", expectedEffect: "Updates the remote branch." },
        reason: "The mission needs to publish its branch.",
        evidence: { host: "github.com" },
        resume: { adapter: "claude", sessionId: "00000000-0000-4000-8000-000000000011" },
      });
      throw new MissionPausedError();
    } },
  });
  await worker.tick();
  assert.deepEqual((request as { owner: string; token: string }).token, mission.leaseToken);
  assert.equal(typeof (request as { owner: string }).owner, "string");
  assert.equal(reports.some(({ kind }) => kind === "failed"), false);
  assert.equal(reports.at(0)?.kind, "progress");
});
