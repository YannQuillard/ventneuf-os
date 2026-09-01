import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type VaultName = string;

interface FileConfig {
  identity?: string;
  vaults?: Record<string, string>;
  missionsFile?: string;
  hermesA2aUrl?: string;
}

export interface AppConfig {
  identity: string;
  vaults: Record<string, string>;
  missionsFile: string;
  hermesA2aUrl?: string;
  hermesA2aToken?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const configPath =
    env.VENTNEUF_OS_CONFIG ??
    join(homedir(), ".config", "ventneuf-os", "config.json");
  let fileConfig: FileConfig = {};
  try {
    fileConfig = JSON.parse(readFileSync(configPath, "utf8")) as FileConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const envVaults = env.VENTNEUF_VAULTS_JSON
    ? (JSON.parse(env.VENTNEUF_VAULTS_JSON) as Record<string, string>)
    : undefined;
  const vaults = envVaults ?? fileConfig.vaults ?? {};
  if (Object.keys(vaults).length === 0) {
    throw new Error(
      `No vaults are configured. Add a vaults object to ${configPath} or set VENTNEUF_VAULTS_JSON.`,
    );
  }

  return {
    identity: env.VENTNEUF_IDENTITY ?? fileConfig.identity ?? "local-user",
    vaults,
    missionsFile:
      env.VENTNEUF_MISSIONS_FILE ??
      fileConfig.missionsFile ??
      join(homedir(), ".ventneuf-os", "missions.json"),
    hermesA2aUrl: env.VENTNEUF_HERMES_A2A_URL ?? fileConfig.hermesA2aUrl,
    hermesA2aToken: env.VENTNEUF_HERMES_A2A_TOKEN,
  };
}
