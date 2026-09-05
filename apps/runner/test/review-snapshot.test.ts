import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createReviewSnapshot } from "../src/review-snapshot.js";

test("review snapshots contain committed regular source files and exclude local data, links and oversized files", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "review-snapshot-")));
  const source = join(root, "repository");
  const execute = promisify(execFile);
  try {
    await mkdir(source);
    const git = (...args: string[]) => execute("/usr/bin/git", ["-C", source, ...args]);
    await git("init");
    await writeFile(join(source, "source.ts"), "export const value = 1;\n");
    await writeFile(join(source, ".env"), "PRIVATE=excluded\n");
    await writeFile(join(source, "credentials.json"), "private\n");
    await writeFile(join(source, "AGENTS.md"), "untrusted instructions\n");
    await writeFile(join(source, "huge.ts"), "x".repeat(128_001));
    await symlink(join(source, ".env"), join(source, "link.ts"));
    await git("add", ".");
    await git("-c", "user.name=Runner Test", "-c", "user.email=runner@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "-m", "Test fixture");
    await writeFile(join(source, "local.ts"), "private untracked\n");
    await writeFile(join(source, "source.ts"), "uncommitted change\n");
    const destination = join(root, "snapshot");
    const snapshot = await createReviewSnapshot(source, destination, new AbortController().signal);
    assert.equal(snapshot.files, 1);
    assert.equal(snapshot.totalEntries, 6);
    assert.equal(await readFile(join(destination, "source.ts"), "utf8"), "export const value = 1;\n");
    await assert.rejects(readFile(join(destination, "local.ts")));
    await assert.rejects(createReviewSnapshot(source, join(root, "cancelled"), AbortSignal.abort()));
  } finally { await rm(root, { recursive: true, force: true }); }
});
