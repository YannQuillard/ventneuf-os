import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { DevelopmentJob } from "./development-supervisor.js";
import {
  MissionPausedError,
  type AgentApprovalRequest,
  type MissionAdapter,
  type MissionExecution,
  type MissionMaintenance,
  type RunnerMission,
  type RegisteredRepository,
} from "./repositories.js";
import { writeReviewState } from "./review-supervisor.js";

const execute = promisify(execFile);
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

interface DevelopmentOrcaState {
  missionId: string;
  repositoryId: string;
  worktreeId: string;
  worktreePath: string;
  terminalHandle?: string;
  createdAt: string;
}

interface DevelopmentStatus {
  status?: "running" | "completed" | "failed";
  failedAt?: string;
}

interface SupervisorHeartbeat { updatedAt?: string }

function within(root: string, candidate: string) {
  const pathFromRoot = relative(root, candidate);
  return candidate === root || (pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot));
}

function remoteLocation(value: string) {
  let host: string | undefined;
  let path: string | undefined;
  try {
    const url = new URL(value);
    host = url.hostname;
    path = url.pathname;
  } catch {
    const scp = value.match(/^(?:[^@\s]+@)?([a-zA-Z0-9.-]+):([^\s]+)$/);
    host = scp?.[1];
    path = scp?.[2];
  }
  const repository = path?.replace(/^\/+/, "").replace(/\.git$/, "");
  return host && repository && /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository)
    ? { host: host.toLowerCase(), repository }
    : undefined;
}

