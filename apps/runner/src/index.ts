#!/usr/bin/env node
import { hostname, userInfo } from "node:os";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { RunnerCloudClient } from "./cloud-client.js";
import { MacOSKeychainCredentialStore } from "./credential-store.js";
import { installLaunchAgent, launchAgentStatus, uninstallLaunchAgent } from "./launch-agent.js";
import { RunnerMissionWorker } from "./mission-worker.js";
import { defaultRepositoriesFile, loadRepositories } from "./repositories.js";
import { OrcaReviewAdapter, RunnerAdapters } from "./orca-review.js";
import { LocalRunnerBridge } from "./local-bridge.js";

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
    orcaPath: process.env.VENTNEUF_ORCA_PATH,
    codexPath: process.env.VENTNEUF_CODEX_PATH,
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
  const store = new MacOSKeychainCredentialStore(userInfo().username);
  const bridge = new LocalRunnerBridge({
    client,
    store,
    deviceName: hostname(),
    allowedOrigins,
  });
  await bridge.start(port);
  const review = process.env.VENTNEUF_ORCA_PATH && process.env.VENTNEUF_CODEX_PATH
    ? new OrcaReviewAdapter({ orcaPath: process.env.VENTNEUF_ORCA_PATH, codexPath: process.env.VENTNEUF_CODEX_PATH }) : undefined;
  new RunnerMissionWorker({ client, store, adapter: new RunnerAdapters(review),
    repositories: async () => (await loadRepositories(process.env.VENTNEUF_REPOSITORIES_FILE ?? defaultRepositoriesFile()))
      .map((repository) => ({ ...repository, orcaReview: Boolean(review && repository.orcaReview) })),
  }).start();
  console.info(`ventneuf.os runner listening on http://127.0.0.1:${port}`);
} else {
  throw new Error(`Unknown runner command: ${command}`);
}
