import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MissionPreparationError, OrcaRequestError, prepareOrcaRepository, requestOrca } from "../src/orca-runtime.js";

test("cold runtime and unregistered repository are prepared without manual setup", async () => {
  const calls: string[][] = [];
  const request = async (args: string[]) => {
    calls.push(args);
    if (args[0] === "open") return {};
    if (args[1] === "show") throw new OrcaRequestError("repo_not_found");
    return { repo: { id: "configured", path: "/configured/repo" } };
  };
  assert.deepEqual(await prepareOrcaRepository(request, "/configured/repo", new AbortController().signal, async () => {}),
    { id: "configured", path: "/configured/repo" });
  assert.deepEqual(calls, [["repo", "show", "--repo", "path:/configured/repo"],
    ["repo", "add", "--path", "/configured/repo"]]);
});

test("existing registration is reused and unrelated errors never import a repository", async () => {
  for (const code of [undefined, "unauthorized", "runtime_unavailable"]) {
    const calls: string[][] = [];
    const request = async (args: string[]) => {
      calls.push(args);
      if (args[0] === "open") return {};
      if (code) throw new OrcaRequestError(code);
      return { repo: { id: "existing", path: "/configured/repo" } };
    };
    const prepared = prepareOrcaRepository(request, "/configured/repo", new AbortController().signal, async () => {});
    if (code) await assert.rejects(prepared, MissionPreparationError);
    else assert.equal((await prepared).id, "existing");
    assert.equal(calls.length, 1);
  }
});

test("cancellation during startup prevents repository registration", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(prepareOrcaRepository(async () => {
    calls++;
    return {};
  }, "/configured/repo", controller.signal, async () => { controller.abort(); }), { name: "AbortError" });
  assert.equal(calls, 0);
});

test("startup failure and wrong repository identity are safe preparation errors", async () => {
  await assert.rejects(prepareOrcaRepository(async () => ({}),
    "/configured/repo", new AbortController().signal, async () => { throw new Error("private diagnostic"); }), (error: unknown) =>
    error instanceof MissionPreparationError && error.message.includes("start its local Orca")
      && !error.message.includes("private diagnostic"));
  await assert.rejects(prepareOrcaRepository(async () => ({ repo: { id: "wrong", path: "/other" } }),
    "/configured/repo", new AbortController().signal, async () => {}), MissionPreparationError);
});

test("nonzero CLI exit retains the structured Orca error code", async () => {
  const directory = await mkdtemp(join(tmpdir(), "orca-error-"));
  try {
    const script = join(directory, "error.cjs");
    await writeFile(script, 'process.stdout.write(JSON.stringify({ok:false,error:{code:"repo_not_found"}}));process.exitCode=1;');
    await assert.rejects(requestOrca(process.execPath, [script]), (error: unknown) =>
      error instanceof OrcaRequestError && error.code === "repo_not_found");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("concurrent cold starts share one headless server and reuse it on reconnect", async () => {
  const { ensureOrcaRuntime } = await import("../src/orca-runtime.js");
  const { readFile } = await import("node:fs/promises");
  const directory = await mkdtemp(join(tmpdir(), "orca-startup-"));
  const executable = join(directory, "orca");
  const state = join(directory, "server.json");
  try {
    await writeFile(executable, `#!${process.execPath}
const fs = require('node:fs');
const state = ${JSON.stringify(state)};
const args = process.argv.slice(2);
if (args[0] === 'status') {
  const running = fs.existsSync(state);
  process.stdout.write(JSON.stringify({ok:true,result:{app:{running},runtime:{reachable:running},graph:{state:running?'ready':'not_running'}}}));
} else if (args[0] === 'serve') {
  fs.writeFileSync(state, JSON.stringify({pid:process.pid,args}), {flag:'wx'});
  setInterval(() => {}, 1000);
} else { process.exitCode = 1; }
`, { mode: 0o700 });
    await Promise.all([ensureOrcaRuntime(executable, new AbortController().signal),
      ensureOrcaRuntime(executable, new AbortController().signal)]);
    const first = JSON.parse(await readFile(state, "utf8")) as { pid: number; args: string[] };
    assert.deepEqual(first.args, ["serve", "--no-pairing", "--json"]);
    await ensureOrcaRuntime(executable, new AbortController().signal);
    assert.equal(JSON.parse(await readFile(state, "utf8")).pid, first.pid);
  } finally {
    try { process.kill(JSON.parse(await readFile(state, "utf8")).pid, "SIGTERM"); } catch {}
    await rm(directory, { recursive: true, force: true });
  }
});
