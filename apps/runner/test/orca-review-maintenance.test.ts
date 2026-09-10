import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { OrcaReviewAdapter } from "../src/orca-review.js";
import { writeReviewState } from "../src/review-supervisor.js";

test("review cleanup waits for cloud completion and closes only the owned terminal", async () => {
  const root = await mkdtemp(join(tmpdir(), "review-maintenance-"));
  const id = "00000000-0000-4000-8000-000000000099";
  const directory = join(root, `${id}-sample`);
  const calls: string[][] = [];
  class Adapter extends OrcaReviewAdapter {
    protected override async orca(args: string[]) { calls.push(args); return {}; }
  }
  try {
    await mkdir(directory);
    await writeReviewState(join(directory, "orca.json"), { missionId: id, worktreeId: "owned-worktree", terminalHandle: "owned-terminal" });
    await writeFile(join(root, `${id}.claimed`), "claimed");
    const adapter = new Adapter({ orcaPath: "/unused", codexPath: "/unused", stateDirectory: root });
    await adapter.maintain({ status: async () => "running" });
    assert.equal(calls.length, 0);
    await adapter.maintain({ status: async () => "completed" });
    assert.deepEqual(calls, [["terminal", "close", "--terminal", "owned-terminal", "--tab"]]);
    await writeReviewState(join(directory, "cleanup.json"), { observedAt: Date.now() - 3_000 });
    await adapter.maintain({ status: async () => "completed" });
    assert.deepEqual(calls.at(-1), ["worktree", "rm", "--worktree", "id:owned-worktree"]);
    await assert.rejects(readFile(join(root, `${id}.claimed`)), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});
