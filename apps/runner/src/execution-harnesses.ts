import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { RunnerExecutionHarnesses } from "@ventneuf/domain";
import { isClaudeModel } from "./repositories.js";

export interface InstalledHarnesses { codex: boolean; claude: boolean }

export function executionHarnessesFile(repositoriesFile: string) {
  return `${repositoriesFile}.harnesses.json`;
}

function validModels(value: unknown, maximum: number) {
  return Array.isArray(value) && value.length > 0 && value.length <= maximum
    && value.every(model => typeof model === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,99}$/.test(model))
    && new Set(value).size === value.length;
}

export function validateExecutionHarnesses(value: unknown): RunnerExecutionHarnesses {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Choose valid execution harnesses and models.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !["codex", "claude"].includes(key))) throw new Error("Choose valid execution harnesses and models.");
  const codex = input.codex as Record<string, unknown> | undefined;
  const claude = input.claude as Record<string, unknown> | undefined;
  if (codex !== undefined && (!codex || typeof codex !== "object" || Array.isArray(codex)
      || Object.keys(codex).some(key => key !== "models")
      || (codex.models !== undefined && !validModels(codex.models, 20)))) {
    throw new Error("Choose valid execution harnesses and models.");
  }
  if (claude !== undefined && (!claude || typeof claude !== "object" || Array.isArray(claude)
      || Object.keys(claude).some(key => key !== "models")
      || !validModels(claude.models, 3) || !(claude.models as unknown[]).every(isClaudeModel))) {
    throw new Error("Choose valid execution harnesses and models.");
  }
  return {
    ...(codex ? { codex: { ...(codex.models ? { models: [...codex.models as string[]] } : {}) } } : {}),
    ...(claude ? { claude: { models: [...claude.models as ("opus" | "sonnet" | "fable")[]] } } : {}),
  };
}

async function legacyExecutionHarnesses(path: string, installed: InstalledHarnesses): Promise<RunnerExecutionHarnesses | undefined> {
  let entries: unknown;
  try { entries = JSON.parse(await readFile(path, "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  if (!Array.isArray(entries)) return undefined;
  const codexEntries = entries.filter(entry => entry && typeof entry === "object"
    && (entry as Record<string, unknown>).codexDevelopment === true) as Array<Record<string, unknown>>;
  const claudeEntries = entries.filter(entry => entry && typeof entry === "object"
    && (entry as Record<string, unknown>).claudeDevelopment === true) as Array<Record<string, unknown>>;
  const codexModels = [...new Set(codexEntries.flatMap(entry => Array.isArray(entry.codexModels)
    ? entry.codexModels.filter(model => typeof model === "string") as string[] : []))];
  const claudeModels = [...new Set(claudeEntries.flatMap(entry => Array.isArray(entry.claudeModels)
    ? entry.claudeModels.filter(isClaudeModel) : []))];
  return {
    ...(installed.codex && codexEntries.length ? {
      codex: codexEntries.some(entry => entry.codexModels === undefined) ? {} : { models: codexModels },
    } : {}),
    ...(installed.claude && claudeEntries.length ? { claude: { models: claudeModels.length ? claudeModels : ["opus"] } } : {}),
  };
}

export async function loadExecutionHarnesses(
  path: string,
  installed: InstalledHarnesses,
  legacyRepositoriesPath?: string,
): Promise<RunnerExecutionHarnesses> {
  let stored: RunnerExecutionHarnesses | undefined;
  try {
    if ((await stat(path)).size > 16_384) throw new Error("Execution harness configuration is too large.");
    stored = validateExecutionHarnesses(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (stored) return {
    ...(installed.codex && stored.codex ? { codex: stored.codex } : {}),
    ...(installed.claude && stored.claude ? { claude: stored.claude } : {}),
  };
  const legacy = legacyRepositoriesPath ? await legacyExecutionHarnesses(legacyRepositoriesPath, installed) : undefined;
  return legacy ?? {
    ...(installed.codex ? { codex: {} } : {}),
    ...(installed.claude ? { claude: { models: ["opus"] } } : {}),
  };
}

export async function initializeExecutionHarnesses(
  path: string,
  repositoriesPath: string,
  installed: InstalledHarnesses,
) {
  const harnesses = await loadExecutionHarnesses(path, installed, repositoriesPath);
  try { await stat(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await saveExecutionHarnesses(path, harnesses, installed);
  }
  return harnesses;
}

export async function saveExecutionHarnesses(path: string, value: unknown, installed: InstalledHarnesses) {
  const harnesses = validateExecutionHarnesses(value);
  if ((harnesses.codex && !installed.codex) || (harnesses.claude && !installed.claude)) {
    throw new Error("Install and configure the selected coding agent on this runner first.");
  }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(harnesses, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await rename(temporaryPath, path);
  return harnesses;
}
