import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, mkdir, opendir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import type { AgentExecutionSnapshot } from "@ventneuf/domain";
import type { ReasoningEffort } from "@ventneuf/domain";

const execute = promisify(execFile);

export const claudeModelAliases = ["opus", "sonnet", "fable"] as const;
export type ClaudeModel = typeof claudeModelAliases[number];

export function isClaudeModel(value: unknown): value is ClaudeModel {
  return typeof value === "string" && claudeModelAliases.includes(value as ClaudeModel);
}

function isClaudeModelList(value: unknown): value is ClaudeModel[] {
  return Array.isArray(value) && value.length > 0 && value.length <= claudeModelAliases.length
    && value.every(isClaudeModel) && new Set(value).size === value.length;
}

function isCodexModelList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 20
    && value.every(model => typeof model === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,99}$/.test(model))
    && new Set(value).size === value.length;
}

export interface RegisteredRepository {
  id: string;
  name: string;
  path: string;
  orcaReview?: boolean;
  codexDevelopment?: boolean;
  codexModels?: string[];
  claudeDevelopment?: boolean;
  claudeModels?: ClaudeModel[];
  github?: GitHubRepositoryIdentity;
}
export interface GitHubRepositoryIdentity { id?: string; owner: string; name: string }
export const defaultRepositoriesFile = () => join(homedir(), ".config", "ventneuf.os", "repositories.json");

function repositoryId(name: string, path: string) {
  const slug = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48)
    || basename(path).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48)
    || "repository";
  return `${slug}-${createHash("sha256").update(path).digest("hex").slice(0, 8)}`;
}

function githubRepositoryId(identity: GitHubRepositoryIdentity) {
  return `github-${createHash("sha256").update(identity.id ?? `${identity.owner}/${identity.name}`).digest("hex").slice(0, 32)}`;
}

export function parseGitHubRepository(value: string): GitHubRepositoryIdentity {
  const input = value.trim();
  const sshMatch = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i.exec(input);
  let owner: string | undefined;
  let name: string | undefined;
  if (sshMatch) [, owner, name] = sshMatch;
  else {
    let url: URL;
    try { url = new URL(input.includes("://") ? input : `https://${input}`); }
    catch { throw new Error("Enter a valid GitHub repository URL."); }
    if (url.hostname.toLowerCase() !== "github.com" || url.username || url.password || url.search || url.hash) {
      throw new Error("Enter a valid github.com repository URL.");
    }
    const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
    if (parts.length !== 2) throw new Error("Enter a GitHub repository URL in owner/repository format.");
    [owner, name] = parts;
    name = name?.replace(/\.git$/i, "");
  }
  if (!owner || !name || !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})$/.test(owner)
    || !/^[a-zA-Z0-9._-]{1,100}$/.test(name)) throw new Error("Enter a valid GitHub repository URL.");
  return { owner: owner.toLowerCase(), name: name.toLowerCase() };
}

function sameGitHubRepository(left: GitHubRepositoryIdentity, right: GitHubRepositoryIdentity) {
  if (left.id && right.id) return left.id === right.id;
  return left.owner === right.owner && left.name === right.name;
}

