#!/usr/bin/env node
import { hostname, userInfo } from "node:os";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { RunnerCloudClient } from "./cloud-client.js";
import { MacOSKeychainCredentialStore } from "./credential-store.js";
import { installLaunchAgent, launchAgentStatus, uninstallLaunchAgent } from "./launch-agent.js";
import { RunnerMissionWorker } from "./mission-worker.js";
import { defaultRepositoriesFile, loadRepositories, removeLegacyExecutionSettings } from "./repositories.js";
import { CodexDevelopmentAdapter } from "./codex-development.js";
import { ClaudeDevelopmentAdapter } from "./claude-development.js";
import { OrcaReviewAdapter, RunnerAdapters } from "./orca-review.js";
import { LocalRunnerBridge } from "./local-bridge.js";
import { RunnerUpdater } from "./runner-update.js";
import { executionHarnessesFile, initializeExecutionHarnesses, loadExecutionHarnesses } from "./execution-harnesses.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);

async function selectFolder() {
  try {
    const { stdout } = await execute("/usr/bin/osascript", ["-e",
      "POSIX path of (choose folder with prompt \"Choose a folder for ventneuf.os\")"], { timeout: 120_000, maxBuffer: 8_192 });
    return stdout.trim() || undefined;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === 1 || code === "1") return undefined;
    throw error;
  }
}

async function sourceVersion() {
  try {
    if ((await execute("/usr/bin/git", ["status", "--porcelain"], { cwd: process.cwd() })).stdout.trim()) return undefined;
    const version = (await execute("/usr/bin/git", ["rev-parse", "HEAD"], { cwd: process.cwd() })).stdout.trim();
    return /^[0-9a-f]{40}$/.test(version) ? version : undefined;
  } catch { return undefined; }
}

if (process.platform !== "darwin") throw new Error("The first runner release supports macOS only.");

const command = process.argv[2] ?? "serve";
const defaultWebOrigins = "http://localhost:3000";

function controlPlaneUrl() {
  const value = process.env.VENTNEUF_CONTROL_PLANE_URL;
  if (!value) throw new Error("VENTNEUF_CONTROL_PLANE_URL is required.");
  return value;
}

if (command === "install") {
  const paths = await installLaunchAgent({
    nodePath: process.execPath,
    runnerSourceDirectory: dirname(fileURLToPath(import.meta.url)),
    controlPlaneUrl: controlPlaneUrl(),
    webOrigins: process.env.VENTNEUF_WEB_ORIGINS ?? defaultWebOrigins,
    repositoriesFile: process.env.VENTNEUF_REPOSITORIES_FILE,
    archiveRetentionDays: process.env.VENTNEUF_MISSION_ARCHIVE_RETENTION_DAYS,
    orcaPath: process.env.VENTNEUF_ORCA_PATH,
    codexPath: process.env.VENTNEUF_CODEX_PATH,
    claudePath: process.env.VENTNEUF_CLAUDE_PATH,
    version: await sourceVersion(),
  });
  console.info(`Installed ventneuf.os runner at ${paths.supportDirectory}`);
} else if (command === "uninstall") {
  await uninstallLaunchAgent();
  console.info("Uninstalled the ventneuf.os runner service. The device credential remains in Keychain.");
} else if (command === "status") {
  const status = await launchAgentStatus();
  console.info(status ?? "The ventneuf.os runner service is not installed.");
} else if (command === "serve") {
  const allowedOrigins = new Set(
    (process.env.VENTNEUF_WEB_ORIGINS ?? defaultWebOrigins)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
  );
  const port = Number.parseInt(process.env.VENTNEUF_RUNNER_PORT ?? "41929", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("VENTNEUF_RUNNER_PORT is invalid.");

  const client = new RunnerCloudClient(new URL(controlPlaneUrl()));
  const repositoriesFile = process.env.VENTNEUF_REPOSITORIES_FILE ?? defaultRepositoriesFile();
  const harnessesFile = executionHarnessesFile(repositoriesFile);
  const installedHarnesses = {
    codex: Boolean(process.env.VENTNEUF_ORCA_PATH && process.env.VENTNEUF_CODEX_PATH),
    claude: Boolean(process.env.VENTNEUF_ORCA_PATH && process.env.VENTNEUF_CLAUDE_PATH),
  };
  await initializeExecutionHarnesses(harnessesFile, repositoriesFile, installedHarnesses);
  await removeLegacyExecutionSettings(repositoriesFile);
  const store = new MacOSKeychainCredentialStore(userInfo().username);
  const bridge = new LocalRunnerBridge({
    client,
    store,
    deviceName: hostname(),
    allowedOrigins,
    repositoriesFile,
    harnessesFile,
    selectFolder,
    installedHarnesses,
    updater: new RunnerUpdater(dirname(fileURLToPath(import.meta.url))),
  });
  await bridge.start(port);
  const archiveRetentionDays = Number(process.env.VENTNEUF_MISSION_ARCHIVE_RETENTION_DAYS ?? "30");
  if (!Number.isInteger(archiveRetentionDays) || archiveRetentionDays < 1 || archiveRetentionDays > 365) {
    throw new Error("VENTNEUF_MISSION_ARCHIVE_RETENTION_DAYS must be between 1 and 365.");
  }
  const archiveRetentionMs = archiveRetentionDays * 24 * 60 * 60_000;
  const review = process.env.VENTNEUF_ORCA_PATH && process.env.VENTNEUF_CODEX_PATH
    ? new OrcaReviewAdapter({ orcaPath: process.env.VENTNEUF_ORCA_PATH, codexPath: process.env.VENTNEUF_CODEX_PATH }) : undefined;
  const development = process.env.VENTNEUF_ORCA_PATH && process.env.VENTNEUF_CODEX_PATH
    ? new CodexDevelopmentAdapter({ archiveRetentionMs, orcaPath: process.env.VENTNEUF_ORCA_PATH, codexPath: process.env.VENTNEUF_CODEX_PATH }) : undefined;
  const claudeDevelopment = process.env.VENTNEUF_ORCA_PATH && process.env.VENTNEUF_CLAUDE_PATH
    ? new ClaudeDevelopmentAdapter({ archiveRetentionMs, orcaPath: process.env.VENTNEUF_ORCA_PATH, claudePath: process.env.VENTNEUF_CLAUDE_PATH }) : undefined;
  new RunnerMissionWorker({ client, store, adapter: new RunnerAdapters(review, development, claudeDevelopment),
    repositories: async () => (await loadRepositories(repositoriesFile)).map((repository) => ({
      ...repository, orcaReview: Boolean(review && repository.orcaReview),
    })),
    harnesses: () => loadExecutionHarnesses(harnessesFile, installedHarnesses),
  }).start();
  console.info(`ventneuf.os runner listening on http://127.0.0.1:${port}`);
} else {
  throw new Error(`Unknown runner command: ${command}`);
}
