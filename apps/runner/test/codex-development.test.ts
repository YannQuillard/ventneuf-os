import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  AgentDevelopmentAdapter,
  CodexDevelopmentAdapter,
  developmentOrcaRequestTimeoutMs,
} from "../src/codex-development.js";
import { writeReviewState } from "../src/review-supervisor.js";

const execute = promisify(execFile);

test("maintenance rotates through retained missions and stops cloud failures", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-development-maintenance-"));
  try {
    const missionIds = Array.from({ length: 21 }, (_, index) =>
      `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
    await Promise.all(missionIds.map(async (missionId) => {
      const directory = join(root, missionId);
      await mkdir(directory);
      await writeReviewState(join(directory, "orca.json"), {
        missionId,
        repositoryId: "sample",
        worktreeId: `worktree-${missionId}`,
        worktreePath: join(root, `worktree-${missionId}`),
        createdAt: new Date().toISOString(),
      });
    }));
    const inspected = new Set<string>();
    const adapter = new CodexDevelopmentAdapter({
      orcaPath: "/usr/bin/false",
      codexPath: "/usr/bin/false",
      stateDirectory: root,
    });
    const maintenance = { status: async (missionId: string) => {
      inspected.add(missionId);
      return "failed" as const;
    } };
    await adapter.maintain(maintenance);
    await adapter.maintain(maintenance);
    assert.equal(inspected.size, missionIds.length);
    const lastDirectory = join(root, missionIds.at(-1)!);
    assert.deepEqual(JSON.parse(await readFile(join(lastDirectory, "lease.json"), "utf8")), {
      mode: "failed",
      expiresAt: 0,
    });
    assert.equal(typeof JSON.parse(await readFile(join(lastDirectory, "cloud-failure.json"), "utf8")).observedAt,
      "string");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("worktree creation outlives the ordinary Orca request timeout", () => {
  assert.equal(developmentOrcaRequestTimeoutMs(["repo", "show"]), 20_000);
  assert.equal(developmentOrcaRequestTimeoutMs(["terminal", "create"]), 20_000);
  assert.equal(developmentOrcaRequestTimeoutMs(["worktree", "create"]), 120_000);
});

test("recovers a worktree that Orca finishes after its client times out", async () => {
  const temporary = await realpath(await mkdtemp(join(tmpdir(), "codex-development-recovery-")));
  const repository = join(temporary, "repository");
  const stateDirectory = join(temporary, "state");
  const missionId = "00000000-0000-4000-8000-000000000099";
  const missionDirectory = join(stateDirectory, missionId);
  const worktreeName = `ventneuf-mission-${missionId}`;
  const worktreePath = join(temporary, worktreeName);
  const worktreeId = `orca-repository::${worktreePath}`;
  const calls: string[][] = [];
  let delayedCreation: Promise<unknown> | undefined;
  const runGit = (...args: string[]) => execute("/usr/bin/git", args, { timeout: 5_000 });

  class RecoveringAdapter extends AgentDevelopmentAdapter {
    protected override async orca(args: string[], _timeout?: number): Promise<Record<string, unknown>> {
      calls.push(args);
      if (args[0] === "repo") return { repo: { id: "orca-repository", path: repository } };
      if (args[0] === "worktree" && args[1] === "create") {
        delayedCreation = new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
          .then(() => runGit("-C", repository, "worktree", "add", "-b", `test/${worktreeName}`, worktreePath));
        void delayedCreation.catch(() => undefined);
        throw new Error("Orca client timed out.");
      }
      if (args[0] === "terminal" && args[1] === "create") {
        await writeReviewState(join(missionDirectory, "status.json"), { status: "completed" });
        await writeFile(join(missionDirectory, "result.txt"), "Created https://github.com/example/sample/pull/1\n");
        return { terminal: { handle: "term_00000000-0000-4000-8000-000000000001", worktreeId } };
      }
      return { acknowledged: true };
    }
  }

  try {
    await mkdir(repository);
    await runGit("init", "--initial-branch=main", repository);
    await runGit("-C", repository, "config", "user.name", "Test Runner");
    await runGit("-C", repository, "config", "user.email", "runner@example.com");
    await writeFile(join(repository, "README.md"), "test\n");
    await runGit("-C", repository, "add", "README.md");
    await runGit("-C", repository, "commit", "-m", "Initial commit");
    await runGit("-C", repository, "remote", "add", "origin", "https://github.com/example/sample.git");
    const adapter = new RecoveringAdapter({
      orcaPath: "/usr/bin/false",
      agentPath: "/usr/bin/false",
      agent: "codex",
      gitPath: "/usr/bin/git",
      stateDirectory,
    });
    const result = await adapter.execute({
      id: missionId,
      repositoryId: "sample",
      adapter: "codex-development",
      objective: "Open a test pull request",
      authorityExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    }, {
      id: "sample",
      name: "Sample",
      path: repository,
    }, new AbortController().signal, {
      leaseExpiresAt: () => Date.now() + 60_000,
      progress: async () => {},
      requestApproval: async () => { throw new Error("Unexpected approval request."); },
    });

    assert.match(result, /https:\/\/github\.com\/example\/sample\/pull\/1/);
    assert.ok(delayedCreation);
    await delayedCreation;
    assert.equal(calls.some(([group, command]) => group === "worktree" && command === "show"), false);
    assert.ok(calls.some(([group, command]) => group === "terminal" && command === "create"));
  } finally {
    await delayedCreation?.catch(() => undefined);
    await rm(temporary, { recursive: true, force: true });
  }
});
