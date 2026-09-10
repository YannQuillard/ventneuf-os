import { execFile, spawn } from "node:child_process";
import { homedir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const execute = promisify(execFile);
const environment = () => ({ HOME: homedir(), PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8" });
const starting = new Map<string, Promise<void>>();

type RuntimeStatus = { app?: { running?: boolean; pid?: number; desktopWindowStatus?: string }; runtime?: { reachable?: boolean }; graph?: { state?: string } };

export async function ensureOrcaRuntime(path: string, signal: AbortSignal) {
  signal.throwIfAborted();
  let pending = starting.get(path);
  if (!pending) {
    pending = startOrcaRuntime(path).finally(() => { starting.delete(path); });
    starting.set(path, pending);
  }
  // Startup is shared across adapters; one cancelled mission must not stop another mission's runtime.
  await new Promise<void>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    pending!.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
  });
}

async function startOrcaRuntime(path: string) {
  const deadline = Date.now() + 60_000;
  let ownedPid: number | undefined;
  let startupError: Error | undefined;
  do {
    const status = await requestOrca(path, ["status"], 5_000) as RuntimeStatus;
    if (status.runtime?.reachable && status.graph?.state === "ready") {
      if (status.app?.desktopWindowStatus === "blocked") throw new Error("Orca persistent terminal runtime is unavailable.");
      return;
    }
    if (!status.app?.running && !ownedPid) {
      const child = spawn(path, ["serve", "--no-pairing", "--json"], {
        detached: true, stdio: "ignore", env: environment(),
      });
      child.on("error", (error) => { startupError = error; });
      child.on("exit", (code) => { startupError = new Error(`Orca server exited (${code}).`); });
      ownedPid = child.pid;
      child.unref();
    }
    if (startupError) throw startupError;
    await delay(250);
  } while (Date.now() < deadline);
  throw new Error("Orca runtime readiness timed out.");
}


export class OrcaRequestError extends Error {
  constructor(readonly code: string) {
    super(`Orca request failed (${code}).`);
  }
}

export class MissionPreparationError extends Error {}

export async function requestOrca(path: string, args: string[], timeout = 20_000, signal?: AbortSignal) {
  let stdout: string;
  try {
    ({ stdout } = await execute(path, [...args, "--json"], {
      timeout, signal, maxBuffer: 256_000,
      env: environment(),
    }));
  } catch (error) {
    signal?.throwIfAborted();
    // Orca returns structured failures on stdout with a nonzero process exit code.
    const output = (error as { stdout?: unknown }).stdout;
    if (typeof output !== "string" || !output.trim()) throw error;
    stdout = output;
  }
  const envelope = JSON.parse(stdout) as {
    ok?: boolean; result?: Record<string, unknown>; error?: { code?: string };
  };
  if (!envelope.ok || !envelope.result) {
    throw new OrcaRequestError(envelope.error?.code ?? "invalid_response");
  }
  return envelope.result;
}

type Request = (args: string[], timeout?: number, signal?: AbortSignal) => Promise<Record<string, unknown>>;

export async function prepareOrcaRepository(request: Request, path: string, signal: AbortSignal, ready: () => Promise<void>) {
  signal.throwIfAborted();
  try {
    await ready();
  } catch {
    signal.throwIfAborted();
    throw new MissionPreparationError("The runner could not start its local Orca runtime automatically. Check Orca installation and availability on the runner device, then retry the mission.");
  }
  signal.throwIfAborted();
  let result: Record<string, unknown>;
  try {
    try {
      result = await request(["repo", "show", "--repo", `path:${path}`], undefined, signal);
    } catch (error) {
      if (!(error instanceof OrcaRequestError) || error.code !== "repo_not_found") throw error;
      signal.throwIfAborted();
      // Only import the repository already authorized by the runner's mission scope.
      result = await request(["repo", "add", "--path", path], 60_000, signal);
    }
    signal.throwIfAborted();
    const repo = result.repo as { id?: string; path?: string } | undefined;
    if (!repo?.id || repo.path !== path) throw new Error("Unexpected Orca repository response.");
    return { id: repo.id, path: repo.path };
  } catch {
    signal.throwIfAborted();
    throw new MissionPreparationError("The runner could not prepare the configured repository in Orca. Check that the repository exists and is accessible on the runner device, then retry the mission.");
  }
}
