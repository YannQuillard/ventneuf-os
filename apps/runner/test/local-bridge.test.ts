import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import type { StoredDevice } from "../src/credential-store.js";
import { LocalRunnerBridge } from "../src/local-bridge.js";

const origin = "http://localhost:3000";
const execute = promisify(execFile);

test("enrolls through the loopback bridge without returning the credential", async () => {
  let saved: StoredDevice | undefined;
  let heartbeatCount = 0;
  const device: StoredDevice = {
    deviceId: "device-1",
    name: "Test Mac",
    platform: "darwin",
    credential: "secret-credential",
  };
  const bridge = new LocalRunnerBridge({
    client: {
      enroll: async (token, name) => {
        assert.equal(token, "one-time-token");
        assert.equal(name, "Test Mac");
        return device;
      },
      heartbeat: async () => { heartbeatCount += 1; },
    },
    store: {
      load: async () => undefined,
      save: async (value) => { saved = value; },
    },
    deviceName: "Test Mac",
    allowedOrigins: new Set([origin]),
    heartbeatIntervalMs: 60_000,
  });
  const { server, port } = await bridge.start(0);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/enroll`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ token: "one-time-token" }),
    });
    assert.equal(response.status, 201);
    const body = await response.text();
    assert.doesNotMatch(body, /secret-credential/);
    assert.match(body, /device-1/);
    assert.deepEqual(saved, device);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(heartbeatCount, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("rejects enrollment from an untrusted web origin", async () => {
  const bridge = new LocalRunnerBridge({
    client: {
      enroll: async () => { throw new Error("must not run"); },
      heartbeat: async () => undefined,
    },
    store: { load: async () => undefined, save: async () => undefined },
    deviceName: "Test Mac",
    allowedOrigins: new Set([origin]),
  });
  const { server, port } = await bridge.start(0);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/enroll`, {
      method: "POST",
      headers: { origin: "https://malicious.example", "content-type": "application/json" },
      body: JSON.stringify({ token: "one-time-token" }),
    });
    assert.equal(response.status, 403);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("finds a GitHub checkout locally without returning its path", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "runner-bridge-registration-"));
  const repositoryPath = join(temporary, "private-repository");
  const repositoriesFile = join(temporary, "config", "repositories.json");
  await mkdir(repositoryPath);
  await execute("/usr/bin/git", ["init", repositoryPath]);
  await execute("/usr/bin/git", ["-C", repositoryPath, "remote", "add", "origin", "git@github.com:OnlineNow/private-repository.git"]);
  const device: StoredDevice = {
    deviceId: "device-1",
    name: "Test Mac",
    platform: "darwin",
    credential: "secret-credential",
  };
  const bridge = new LocalRunnerBridge({
    client: { enroll: async () => device, heartbeat: async () => undefined },
    store: { load: async () => device, save: async () => undefined },
    deviceName: "Test Mac",
    allowedOrigins: new Set([origin]),
    repositoriesFile,
    selectFolder: async () => temporary,
    harnesses: { codex: true, claude: true },
  });
  const { server, port } = await bridge.start(0);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/repositories`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ githubUrl: "https://github.com/onlinenow/private-repository",
        githubRepositoryId: "123456789", searchRoot: temporary }),
    });
    assert.equal(response.status, 201);
    const body = await response.text();
    assert.match(body, /github-[a-f0-9]{32}/);
    assert.match(body, /onlinenow/);
    assert.doesNotMatch(body, new RegExp(repositoryPath));
    assert.doesNotMatch(body, new RegExp(temporary));
    const configuration = JSON.parse(await readFile(repositoriesFile, "utf8")) as Array<Record<string, unknown>>;
    assert.equal(configuration[0]?.path, await realpath(repositoryPath));
    assert.deepEqual(configuration[0]?.github, { id: "123456789", owner: "onlinenow", name: "private-repository" });

    const settings = await fetch(`http://127.0.0.1:${port}/repository-settings`, { headers: { origin } });
    assert.equal(settings.status, 200);
    assert.deepEqual(await settings.json(), {
      searchFolders: [{ path: await realpath(temporary), available: true }],
      repositories: [{
        id: configuration[0]?.id,
        name: "onlinenow/private-repository",
        path: await realpath(repositoryPath),
        available: true,
        github: { id: "123456789", owner: "onlinenow", name: "private-repository" },
      }],
    });

    const capabilities = await fetch(`http://127.0.0.1:${port}/repositories/capabilities`, {
      method: "PATCH", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({
        id: configuration[0]?.id, codexDevelopment: true, codexModels: ["gpt-5.3-codex"],
        claudeDevelopment: true, claudeModels: ["opus", "sonnet"],
      }),
    });
    assert.equal(capabilities.status, 200);
    const configured = JSON.parse(await readFile(repositoriesFile, "utf8")) as Array<Record<string, unknown>>;
    assert.equal(configured[0]?.codexDevelopment, true);
    assert.deepEqual(configured[0]?.codexModels, ["gpt-5.3-codex"]);
    assert.equal(configured[0]?.claudeDevelopment, true);
    assert.deepEqual(configured[0]?.claudeModels, ["opus", "sonnet"]);
    const configuredSettings = await fetch(`http://127.0.0.1:${port}/repository-settings`, { headers: { origin } });
    const configuredBody = await configuredSettings.json() as { repositories: Array<Record<string, unknown>> };
    assert.equal(configuredBody.repositories[0]?.codexDevelopment, true);
    assert.equal(configuredBody.repositories[0]?.claudeDevelopment, true);

    const selected = await fetch(`http://127.0.0.1:${port}/folders/select`, { method: "POST", headers: { origin } });
    assert.deepEqual(await selected.json(), { path: temporary });

    const secondRoot = join(temporary, "other-root");
    await mkdir(secondRoot);
    const addedRoot = await fetch(`http://127.0.0.1:${port}/repository-search-folders`, {
      method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ path: secondRoot }),
    });
    assert.equal(addedRoot.status, 201);
    const replacementRoot = join(temporary, "replacement-root");
    await mkdir(replacementRoot);
    const replacedRoot = await fetch(`http://127.0.0.1:${port}/repository-search-folders`, {
      method: "PATCH", headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ currentPath: await realpath(secondRoot), path: replacementRoot }),
    });
    assert.equal(replacedRoot.status, 200);
    const removedRoot = await fetch(`http://127.0.0.1:${port}/repository-search-folders`, {
      method: "DELETE", headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ path: await realpath(replacementRoot) }),
    });
    assert.equal(removedRoot.status, 204);

    const relocatedPath = join(temporary, "relocated-repository");
    await rename(repositoryPath, relocatedPath);
    const relocated = await fetch(`http://127.0.0.1:${port}/repositories`, {
      method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({
        githubUrl: "https://github.com/onlinenow/private-repository", githubRepositoryId: "123456789",
        repositoryPath: relocatedPath,
      }),
    });
    assert.equal(relocated.status, 201);
    const relocatedConfiguration = JSON.parse(await readFile(repositoriesFile, "utf8")) as Array<Record<string, unknown>>;
    assert.equal(relocatedConfiguration[0]?.path, await realpath(relocatedPath));

    const removedRepository = await fetch(`http://127.0.0.1:${port}/repositories`, {
      method: "DELETE", headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ id: configuration[0]?.id }),
    });
    assert.equal(removedRepository.status, 204);
    assert.deepEqual(JSON.parse(await readFile(repositoriesFile, "utf8")), []);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(temporary, { recursive: true, force: true });
  }
});

test("exposes runner updates only through the enrolled trusted-origin bridge", async () => {
  const device: StoredDevice = { deviceId: "device-1", name: "Test Mac", platform: "darwin", credential: "secret" };
  let installed = false;
  const bridge = new LocalRunnerBridge({
    client: { enroll: async () => device, heartbeat: async () => undefined },
    store: { load: async () => device, save: async () => undefined },
    deviceName: "Test Mac",
    allowedOrigins: new Set([origin]),
    updater: {
      status: async () => ({ currentVersion: "1".repeat(40), latestVersion: "2".repeat(40), available: true }),
      install: async () => { installed = true; return "2".repeat(40); },
      confirmHealthy: async () => undefined,
    },
  });
  const { server, port } = await bridge.start(0);
  try {
    const status = await fetch(`http://127.0.0.1:${port}/updates`, { headers: { origin } });
    assert.equal(status.status, 200);
    assert.equal((await status.json() as { available: boolean }).available, true);
    const install = await fetch(`http://127.0.0.1:${port}/updates/install`, { method: "POST", headers: { origin } });
    assert.equal(install.status, 202);
    assert.equal(installed, true);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
