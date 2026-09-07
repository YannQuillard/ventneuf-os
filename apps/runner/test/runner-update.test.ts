import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { RunnerUpdater } from "../src/runner-update.js";

const execute = promisify(execFile);

test("downloads, verifies, atomically installs, and confirms a runner release", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "runner-update-test-"));
  const installation = join(temporary, "runner");
  const releaseSource = join(temporary, "release");
  const archive = join(temporary, "runner.tar.gz");
  const currentVersion = "1".repeat(40);
  const latestVersion = "2".repeat(40);
  const staleVersion = "f".repeat(40);
  await mkdir(installation);
  await mkdir(releaseSource);
  await writeFile(join(installation, "index.js"), "old runner\n");
  await writeFile(join(installation, "release.json"), JSON.stringify({ version: currentVersion }));
  await writeFile(join(releaseSource, "index.js"), "new runner\n");
  await writeFile(join(releaseSource, "release.json"), JSON.stringify({ version: latestVersion }));
  await execute("/usr/bin/tar", ["-czf", archive, "-C", releaseSource, "."]);
  const archiveBody = await readFile(archive);
  const checksum = createHash("sha256").update(archiveBody).digest("hex");
  let servedChecksum = "0".repeat(64);
  const server = createServer((request, response) => {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    if (request.url === "/latest") response.end(JSON.stringify([
      { tag_name: `runner-${staleVersion}`, published_at: "2026-01-01T00:00:00Z", assets: [] },
      { tag_name: `runner-${latestVersion}`, published_at: "2026-01-02T00:00:00Z", assets: [
        { name: "ventneuf-runner-darwin.tar.gz", browser_download_url: `${base}/archive` },
        { name: "ventneuf-runner-darwin.tar.gz.sha256", browser_download_url: `${base}/checksum` },
      ] },
    ]));
    else if (request.url === "/archive") response.end(archiveBody);
    else if (request.url === "/checksum") response.end(`${servedChecksum}  ventneuf-runner-darwin.tar.gz\n`);
    else response.writeHead(404).end();
  });
  await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", (error?: Error) => error ? reject(error) : resolve()));
  let restarted = false;
  try {
    const releasesUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/latest`;
    const rejected = new RunnerUpdater(installation, { releasesUrl, restart: () => { restarted = true; } });
    await assert.rejects(rejected.install(), /checksum is invalid/);
    assert.equal(await readFile(join(installation, "index.js"), "utf8"), "old runner\n");
    assert.equal(restarted, false);
    servedChecksum = checksum;
    const updater = new RunnerUpdater(installation, {
      releasesUrl,
      restart: () => { restarted = true; },
    });
    assert.deepEqual(await updater.status(), { currentVersion, latestVersion, available: true });
    assert.equal(await updater.install(), latestVersion);
    assert.equal(await readFile(join(installation, "index.js"), "utf8"), "new runner\n");
    assert.equal(restarted, true);
    assert.equal(await readFile(`${installation}.previous/index.js`, "utf8"), "old runner\n");
    await updater.confirmHealthy();
    await assert.rejects(readFile(`${installation}.previous/index.js`, "utf8"), { code: "ENOENT" });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(temporary, { recursive: true, force: true });
  }
});
