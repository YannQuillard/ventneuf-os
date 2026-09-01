import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import type { AppConfig, VaultName } from "./config.js";

const MAX_READ_BYTES = 512_000;
const MAX_SEARCH_RESULTS = 50;

export interface SearchResult {
  vault: VaultName;
  path: string;
  matches: Array<{ line: number; excerpt: string }>;
}

function assertVisiblePath(path: string): void {
  const segments = path.split(/[\\/]+/);
  if (segments.some((segment) => segment === ".." || segment.startsWith("."))) {
    throw new Error("Hidden paths and path traversal are not allowed.");
  }
}

async function safeMarkdownPath(
  config: AppConfig,
  vault: VaultName,
  requestedPath: string,
): Promise<{ absolute: string; relative: string }> {
  const configuredRoot = config.vaults[vault];
  if (!configuredRoot) throw new Error(`Unknown or unauthorized vault: ${vault}`);
  assertVisiblePath(requestedPath);
  const root = await realpath(configuredRoot);
  const absolute = resolve(root, requestedPath);
  const rel = relative(root, absolute);
  if (rel === "" || rel.startsWith(`..${sep}`) || rel === "..") {
    throw new Error("The requested file must be inside the selected vault.");
  }
  if (extname(absolute).toLowerCase() !== ".md") {
    throw new Error("Only Markdown files can be read.");
  }
  const stat = await lstat(absolute);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error("The requested path is not a regular Markdown file.");
  }
  const canonical = await realpath(absolute);
  if (!canonical.startsWith(`${root}${sep}`)) {
    throw new Error("The resolved path is outside the authorized vault.");
  }
  if (stat.size > MAX_READ_BYTES) {
    throw new Error(`The file exceeds the ${MAX_READ_BYTES}-byte limit.`);
  }
  return { absolute: canonical, relative: rel };
}

async function listMarkdownFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = resolve(directory, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") {
        files.push(fullPath);
      }
    }
  }
  await walk(root);
  return files;
}

export async function readKnowledge(
  config: AppConfig,
  vault: VaultName,
  path: string,
): Promise<{ vault: VaultName; path: string; content: string }> {
  const safe = await safeMarkdownPath(config, vault, path);
  return {
    vault,
    path: safe.relative,
    content: await readFile(safe.absolute, "utf8"),
  };
}

export async function searchKnowledge(
  config: AppConfig,
  query: string,
  vaults: VaultName[],
  limit = 20,
): Promise<SearchResult[]> {
  const normalized = query.trim().toLocaleLowerCase("fr");
  if (!normalized) throw new Error("The search query cannot be empty.");
  const boundedLimit = Math.min(Math.max(limit, 1), MAX_SEARCH_RESULTS);
  const results: SearchResult[] = [];

  for (const vault of vaults) {
    const configuredRoot = config.vaults[vault];
    if (!configuredRoot) throw new Error(`Unknown or unauthorized vault: ${vault}`);
    const root = await realpath(configuredRoot);
    for (const absolute of await listMarkdownFiles(root)) {
      const content = await readFile(absolute, "utf8");
      const matches = content
        .split(/\r?\n/)
        .map((line, index) => ({ line: index + 1, excerpt: line.trim() }))
        .filter(({ excerpt }) => excerpt.toLocaleLowerCase("fr").includes(normalized))
        .slice(0, 5);
      if (matches.length > 0) {
        results.push({ vault, path: relative(root, absolute), matches });
      }
      if (results.length >= boundedLimit) return results;
    }
  }
  return results;
}
