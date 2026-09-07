import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, opendir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import type { AgentExecutionSnapshot } from "@ventneuf/domain";

export const claudeModelAliases = ["opus", "sonnet", "fable"] as const;
export type ClaudeModel = typeof claudeModelAliases[number];

export function isClaudeModel(value: unknown): value is ClaudeModel {
  return typeof value === "string" && claudeModelAliases.includes(value as ClaudeModel);
}

function isClaudeModelList(value: unknown): value is ClaudeModel[] {
  return Array.isArray(value) && value.length > 0 && value.length <= claudeModelAliases.length
    && value.every(isClaudeModel) && new Set(value).size === value.length;
}

export interface RegisteredRepository {
  id: string;
  name: string;
  path: string;
  orcaReview?: boolean;
  codexDevelopment?: boolean;
  claudeDevelopment?: boolean;
  claudeModels?: ClaudeModel[];
}
export const defaultRepositoriesFile = () => join(homedir(), ".config", "ventneuf.os", "repositories.json");

function repositoryId(name: string, path: string) {
  const slug = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48)
    || basename(path).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48)
    || "repository";
  return `${slug}-${createHash("sha256").update(path).digest("hex").slice(0, 8)}`;
}

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
      || (entry.codexDevelopment !== undefined && typeof entry.codexDevelopment !== "boolean")
      || (entry.claudeDevelopment !== undefined && typeof entry.claudeDevelopment !== "boolean")
      || (entry.claudeModels !== undefined && !isClaudeModelList(entry.claudeModels))
      || (entry.claudeModels !== undefined && entry.claudeDevelopment !== true)) {
      throw new Error("Invalid repository configuration.");
    }
    ids.add(entry.id);
    const path = await realpath(entry.path);
    if (!(await stat(path)).isDirectory()) throw new Error("A registered repository must be a directory.");
    repositories.push({ id: entry.id, name: entry.name.trim(), path,
      ...(entry.orcaReview === true ? { orcaReview: true } : {}),
      ...(entry.codexDevelopment === true ? { codexDevelopment: true } : {}),
      ...(entry.claudeDevelopment === true ? { claudeDevelopment: true } : {}),
      ...(entry.claudeModels !== undefined ? { claudeModels: [...entry.claudeModels] } : {}),
    });
  }
  return repositories;
}

export async function addRegisteredRepository(configurationPath: string, input: { name: string; path: string }) {
  const name = input.name.trim();
  if (!name || name.length > 100 || !isAbsolute(input.path) || input.path.length > 4_096) {
    throw new Error("Enter a name and an absolute repository path.");
  }
  const path = await realpath(input.path);
  if (!(await stat(path)).isDirectory()) throw new Error("The repository path must be a directory.");
  const repositories = await loadRepositories(configurationPath);
  if (repositories.some((repository) => repository.path === path)) {
    throw new Error("This repository is already registered.");
  }
  if (repositories.length >= 100) throw new Error("The repository configuration is full.");
  const repository: RegisteredRepository = { id: repositoryId(name, path), name, path };
  if (repositories.some(({ id }) => id === repository.id)) throw new Error("A repository with this identity is already registered.");
  await mkdir(dirname(configurationPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${configurationPath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify([...repositories, repository], null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await rename(temporaryPath, configurationPath);
  return repository;
}

export interface RunnerMission {
  id: string;
  repositoryId: string;
  adapter: "repository-check" | "orca-review" | "codex-development" | "claude-development";
  objective: string;
  attempt?: number;
  authorityExpiresAt?: string;
  model?: ClaudeModel;
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
  execution?(snapshot: AgentExecutionSnapshot): Promise<void>;
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