async function repositoryOrigin(path: string) {
  try {
    const { stdout } = await execute("/usr/bin/git", ["-c", "core.hooksPath=/dev/null", "-C", path, "remote", "get-url", "origin"], {
      timeout: 5_000,
      maxBuffer: 8_192,
      env: { PATH: "/usr/bin:/bin", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
    });
    return parseGitHubRepository(stdout.trim());
  } catch { return undefined; }
}

async function findGitHubCheckout(searchRoot: string, identity: GitHubRepositoryIdentity) {
  const root = await realpath(searchRoot);
  if (!(await stat(root)).isDirectory()) throw new Error("The search folder must be a directory.");
  const pending = [{ path: root, depth: 0 }];
  let inspected = 0;
  while (pending.length) {
    const current = pending.shift()!;
    inspected += 1;
    if (inspected > 10_000) throw new Error("The search folder contains too many directories. Choose a narrower folder.");
    try {
      const metadata = await lstat(join(current.path, ".git"));
      if (!metadata.isSymbolicLink()) {
        const origin = await repositoryOrigin(current.path);
        if (origin && sameGitHubRepository(origin, identity)) return current.path;
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (current.depth >= 6) continue;
    const directory = await opendir(current.path);
    const children: string[] = [];
    for await (const entry of directory) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name === ".git" || entry.name === "node_modules") continue;
      children.push(join(current.path, entry.name));
    }
    children.sort();
    pending.push(...children.map((path) => ({ path, depth: current.depth + 1 })));
  }
  return undefined;
}

async function saveRepositories(configurationPath: string, repositories: RegisteredRepository[]) {
  await mkdir(dirname(configurationPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${configurationPath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(repositories, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await rename(temporaryPath, configurationPath);
}

function searchRootsPath(configurationPath: string) {
  return `${configurationPath}.search-roots.json`;
}

async function loadSearchRootEntries(configurationPath: string) {
  const path = searchRootsPath(configurationPath);
  try {
    if ((await stat(path)).size > 16_384) throw new Error("Repository search folder configuration is too large.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const entries: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(entries) || entries.length > 20 || entries.some((entry) => typeof entry !== "string" || !isAbsolute(entry))) {
    throw new Error("Invalid repository search folder configuration.");
  }
  return entries as string[];
}

async function saveSearchRoots(configurationPath: string, roots: string[]) {
  const path = searchRootsPath(configurationPath);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(roots, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await rename(temporaryPath, path);
}

export async function hasRepositorySearchRoots(configurationPath: string) {
  return (await loadSearchRootEntries(configurationPath)).length > 0;
}

async function readStoredRepositories(path: string): Promise<RegisteredRepository[]> {
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
      || (entry.codexModels !== undefined && !isCodexModelList(entry.codexModels))
      || (entry.codexModels !== undefined && entry.codexDevelopment !== true)
      || (entry.claudeDevelopment !== undefined && typeof entry.claudeDevelopment !== "boolean")
      || (entry.claudeModels !== undefined && !isClaudeModelList(entry.claudeModels))
      || (entry.claudeModels !== undefined && entry.claudeDevelopment !== true)
      || (entry.github !== undefined && (!entry.github || typeof entry.github.owner !== "string"
        || typeof entry.github.name !== "string"
        || (entry.github.id !== undefined && (typeof entry.github.id !== "string" || !/^[0-9]+$/.test(entry.github.id)))
        || !sameGitHubRepository(parseGitHubRepository(`https://github.com/${entry.github.owner}/${entry.github.name}`), entry.github)))) {
      throw new Error("Invalid repository configuration.");
    }
    ids.add(entry.id);
    repositories.push({ id: entry.id, name: entry.name.trim(), path: entry.path,
      ...(entry.orcaReview === true ? { orcaReview: true } : {}),
      ...(entry.codexDevelopment === true ? { codexDevelopment: true } : {}),
      ...(entry.codexModels !== undefined ? { codexModels: [...entry.codexModels] } : {}),
      ...(entry.claudeDevelopment === true ? { claudeDevelopment: true } : {}),
      ...(entry.claudeModels !== undefined ? { claudeModels: [...entry.claudeModels] } : {}),
      ...(entry.github !== undefined ? { github: { ...(entry.github.id ? { id: entry.github.id } : {}),
        owner: entry.github.owner, name: entry.github.name } } : {}),
    });
  }
  return repositories;
}

async function existingDirectory(path: string) {
  try {
    const resolved = await realpath(path);
    return (await stat(resolved)).isDirectory() ? resolved : undefined;
  } catch { return undefined; }
}

export async function loadRepositories(path: string): Promise<RegisteredRepository[]> {
  const repositories = await readStoredRepositories(path);
  return Promise.all(repositories.map(async (repository) => {
    const resolved = await existingDirectory(repository.path);
    if (!resolved) throw new Error("A registered repository must be a directory.");
    return { ...repository, path: resolved };
  }));
}

export async function repositorySettings(configurationPath: string) {
  const [searchFolders, repositories] = await Promise.all([
    loadSearchRootEntries(configurationPath),
    readStoredRepositories(configurationPath),
  ]);
  return {
    searchFolders: await Promise.all(searchFolders.map(async (path) => ({ path, available: Boolean(await existingDirectory(path)) }))),
    repositories: await Promise.all(repositories.map(async ({ id, name, path, github }) => ({
      id, name, path, available: Boolean(await existingDirectory(path)), ...(github ? { github } : {}),
    }))),
  };
}

async function normalizeFolder(path: string, message: string) {
  if (!isAbsolute(path) || path.length > 4_096) throw new Error("Enter an absolute folder path.");
  const resolved = await existingDirectory(path);
  if (!resolved) throw new Error(message);
  return resolved;
}

export async function addRepositorySearchFolder(configurationPath: string, path: string) {
  const resolved = await normalizeFolder(path, "The search folder must be an existing directory.");
  const roots = await loadSearchRootEntries(configurationPath);
  if (roots.some((root) => root === path || root === resolved)) throw new Error("This search folder is already saved.");
  if (roots.length >= 20) throw new Error("The repository search folder configuration is full.");
  await saveSearchRoots(configurationPath, [...roots, resolved]);
  return resolved;
}

export async function replaceRepositorySearchFolder(configurationPath: string, currentPath: string, nextPath: string) {
  const roots = await loadSearchRootEntries(configurationPath);
  const index = roots.indexOf(currentPath);
  if (index < 0) throw new Error("The search folder is no longer configured.");
  const resolved = await normalizeFolder(nextPath, "The new search folder must be an existing directory.");
  if (roots.some((root, candidate) => candidate !== index && (root === nextPath || root === resolved))) {
    throw new Error("This search folder is already saved.");
  }
  roots[index] = resolved;
  await saveSearchRoots(configurationPath, roots);
  return resolved;
}

export async function removeRepositorySearchFolder(configurationPath: string, path: string) {
  const roots = await loadSearchRootEntries(configurationPath);
  const remaining = roots.filter((root) => root !== path);
  if (remaining.length === roots.length) throw new Error("The search folder is no longer configured.");
  await saveSearchRoots(configurationPath, remaining);
}

export async function removeRegisteredRepository(configurationPath: string, id: string) {
  const repositories = await readStoredRepositories(configurationPath);
  const remaining = repositories.filter((repository) => repository.id !== id);
  if (remaining.length === repositories.length) throw new Error("The repository is no longer registered.");
  await saveRepositories(configurationPath, remaining);
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
  await saveRepositories(configurationPath, [...repositories, repository]);
  return repository;
}

export async function addGitHubRepository(configurationPath: string, input: {
  url: string;
  repositoryId?: string;
  searchRoot?: string;
  repositoryPath?: string;
}) {
  if (input.searchRoot !== undefined && (!isAbsolute(input.searchRoot) || input.searchRoot.length > 4_096)) {
    throw new Error("Enter an absolute folder to search on this Mac.");
  }
  if (input.repositoryId !== undefined && !/^[0-9]+$/.test(input.repositoryId)) throw new Error("The GitHub repository identity is invalid.");
  const identity = { ...parseGitHubRepository(input.url), ...(input.repositoryId ? { id: input.repositoryId } : {}) };
  const roots = await loadSearchRootEntries(configurationPath);
  if (input.searchRoot) {
    const root = await normalizeFolder(input.searchRoot, "The search folder must be an existing directory.");
    if (!roots.includes(root)) {
      if (roots.length >= 20) throw new Error("The repository search folder configuration is full.");
      roots.push(root);
      await saveSearchRoots(configurationPath, roots);
    }
  }
  let path: string | undefined;
  if (input.repositoryPath !== undefined) {
    path = await normalizeFolder(input.repositoryPath, "The repository folder must be an existing directory.");
    const origin = await repositoryOrigin(path);
    if (!origin || !sameGitHubRepository(origin, identity)) {
      throw new Error(`The selected folder is not a checkout of ${identity.owner}/${identity.name}.`);
    }
  } else {
    if (!roots.length) throw new Error("Add a search folder or enter the repository path on this Mac.");
    for (const root of roots) {
      if (!await existingDirectory(root)) continue;
      path = await findGitHubCheckout(root, identity);
      if (path) break;
    }
  }
  if (!path) throw new Error(`No checkout of ${identity.owner}/${identity.name} was found in the configured search folders.`);
  const repositories = await readStoredRepositories(configurationPath);
  const existingIndex = repositories.findIndex((repository) => repository.path === path);
  if (existingIndex >= 0) {
    const existing = repositories[existingIndex]!;
    if (existing.github && sameGitHubRepository(existing.github, identity)) {
      if (!existing.github.id && identity.id) {
        const updated = { ...existing, github: identity };
        repositories[existingIndex] = updated;
        await saveRepositories(configurationPath, repositories);
        return updated;
      }
      throw new Error("This GitHub repository is already connected.");
    }
    const updated = { ...existing, name: `${identity.owner}/${identity.name}`, github: identity };
    repositories[existingIndex] = updated;
    await saveRepositories(configurationPath, repositories);
    return updated;
  }
  const identityIndex = repositories.findIndex((repository) => repository.github && sameGitHubRepository(repository.github, identity));
  if (identityIndex >= 0) {
    const existing = repositories[identityIndex]!;
    if (existing.path === path) throw new Error("This GitHub repository is already connected.");
    const updated = { ...existing, path, github: identity };
    repositories[identityIndex] = updated;
    await saveRepositories(configurationPath, repositories);
    return updated;
  }
  if (repositories.length >= 100) throw new Error("The repository configuration is full.");
  const repository: RegisteredRepository = {
    id: githubRepositoryId(identity),
    name: `${identity.owner}/${identity.name}`,
    path,
    github: identity,
  };
  if (repositories.some(({ id }) => id === repository.id)) throw new Error("A repository with this identity is already registered.");
  await saveRepositories(configurationPath, [...repositories, repository]);
  return repository;
}

export interface RunnerMission {
  id: string;
  repositoryId: string;
  adapter: "repository-check" | "orca-review" | "codex-development" | "claude-development";
  objective: string;
  attempt?: number;
  authorityExpiresAt?: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  subagents?: { models: string[]; reasoningEffort: ReasoningEffort };
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
