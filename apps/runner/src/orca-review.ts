import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { RepositoryCheckAdapter, type MissionAdapter, type MissionExecution, type ReadOnlyMission, type RegisteredRepository } from "./repositories.js";
import { createReviewSnapshot } from "./review-snapshot.js";
import { writeReviewState } from "./review-supervisor.js";

const execute = promisify(execFile);
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export class OrcaReviewAdapter implements MissionAdapter {
  constructor(private readonly options: { orcaPath: string; codexPath: string; stateDirectory?: string }) {
    if (!isAbsolute(options.orcaPath) || !isAbsolute(options.codexPath)) throw new Error("Orca and Codex executable paths must be absolute.");
  }

  async execute(mission: ReadOnlyMission, repository: RegisteredRepository, signal: AbortSignal, execution?: MissionExecution) {
    if (mission.adapter !== "orca-review" || mission.repositoryId !== repository.id || !repository.orcaReview || !execution
      || !/^[a-f0-9-]{36}$/.test(mission.id)) throw new Error("The review is outside this repository scope.");
    signal.throwIfAborted();
    const root = this.options.stateDirectory ?? join(homedir(), "Library", "Application Support", "ventneuf.os", "reviews");
    await mkdir(root, { recursive: true, mode: 0o700 });
    // Exclusive mission marker prevents duplicate local launches across runner restarts.
    await writeFile(join(root, `${mission.id}.claimed`), "claimed\n", { flag: "wx", mode: 0o600 });
    const directory = await realpath(await mkdtemp(join(root, `${mission.id}-`)));
    const snapshotPath = join(directory, "snapshot");
    let leaseWriter: ReturnType<typeof setInterval> | undefined;
    let writing: Promise<void> = Promise.resolve();
    let abortListener: (() => void) | undefined;
    let launched = false;
    let stopped = false;
    const orca = async (args: string[]) => {
      const { stdout } = await execute(this.options.orcaPath, [...args, "--json"], {
        timeout: 20_000, maxBuffer: 256_000,
        env: { HOME: homedir(), PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8" },
      });
      const envelope = JSON.parse(stdout) as { ok?: boolean; result?: Record<string, unknown> };
      if (!envelope.ok || !envelope.result) throw new Error("Orca request failed.");
      return envelope.result;
    };
    try {
      const snapshot = await createReviewSnapshot(repository.path, snapshotPath, signal);
      await execution.progress(`Prepared ${snapshot.files} tracked source files at commit ${snapshot.commit.slice(0, 12)} for a read-only review.`);
      signal.throwIfAborted();
      // Registration is an explicit prerequisite; the runner never imports unrelated projects.
      const registration = (await orca(["repo", "show", "--repo", `path:${repository.path}`])).repo as { id?: string; path?: string } | undefined;
      if (!registration?.id || registration.path !== repository.path) throw new Error("Unexpected Orca repository response.");
      signal.throwIfAborted();
      const worktreeName = `ventneuf-review-${mission.id}`;
      const created = await orca(["worktree", "create", "--repo", `path:${repository.path}`,
        "--name", worktreeName, "--setup", "skip", "--base-branch", snapshot.commit, "--no-parent"]);
      const worktree = created.worktree as { id?: string; repoId?: string; displayName?: string; path?: string; head?: string; isMainWorktree?: boolean } | undefined;
      if (!worktree?.id || !worktree.path || !isAbsolute(worktree.path) || worktree.path === repository.path
        || worktree.repoId !== registration.id || worktree.displayName !== worktreeName
        || worktree.isMainWorktree !== false || worktree.head !== snapshot.commit) {
        throw new Error("Unexpected Orca worktree response.");
      }
      await writeReviewState(join(directory, "orca.json"), { missionId: mission.id, worktreeId: worktree.id, commit: snapshot.commit });
      const deadline = Date.now() + 300_000;
      await writeReviewState(join(directory, "job.json"), {
        codexPath: this.options.codexPath,
        snapshot: snapshotPath,
        deadline,
        objective: mission.objective,
      });
      const writeLease = () => writeReviewState(join(directory, "lease.json"), { expiresAt: signal.aborted ? 0 : execution.leaseExpiresAt() });
      await writeLease();
      const updateLease = () => { writing = writing.then(writeLease); void writing.catch(() => {}); };
      abortListener = updateLease;
      leaseWriter = setInterval(updateLease, 500);
      signal.addEventListener("abort", updateLease, { once: true });
      signal.throwIfAborted();
      // No prompt, source text, device credential, or lease token is interpolated into the shell command.
      const command = ["/usr/bin/env", "-i", `HOME=${homedir()}`, "PATH=/usr/bin:/bin", process.execPath,
        fileURLToPath(new URL("./review-supervisor.js", import.meta.url)), directory].map(quote).join(" ");
      launched = true; // An ambiguous response must never trigger a second terminal creation.
      const response = await orca(["terminal", "create", "--worktree", `path:${worktree.path}`,
        "--title", `Review ${mission.id.slice(0, 8)}`, "--command", command]);
      const terminal = response.terminal as { handle?: string; worktreeId?: string } | undefined;
      if (!terminal?.handle || !/^term_[a-f0-9-]{36}$/.test(terminal.handle) || terminal.worktreeId !== worktree.id) {
        throw new Error("Unexpected Orca terminal response.");
      }
      await writeReviewState(join(directory, "orca.json"), { missionId: mission.id, worktreeId: worktree.id,
        terminalHandle: terminal.handle, commit: snapshot.commit });
      await execution.progress("Codex is reviewing the committed source snapshot in Orca. No repository writes are allowed.");
      while (true) {
        signal.throwIfAborted();
        await writing;
        if (Date.now() >= Math.min(deadline, execution.leaseExpiresAt())) throw new Error("Review deadline reached.");
        let status: { status?: string } | undefined;
        try { status = JSON.parse(await readFile(join(directory, "status.json"), "utf8")); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        if (status) {
          stopped = true;
          if (status.status !== "completed") throw new Error("Codex review failed.");
          const resultPath = join(directory, "result.txt");
          if ((await stat(resultPath)).size > 64_000) throw new Error("Review result too large.");
          const result = (await readFile(resultPath, "utf8")).trim()
            .replaceAll(directory, "[review]").replaceAll(repository.path, repository.id).replaceAll(homedir(), "~");
          if (!result) throw new Error("Empty review result.");
          return `Read-only review of ${repository.id} at ${snapshot.commit.slice(0, 12)} (${snapshot.files} selected files from ${snapshot.totalEntries} tracked entries). Uncommitted files were excluded.\n\n${result.slice(0, 14_000)}`;
        }
        await delay(500, undefined, { signal });
      }
    } finally {
      if (leaseWriter) clearInterval(leaseWriter);
      if (abortListener) signal.removeEventListener("abort", abortListener);
      await writing.catch(() => {});
      await writeReviewState(join(directory, "lease.json"), { expiresAt: 0 });
      // Keep an ambiguous job's snapshot until its independent watchdog has stopped it.
      if (!launched || stopped) await rm(snapshotPath, { recursive: true, force: true });
    }
  }
}

export class RunnerAdapters implements MissionAdapter {
  private readonly check = new RepositoryCheckAdapter();
  constructor(private readonly review?: OrcaReviewAdapter) {}
  execute(mission: ReadOnlyMission, repository: RegisteredRepository, signal: AbortSignal, execution?: MissionExecution) {
    if (mission.adapter === "repository-check") return this.check.execute(mission, repository, signal);
    if (!this.review) throw new Error("Orca review is not configured.");
    return this.review.execute(mission, repository, signal, execution);
  }
}
