import { lstat, opendir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export interface RegisteredRepository {
  id: string;
  name: string;
  path: string;
  orcaReview?: boolean;
  codexDevelopment?: boolean;
}
export const defaultRepositoriesFile = () => join(homedir(), ".config", "ventneuf.os", "repositories.json");

export async function loadRepositories(path: string): Promise<RegisteredRepository[]> {
  try {
    if ((await stat(path)).size > 65_536) throw new Error("Repository configuration is too large.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const entries: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(entries) || entries.length > 100) throw new Error("Invalid repository configuration.");
  const ids = new Set<string>();
  const repositories: RegisteredRepository[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(entry.id)
      || ids.has(entry.id) || typeof entry.name !== "string" || !entry.name.trim() || entry.name.length > 100
      || typeof entry.path !== "string" || !isAbsolute(entry.path)
      || (entry.orcaReview !== undefined && typeof entry.orcaReview !== "boolean")
      || (entry.codexDevelopment !== undefined && typeof entry.codexDevelopment !== "boolean")) {
      throw new Error("Invalid repository configuration.");
    }
    ids.add(entry.id);
    const path = await realpath(entry.path);
    if (!(await stat(path)).isDirectory()) throw new Error("A registered repository must be a directory.");
    repositories.push({ id: entry.id, name: entry.name.trim(), path,
      ...(entry.orcaReview === true ? { orcaReview: true } : {}),
      ...(entry.codexDevelopment === true ? { codexDevelopment: true } : {}),
    });
  }
  return repositories;
}

export interface RunnerMission {
  id: string;
  repositoryId: string;
  adapter: "repository-check" | "orca-review" | "codex-development";
  objective: string;
  attempt?: number;
  authorityExpiresAt?: string;
  approvalDecision?: MissionApprovalDecision;
}
export interface MissionApprovalDecision {
  id: string;
  requestId: string;
  status: "approved" | "rejected" | "expired";
  action: MissionApprovalAction;
  resume: { adapter: "codex" | "claude"; sessionId: string };
  rationale?: string;
}
export interface MissionApprovalAction {
  category: "repository.write" | "development.command" | "network.access"
    | "pull_request.create" | "pull_request.merge" | "deployment.apply" | "connector.write";
  target: string;
  argumentsDigest: string;
  summary: string;
  expectedEffect: string;
}
export interface AgentApprovalRequest {
  requestId: string;
  action: MissionApprovalAction;
  reason: string;
  evidence: Record<string, unknown>;
  resume: { adapter: "codex" | "claude"; sessionId: string };
}
export interface AgentApprovalResponse {
  approval: {
    id: string;
    route: "automatic" | "hermes" | "human";
    status: "pending" | "approved" | "rejected" | "cancelled" | "expired";
    expiresAt: string;
  };
}
export interface MissionExecution {
  leaseExpiresAt(): number;
  progress(content: string): Promise<void>;
  requestApproval(request: AgentApprovalRequest): Promise<AgentApprovalResponse>;
}
export type MissionStatus = "queued" | "running" | "waiting_for_approval" | "completed" | "failed" | "cancelled";
export interface MissionMaintenance {
  status(missionId: string): Promise<MissionStatus | undefined>;
}
export interface MissionAdapter {
  execute(mission: RunnerMission, repository: RegisteredRepository, signal: AbortSignal, execution?: MissionExecution): Promise<string>;
  maintain?(maintenance: MissionMaintenance): Promise<void>;
}

export class MissionPausedError extends Error {}

// No shell, source file reads, recursive traversal, or repository-controlled code execution.
export class RepositoryCheckAdapter implements MissionAdapter {
  async execute(mission: RunnerMission, repository: RegisteredRepository, signal: AbortSignal) {
    if (mission.adapter !== "repository-check" || mission.repositoryId !== repository.id) {
      throw new Error("The mission is outside this repository scope.");
    }
    signal.throwIfAborted();
    if (await realpath(repository.path) !== repository.path) throw new Error("The registered repository moved.");
    let entries = 0;
    const directory = await opendir(repository.path);
    for await (const _entry of directory) {
      signal.throwIfAborted();
      entries += 1;
      if (entries >= 10_000) break;
    }
    let gitMetadata = false;
    try { gitMetadata = !(await lstat(join(repository.path, ".git"))).isSymbolicLink(); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    signal.throwIfAborted();
    return `Repository check completed for ${repository.id}.\n\nThe registered directory is accessible. It contains ${entries >= 10_000 ? "at least " : ""}${entries} top-level entries. Git metadata is ${gitMetadata ? "present" : "absent"}. No files were changed.`;
  }
}
