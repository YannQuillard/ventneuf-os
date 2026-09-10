import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, readlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { archiveMissionWorkspace } from "../src/mission-archive.js";

const execute = promisify(execFile);

test("archive restores uncommitted, untracked and ignored work plus committed history", async () => {
  const root = await mkdtemp(join(tmpdir(), "mission-archive-"));
  try {
    const repository = join(root, "repository");
    const archive = join(root, "archive");
    const restored = join(root, "restored");
    await mkdir(repository);
    const git = (...args: string[]) => execute("/usr/bin/git", ["-C", repository, ...args]);
    await git("init");
    await git("config", "user.name", "Test");
    await git("config", "user.email", "test@example.com");
    await writeFile(join(repository, "source.txt"), "committed\n");
    await writeFile(join(repository, ".gitignore"), "ignored.txt\n");
    await git("add", ".");
    await git("commit", "-m", "Initial work");
    await writeFile(join(repository, "source.txt"), "unfinished changes\n");
    await writeFile(join(repository, "untracked.txt"), "new work\n");
    await writeFile(join(repository, "ignored.txt"), "local notes\n");
    await symlink("source.txt", join(repository, "link"));
    await archiveMissionWorkspace(repository, archive, "/usr/bin/git");
    await mkdir(restored);
    await execute("/usr/bin/tar", ["-xzf", join(archive, "workspace.tar.gz"), "-C", restored]);
    assert.equal(await readFile(join(restored, "source.txt"), "utf8"), "unfinished changes\n");
    assert.equal(await readFile(join(restored, "untracked.txt"), "utf8"), "new work\n");
    assert.equal(await readFile(join(restored, "ignored.txt"), "utf8"), "local notes\n");
    assert.equal(await readlink(join(restored, "link")), "source.txt");
    await assert.rejects(readFile(join(restored, ".git")), { code: "ENOENT" });
    const history = join(root, "history");
    await execute("/usr/bin/git", ["clone", join(archive, "history.bundle"), history]);
    assert.equal(await readFile(join(history, "source.txt"), "utf8"), "committed\n");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("archive expiry removes only old mission archives, including abandoned partial copies", async () => {
  const { pruneMissionArchives } = await import("../src/mission-archive.js");
  const { stat, utimes } = await import("node:fs/promises");
  const root = await mkdtemp(join(tmpdir(), "mission-archive-retention-"));
  const now = Date.now();
  const retention = 30 * 24 * 60 * 60_000;
  const old = join(root, "00000000-0000-4000-8000-000000000001");
  const recent = join(root, "00000000-0000-4000-8000-000000000002");
  const partial = join(root, "00000000-0000-4000-8000-000000000003");
  const unrelated = join(root, "personal");
  try {
    for (const directory of [old, recent, partial, unrelated]) await mkdir(directory);
    await writeFile(join(old, "archive.json"), JSON.stringify({ archivedAt: new Date(now - retention - 1).toISOString() }));
    await writeFile(join(recent, "archive.json"), JSON.stringify({ archivedAt: new Date(now).toISOString() }));
    await utimes(partial, new Date(now - retention - 1000), new Date(now - retention - 1000));
    await pruneMissionArchives(root, retention, now);
    await assert.rejects(stat(old), { code: "ENOENT" });
    await assert.rejects(stat(partial), { code: "ENOENT" });
    assert.ok((await stat(recent)).isDirectory());
    assert.ok((await stat(unrelated)).isDirectory());
  } finally { await rm(root, { recursive: true, force: true }); }
});
