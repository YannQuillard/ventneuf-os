import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { superviseReview, writeReviewState } from "../src/review-supervisor.js";

test("independent supervisor kills its owned process when confirmed lease updates stop", { timeout: 8_000 }, async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "review-watchdog-")));
  try {
    const snapshot = join(directory, "snapshot");
    const executable = join(directory, "fake-codex");
    const started = join(directory, "started.json");
    await mkdir(snapshot);
    await writeFile(executable, `#!${process.execPath}\n`
      + "if (process.argv[2] === 'sandbox') { console.log('isolated'); process.exit(0); }\n"
      + "let prompt = ''; process.stdin.on('data', (chunk) => { prompt += chunk; });\n"
      + `process.stdin.on('end', () => require("node:fs").writeFileSync(${JSON.stringify(started)}, JSON.stringify({ pid: process.pid, environment: Object.keys(process.env), prompt })));\n`
      + "process.on('SIGTERM', () => {}); setInterval(() => {}, 100);\n", { mode: 0o700 });
    await writeReviewState(join(directory, "job.json"), {
      codexPath: executable,
      snapshot,
      deadline: Date.now() + 30_000,
      objective: "Review the arithmetic behavior",
    });
    await writeReviewState(join(directory, "lease.json"), { expiresAt: Date.now() + 1_000 });
    await superviseReview(directory);
    const status = JSON.parse(await readFile(join(directory, "status.json"), "utf8"));
    const child = JSON.parse(await readFile(started, "utf8")) as { pid: number; environment: string[]; prompt: string };
    assert.equal(status.status, "failed");
    assert.throws(() => process.kill(child.pid, 0), { code: "ESRCH" });
    assert.match(child.prompt, /Mission objective:\nReview the arithmetic behavior/);
    // macOS may inject its Core Foundation text encoding into spawned processes.
    assert.deepEqual(child.environment.filter((name) => name !== "__CF_USER_TEXT_ENCODING").sort(), ["HOME", "LANG", "PATH"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
