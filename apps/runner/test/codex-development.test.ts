import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CodexDevelopmentAdapter } from "../src/codex-development.js";
import { writeReviewState } from "../src/review-supervisor.js";

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