async function readJsonIfPresent<T>(path: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(path, "utf8")) as T; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export class AgentDevelopmentAdapter implements MissionAdapter {
  private readonly root: string;
  private readonly retentionMs: number;
  private maintenanceOffset = 0;

  constructor(private readonly options: {
    orcaPath: string;
    agentPath: string;
    agent: "codex" | "claude";
    gitPath?: string;
    stateDirectory?: string;
    diagnosticRetentionMs?: number;
  }) {
    if (!isAbsolute(options.orcaPath) || !isAbsolute(options.agentPath)
      || (options.gitPath !== undefined && !isAbsolute(options.gitPath))) {
      throw new Error("Orca, agent, and Git executable paths must be absolute.");
    }
    this.root = options.stateDirectory ?? join(homedir(), "Library", "Application Support", "ventneuf.os",
      options.agent === "codex" ? "development" : "claude-development");
    this.retentionMs = options.diagnosticRetentionMs ?? 24 * 60 * 60_000;
  }

  private async orca(args: string[]) {
    const { stdout } = await execute(this.options.orcaPath, [...args, "--json"], {
      timeout: 20_000,
      maxBuffer: 256_000,
      env: { HOME: homedir(), PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8" },
    });
    const envelope = JSON.parse(stdout) as { ok?: boolean; result?: Record<string, unknown> };
    if (!envelope.ok || !envelope.result) throw new Error("Orca request failed.");
    return envelope.result;
  }

  private async gitExecutable() {
    if (this.options.gitPath) return realpath(this.options.gitPath);
    if (process.platform === "darwin") {
      const { stdout } = await execute("/usr/bin/xcrun", ["--find", "git"], {
        timeout: 10_000,
        maxBuffer: 16_000,
        env: { HOME: homedir(), PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8" },
      });
      const path = stdout.trim();
      if (!isAbsolute(path)) throw new Error("Xcode did not return an absolute Git executable path.");
      return realpath(path);
    }
    return realpath("/usr/bin/git");
  }

  private directory(missionId: string) { return join(this.root, missionId); }

  private async launch(directory: string, state: DevelopmentOrcaState) {
    const supervisor = this.options.agent === "codex" ? "development-supervisor.js" : "claude-supervisor.js";
    const command = ["/usr/bin/env", "-i", `HOME=${homedir()}`, "PATH=/usr/bin:/bin", process.execPath,
      fileURLToPath(new URL(`./${supervisor}`, import.meta.url)), directory].map(quote).join(" ");
    const response = await this.orca(["terminal", "create", "--worktree", `path:${state.worktreePath}`,
      "--title", `Mission ${state.missionId.slice(0, 8)}`, "--command", command]);
    const terminal = response.terminal as { handle?: string; worktreeId?: string } | undefined;
    if (!terminal?.handle || !/^term_[a-f0-9-]{36}$/.test(terminal.handle) || terminal.worktreeId !== state.worktreeId) {
      throw new Error("Unexpected Orca terminal response.");
    }
    const updated = { ...state, terminalHandle: terminal.handle };
    await writeReviewState(join(directory, "orca.json"), updated);
    return updated;
  }

  private async relaunch(directory: string, state: DevelopmentOrcaState) {
    if (state.terminalHandle) {
      await this.orca(["terminal", "close", "--terminal", state.terminalHandle, "--tab"]).catch(() => undefined);
    }
    return this.launch(directory, { ...state, terminalHandle: undefined });
  }

  private async createMission(
    mission: RunnerMission,
    repository: RegisteredRepository,
    directory: string,
    authorityExpiresAt: number,
  ) {
    await mkdir(directory, { mode: 0o700 });
    const registration = (await this.orca(["repo", "show", "--repo", `path:${repository.path}`])).repo as {
      id?: string;
      path?: string;
    } | undefined;
    if (!registration?.id || registration.path !== repository.path) throw new Error("Unexpected Orca repository response.");
    const worktreeName = `ventneuf-mission-${mission.id}`;
    const created = await this.orca(["worktree", "create", "--repo", `path:${repository.path}`,
      "--name", worktreeName, "--setup", "skip", "--no-parent"]);
    const worktree = created.worktree as {
      id?: string;
      repoId?: string;
      displayName?: string;
      path?: string;
      isMainWorktree?: boolean;
    } | undefined;
    if (!worktree?.id || !worktree.path || !isAbsolute(worktree.path) || worktree.path === repository.path
      || worktree.repoId !== registration.id || worktree.displayName !== worktreeName || worktree.isMainWorktree !== false) {
      throw new Error("Unexpected Orca worktree response.");
    }
    const worktreePath = await realpath(worktree.path);
    const state: DevelopmentOrcaState = {
      missionId: mission.id,
      repositoryId: repository.id,
      worktreeId: worktree.id,
      worktreePath,
      createdAt: new Date().toISOString(),
    };
    await writeReviewState(join(directory, "orca.json"), state);
    const gitPath = await this.gitExecutable();
    const { stdout } = await execute(gitPath, ["-C", worktreePath, "rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"], {
      timeout: 10_000,
      maxBuffer: 16_000,
      env: { HOME: homedir(), PATH: `${dirname(gitPath)}:/usr/bin:/bin`, LANG: "en_US.UTF-8" },
    });
    const [gitDirectoryText, gitCommonDirectoryText] = stdout.trim().split("\n");
    if (!gitDirectoryText || !gitCommonDirectoryText) throw new Error("Git did not return mission metadata paths.");
    const gitDirectory = await realpath(resolve(worktreePath, gitDirectoryText));
    const gitCommonDirectory = await realpath(resolve(worktreePath, gitCommonDirectoryText));
    const registeredGit = await realpath(join(repository.path, ".git"));
    if (gitCommonDirectory !== registeredGit || !within(gitCommonDirectory, gitDirectory)) {
      throw new Error("The Orca worktree is outside the registered Git repository.");
    }
    const { stdout: branchOutput } = await execute(gitPath, ["-C", worktreePath, "symbolic-ref", "--quiet", "HEAD"], {
      timeout: 10_000,
      maxBuffer: 16_000,
      env: { HOME: homedir(), PATH: `${dirname(gitPath)}:/usr/bin:/bin`, LANG: "en_US.UTF-8" },
    });
    const branchRef = branchOutput.trim();
    if (!/^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._/-]{0,240}$/.test(branchRef)
      || branchRef.includes("..") || branchRef.includes("//") || branchRef.endsWith("/") || branchRef.endsWith(".")) {
      throw new Error("The Orca worktree did not create a safe mission branch.");
    }
    const gitObjectsDirectory = await realpath(join(gitCommonDirectory, "objects"));
    const gitBranchRef = await realpath(join(gitCommonDirectory, branchRef));
    const gitBranchLog = resolve(gitCommonDirectory, "logs", branchRef);
    if (!within(gitCommonDirectory, gitObjectsDirectory) || !within(gitCommonDirectory, gitBranchRef)
      || !within(gitCommonDirectory, gitBranchLog)) throw new Error("Invalid Git mission metadata paths.");
    const readIdentity = async (key: "user.name" | "user.email") => {
      const { stdout: value } = await execute(gitPath, ["-C", repository.path, "config", "--get", key], {
        timeout: 10_000,
        maxBuffer: 1_000,
        env: { HOME: homedir(), PATH: `${dirname(gitPath)}:/usr/bin:/bin`, LANG: "en_US.UTF-8" },
      });
      return value.trim();
    };
    const gitAuthorName = await readIdentity("user.name");
    const gitAuthorEmail = await readIdentity("user.email");
    if (!gitAuthorName || gitAuthorName.length > 100 || !gitAuthorEmail || gitAuthorEmail.length > 254
      || /[\u0000-\u001f\u007f]/.test(gitAuthorName) || /[\u0000-\u001f\u007f]/.test(gitAuthorEmail)) {
      throw new Error("The registered repository has no valid Git author identity.");
    }
    const { stdout: remoteOutput } = await execute(gitPath, ["-C", repository.path, "remote", "get-url", "origin"], {
      timeout: 10_000,
      maxBuffer: 1_000,
      env: { HOME: homedir(), PATH: `${dirname(gitPath)}:/usr/bin:/bin`, LANG: "en_US.UTF-8" },
    });
    const { stdout: pushRemoteOutput } = await execute(gitPath, ["-C", repository.path, "remote", "get-url", "--push", "origin"], {
      timeout: 10_000,
      maxBuffer: 1_000,
      env: { HOME: homedir(), PATH: `${dirname(gitPath)}:/usr/bin:/bin`, LANG: "en_US.UTF-8" },
    });
    const origin = remoteLocation(remoteOutput.trim());
    const pushOrigin = remoteLocation(pushRemoteOutput.trim());
    if (!origin || !pushOrigin || origin.host.length > 253
      || origin.host !== pushOrigin.host || origin.repository !== pushOrigin.repository) {
      throw new Error("The registered repository has no safe origin host.");
    }
    const job: DevelopmentJob = {
      agent: this.options.agent,
      agentPath: this.options.agentPath,
      missionId: mission.id,
      repositoryId: repository.id,
      objective: mission.objective,
      ...(this.options.agent === "codex" ? { codexPath: this.options.agentPath } : { claudePath: this.options.agentPath }),
      gitPath,
      gitAuthorName,
      gitAuthorEmail,
      worktree: worktreePath,
      gitDirectory,
      gitCommonDirectory,
      gitObjectsDirectory,
      gitBranchRef,
      gitBranchLog,
      remoteHost: origin.host,
      remoteRepository: origin.repository,
      authorityExpiresAt,
    };
    await writeReviewState(join(directory, "job.json"), job);
    return this.launch(directory, state);
  }

  private async clean(directory: string, state: DevelopmentOrcaState, requireClean: boolean) {
    if (state.terminalHandle) {
      await this.orca(["terminal", "close", "--terminal", state.terminalHandle, "--tab"]).catch(() => undefined);
    }
    await rm(join(state.worktreePath, ".ventneuf-tmp"), { recursive: true, force: true }).catch(() => undefined);
    const gitPath = await this.gitExecutable();
    let clean = false;
    try {
      const { stdout } = await execute(gitPath, ["-C", state.worktreePath, "status", "--porcelain=v1", "-z"], {
        timeout: 10_000,
        maxBuffer: 64_000,
        env: { HOME: homedir(), PATH: `${dirname(gitPath)}:/usr/bin:/bin`, LANG: "en_US.UTF-8" },
      });
      clean = stdout.length === 0;
    } catch { /* Retain an unavailable or ambiguous worktree. */ }
    if (!clean) {
      if (requireClean) throw new Error("The mission worktree contains uncommitted changes and was retained.");
      return false;
    }
    await this.orca(["worktree", "rm", "--worktree", `id:${state.worktreeId}`]);
    await rm(directory, { recursive: true, force: true });
    return true;
  }

  async maintain(maintenance: MissionMaintenance) {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const available = (await readdir(this.root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^[a-f0-9-]{36}$/.test(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name));
    const count = Math.min(20, available.length);
    const entries = Array.from({ length: count }, (_, index) => available[(this.maintenanceOffset + index) % available.length]!);
    this.maintenanceOffset = available.length ? (this.maintenanceOffset + count) % available.length : 0;
    const candidates = (await Promise.all(entries.map(async (entry) => {
      const directory = this.directory(entry.name);
      const state = await readJsonIfPresent<DevelopmentOrcaState>(join(directory, "orca.json"));
      return state?.missionId === entry.name ? { directory, state } : undefined;
    }))).filter((candidate): candidate is { directory: string; state: DevelopmentOrcaState } => Boolean(candidate));
    const statuses = await Promise.all(candidates.map(({ state }) => maintenance.status(state.missionId).catch(() => undefined)));
    for (const [index, candidate] of candidates.entries()) {
      const { directory, state } = candidate;
      const cloud = statuses[index];
      if (cloud === "cancelled" || cloud === "completed" || cloud === "failed") {
        await writeReviewState(join(directory, "lease.json"), { mode: cloud, expiresAt: 0 });
      }
      if (cloud === "failed") {
        const failurePath = join(directory, "cloud-failure.json");
        const failure = await readJsonIfPresent<{ observedAt?: string }>(failurePath);
        if (!failure?.observedAt) {
          await writeReviewState(failurePath, { observedAt: new Date().toISOString() });
        } else if (Date.parse(failure.observedAt) + this.retentionMs <= Date.now()) {
          await this.clean(directory, state, false).catch(() => undefined);
        }
      } else if (cloud === "cancelled" || cloud === "completed") {
        await this.clean(directory, state, false).catch(() => undefined);
      }
    }
  }

  async execute(mission: RunnerMission, repository: RegisteredRepository, signal: AbortSignal, execution?: MissionExecution) {
    const adapter = `${this.options.agent}-development`;
    const enabled = this.options.agent === "codex" ? repository.codexDevelopment : repository.claudeDevelopment;
    if (mission.adapter !== adapter || mission.repositoryId !== repository.id
      || !enabled || !execution || !/^[a-f0-9-]{36}$/.test(mission.id)
      || !mission.authorityExpiresAt) throw new Error("The development mission is outside this repository scope.");
    const authorityExpiresAt = Date.parse(mission.authorityExpiresAt);
    if (!Number.isFinite(authorityExpiresAt) || authorityExpiresAt <= Date.now()) throw new Error("Development authority expired.");
    signal.throwIfAborted();
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const directory = this.directory(mission.id);
    let state = await readJsonIfPresent<DevelopmentOrcaState>(join(directory, "orca.json"));
    if (!state) state = await this.createMission(mission, repository, directory, authorityExpiresAt);
    if (state.missionId !== mission.id || state.repositoryId !== repository.id
      || !isAbsolute(state.worktreePath) || !state.worktreeId || !state.terminalHandle) {
      throw new Error("Invalid or incomplete local development mission state.");
    }
    const job = await readJsonIfPresent<DevelopmentJob>(join(directory, "job.json"));
    const gitPath = await this.gitExecutable();
    const configuredAgentPath = job?.agentPath
      ?? (this.options.agent === "codex" ? job?.codexPath : job?.claudePath);
    if (!job || job.missionId !== mission.id || job.repositoryId !== repository.id
      || job.objective !== mission.objective || job.worktree !== state.worktreePath
      || (job.agent ?? "codex") !== this.options.agent
      || configuredAgentPath !== this.options.agentPath || job.gitPath !== gitPath
      || job.authorityExpiresAt !== authorityExpiresAt
      || await realpath(state.worktreePath) !== state.worktreePath) {
      throw new Error("The retained development job does not match the claimed mission.");
    }
    await writeReviewState(join(directory, "lease.json"), { mode: "running", expiresAt: execution.leaseExpiresAt() });
    let leaseWriter: ReturnType<typeof setInterval> | undefined;
    let writing = Promise.resolve();
    const updateLease = () => {
      writing = writing.then(() => writeReviewState(join(directory, "lease.json"), {
        mode: signal.aborted ? "stopped" : "running",
        expiresAt: signal.aborted ? 0 : execution.leaseExpiresAt(),
      }));
      void writing.catch(() => undefined);
    };
    leaseWriter = setInterval(updateLease, 500);
    const abort = () => updateLease();
    signal.addEventListener("abort", abort, { once: true });
    try {
      const local = await readJsonIfPresent<DevelopmentStatus>(join(directory, "status.json"));
      const heartbeat = await readJsonIfPresent<SupervisorHeartbeat>(join(directory, "supervisor.json"));
      const supervisorActive = Boolean(heartbeat?.updatedAt && Date.parse(heartbeat.updatedAt) > Date.now() - 5_000);
      if (local?.status === "failed" && (mission.approvalDecision || (mission.attempt ?? 1) > 1)) {
        state = await this.relaunch(directory, state);
      } else if (local?.status === "failed") {
        throw new Error(`The retained ${this.options.agent} supervisor failed.`);
      } else if ((mission.attempt ?? 1) > 1 && local?.status !== "completed" && !supervisorActive) {
        state = await this.relaunch(directory, state);
      }
      if (mission.approvalDecision) {
        const request = await readJsonIfPresent<AgentApprovalRequest>(join(directory, "approval-request.json"));
        const session = await readJsonIfPresent<{ sessionId?: string }>(join(directory, "session.json"));
        const consumed = await readJsonIfPresent<{ approvalId?: string; requestId?: string; sessionId?: string }>(
          join(directory, "approval-consumed.json"),
        );
        const alreadyConsumed = consumed?.approvalId === mission.approvalDecision.id
          && consumed.requestId === mission.approvalDecision.requestId
          && consumed.sessionId === mission.approvalDecision.resume.sessionId;
        if (alreadyConsumed) {
          if (request?.requestId === mission.approvalDecision.requestId) {
            await rm(join(directory, "approval-request.json"), { force: true });
          }
          const decision = await readJsonIfPresent<{ requestId?: string }>(join(directory, "approval-decision.json"));
          if (decision?.requestId === mission.approvalDecision.requestId) {
            await rm(join(directory, "approval-decision.json"), { force: true });
          }
        } else {
          if (!request || request.requestId !== mission.approvalDecision.requestId
            || request.resume.sessionId !== mission.approvalDecision.resume.sessionId
            || session?.sessionId !== mission.approvalDecision.resume.sessionId) {
            throw new Error(`The approval decision does not match the suspended ${this.options.agent} session.`);
          }
          await writeReviewState(join(directory, "approval-decision.json"), {
            approvalId: mission.approvalDecision.id,
            requestId: request.requestId,
            status: mission.approvalDecision.status,
            rationale: mission.approvalDecision.rationale,
          });
          await execution.progress(`${this.options.agent === "codex" ? "Codex" : "Claude"} resumed after the ${mission.approvalDecision.status} approval decision.`);
        }
      }
      await execution.progress(`${this.options.agent === "codex" ? "Codex" : "Claude"} is working in an isolated Orca worktree. Repository changes are allowed only within this mission.`);
      while (true) {
        signal.throwIfAborted();
        await writing;
        const status = await readJsonIfPresent<DevelopmentStatus>(join(directory, "status.json"));
        if (status?.status === "completed") {
          const resultPath = join(directory, "result.txt");
          if ((await stat(resultPath)).size > 64_000) throw new Error("Development result too large.");
          const result = (await readFile(resultPath, "utf8")).trim()
            .replaceAll(state.worktreePath, repository.id).replaceAll(repository.path, repository.id).replaceAll(homedir(), "~");
          if (!result) throw new Error("Empty development result.");
          if (!/https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/\d+/i.test(result)) {
            throw new Error(`${this.options.agent === "codex" ? "Codex" : "Claude"} completed without reporting a pull request URL.`);
          }
          const { stdout: currentBranchRef } = await execute(gitPath, ["-C", state.worktreePath, "symbolic-ref", "--quiet", "HEAD"], {
            timeout: 10_000,
            maxBuffer: 16_000,
            env: { HOME: homedir(), PATH: `${dirname(gitPath)}:/usr/bin:/bin`, LANG: "en_US.UTF-8" },
          });
          if (resolve(job.gitCommonDirectory, currentBranchRef.trim()) !== job.gitBranchRef) {
            throw new Error(`${this.options.agent === "codex" ? "Codex" : "Claude"} left the isolated mission branch.`);
          }
          try {
            await this.clean(directory, state, true);
          } catch (error) {
            await writeReviewState(join(directory, "status.json"), { status: "failed", failedAt: new Date().toISOString() });
            throw error;
          }
          return `${this.options.agent === "codex" ? "Codex" : "Claude"} development mission completed for ${repository.id}.\n\n${result.slice(0, 14_000)}`;
        }
        if (status?.status === "failed") throw new Error(`${this.options.agent === "codex" ? "Codex" : "Claude"} development supervisor failed.`);
        const request = await readJsonIfPresent<AgentApprovalRequest>(join(directory, "approval-request.json"));
        const decision = await readJsonIfPresent<{ requestId?: string }>(join(directory, "approval-decision.json"));
        if (request && decision?.requestId !== request.requestId) {
          const response = await execution.requestApproval(request);
          if (response.approval.status === "pending") {
            await writeReviewState(join(directory, "lease.json"), {
              mode: "waiting_for_approval",
              expiresAt: Math.min(authorityExpiresAt, Date.parse(response.approval.expiresAt)),
            });
            await execution.progress(`${this.options.agent === "codex" ? "Codex" : "Claude"} is waiting for ${response.approval.route} approval for ${request.action.category}.`)
              .catch(() => undefined);
            throw new MissionPausedError("The development mission is waiting for approval.");
          }
          await writeReviewState(join(directory, "approval-decision.json"), {
            approvalId: response.approval.id,
            requestId: request.requestId,
            status: response.approval.status,
          });
        }
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
      }
    } finally {
      if (leaseWriter) clearInterval(leaseWriter);
      signal.removeEventListener("abort", abort);
      await writing.catch(() => undefined);
      if (signal.aborted) {
        await writeReviewState(join(directory, "lease.json"), { mode: "stopped", expiresAt: 0 }).catch(() => undefined);
        await this.clean(directory, state, false).catch(() => undefined);
      }
    }
  }
}

export class CodexDevelopmentAdapter extends AgentDevelopmentAdapter {
  constructor(options: {
    orcaPath: string;
    codexPath: string;
    gitPath?: string;
    stateDirectory?: string;
    diagnosticRetentionMs?: number;
  }) {
    super({ ...options, agent: "codex", agentPath: options.codexPath });
  }
}
