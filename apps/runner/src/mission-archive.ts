import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readdir, readFile, readlink, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

async function fingerprint(root: string) {
  const hash = createHash("sha256");
  async function visit(relative: string) {
    const path = join(root, relative);
    const info = await lstat(path);
    hash.update(JSON.stringify([relative, relative ? info.mode : "root"]));
    if (info.isSymbolicLink()) hash.update(await readlink(path));
    else if (info.isDirectory()) {
      for (const name of (await readdir(path)).sort()) {
        if (!relative && name === ".git") continue;
        await visit(join(relative, name));
      }
    } else if (info.isFile()) {
      for await (const chunk of createReadStream(path)) hash.update(chunk);
    } else throw new Error("The mission workspace contains a file that cannot be archived safely.");
  }
  await visit("");
  return hash.digest("hex");
}

// An archive is local recovery data, never a repository artifact or an external upload.
export async function archiveMissionWorkspace(worktree: string, archive: string, gitPath: string) {
  await mkdir(archive, { recursive: true, mode: 0o700 });
  const before = await fingerprint(worktree);
  const pending = join(archive, "workspace.pending.tar.gz");
  const restored = join(archive, "verify");
  await rm(restored, { recursive: true, force: true });
  await mkdir(restored, { mode: 0o700 });
  try {
    await execute("/usr/bin/tar", ["-czf", pending, "--exclude=./.git", "-C", worktree, "."], { timeout: 120_000 });
    await execute("/usr/bin/tar", ["-xzf", pending, "-C", restored], { timeout: 120_000 });
    if (before !== await fingerprint(worktree) || before !== await fingerprint(restored)) {
      throw new Error("Mission archive verification failed; the workspace was retained.");
    }
    // Preserve committed history independently of Orca's branch cleanup.
    await execute(gitPath, ["-C", worktree, "bundle", "create", join(archive, "history.pending.bundle"), "HEAD"], { timeout: 120_000 });
    await execute(gitPath, ["-C", worktree, "bundle", "verify", join(archive, "history.pending.bundle")], { timeout: 120_000 });
    await rename(join(archive, "history.pending.bundle"), join(archive, "history.bundle"));
    await rename(pending, join(archive, "workspace.tar.gz"));
    await writeFile(join(archive, "archive.json"), JSON.stringify({ version: 1, fingerprint: before, archivedAt: new Date().toISOString() }), { mode: 0o600 });
  } finally { await rm(restored, { recursive: true, force: true }); }
}

export async function pruneMissionArchives(root: string, retentionMs: number, now = Date.now()) {
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-f0-9-]{36}$/.test(entry.name)) continue;
    const directory = join(root, entry.name);
    let archivedAt: number;
    try {
      archivedAt = Date.parse((JSON.parse(await readFile(join(directory, "archive.json"), "utf8")) as { archivedAt: string }).archivedAt);
    } catch {
      // Abandoned partial archives are safe to expire: the original workspace was not removed.
      archivedAt = (await stat(directory)).mtimeMs;
    }
    if (Number.isFinite(archivedAt) && now - archivedAt >= retentionMs) {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
