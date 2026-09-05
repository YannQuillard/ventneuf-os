import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  classifyCodexApproval,
  codexAppServerArguments,
  superviseDevelopment,
  type DevelopmentJob,
} from "../src/development-supervisor.js";
import { writeReviewState } from "../src/review-supervisor.js";

const sessionId = "00000000-0000-4000-8000-000000000002";

test("classifies exact Codex operations and rejects paths outside the mission worktree", () => {
  const worktree = "/workspace/mission";
  const base = { threadId: "thread-1", itemId: "item-1", cwd: worktree, command: "npm test" };
  assert.equal(classifyCodexApproval("item/commandExecution/requestApproval", base, worktree, sessionId)?.action.category,
    "development.command");
  assert.equal(classifyCodexApproval("item/commandExecution/requestApproval", { ...base, command: "gh pr create --fill" }, worktree, sessionId)?.action.category,
    "pull_request.create");
  assert.equal(classifyCodexApproval("item/commandExecution/requestApproval", { ...base, command: "gh pr merge 42" }, worktree, sessionId)?.action.category,
    "pull_request.merge");
  assert.equal(classifyCodexApproval("item/commandExecution/requestApproval", { ...base, command: "gh --repo example/repository pr merge 42" }, worktree, sessionId)?.action.category,
    "pull_request.merge");
  assert.equal(classifyCodexApproval("item/commandExecution/requestApproval", { ...base, command: "terraform apply" }, worktree, sessionId)?.action.category,
    "deployment.apply");
  assert.equal(classifyCodexApproval("item/commandExecution/requestApproval", {
    ...base,
    command: "git push origin HEAD",
    networkApprovalContext: { host: "github.com", protocol: "https" },
  }, worktree, sessionId)?.action.category, "network.access");
  assert.equal(classifyCodexApproval("item/commandExecution/requestApproval", { ...base, cwd: "/workspace/other" }, worktree, sessionId), undefined);
  assert.equal(classifyCodexApproval("item/commandExecution/requestApproval", {
    ...base, command: "git push origin HEAD && gh pr merge 42",
  }, worktree, sessionId), undefined);
  assert.equal(classifyCodexApproval("item/commandExecution/requestApproval", {
    ...base,
    additionalPermissions: { fileSystem: { write: ["/workspace/other"] } },
  }, worktree, sessionId), undefined);
  assert.equal(classifyCodexApproval("item/fileChange/requestApproval", {
    threadId: "thread-1", itemId: "item-2", grantRoot: "/workspace/other",
  }, worktree, sessionId), undefined);
  const file = classifyCodexApproval("item/fileChange/requestApproval", {
    threadId: "thread-1", itemId: "item-2", grantRoot: "/workspace/mission/src",
  }, worktree, sessionId);
  assert.equal(file?.action.category, "repository.write");
  assert.equal(file?.resume.sessionId, sessionId);
  assert.match(file?.action.argumentsDigest ?? "", /^[a-f0-9]{64}$/);
  const sensitive = classifyCodexApproval("item/commandExecution/requestApproval", {
    ...base,
    command: "curl --token secret-value https://user:password@example.com",
    reason: "Use password secret-value",
    networkApprovalContext: { host: "example.com", protocol: "https" },
  }, worktree, sessionId);
  assert.equal(sensitive?.action.target, "example.com");
  assert.deepEqual(sensitive?.evidence, {
    method: "item/commandExecution/requestApproval",
    command: "curl network command",
    commandLength: 59,
    cwd: ".",
    destination: "example.com",
    protocol: "https",
  });
  assert.equal(JSON.stringify(sensitive).includes("secret-value"), false);
  assert.equal(JSON.stringify(sensitive).includes("password"), false);
});

test("runs a durable App Server turn through a structured approval", { timeout: 10_000 }, async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "development-supervisor-")));
  try {
    const worktree = join(directory, "worktree");
    const gitDirectory = join(directory, "git-worktree");
    const gitCommonDirectory = join(directory, "git-common");
    const gitObjectsDirectory = join(gitCommonDirectory, "objects");
    const gitBranchRef = join(gitCommonDirectory, "refs", "heads", "mission");
    const gitBranchLog = join(gitCommonDirectory, "logs", "refs", "heads", "mission");
    await Promise.all([
      mkdir(worktree),
      mkdir(gitDirectory),
      mkdir(gitObjectsDirectory, { recursive: true }),
      mkdir(join(gitCommonDirectory, "refs", "heads"), { recursive: true }),
      mkdir(join(gitCommonDirectory, "logs", "refs", "heads"), { recursive: true }),
    ]);
    await writeFile(gitBranchRef, "ref\n");
    const executable = join(directory, "fake-codex");
    await writeFile(executable, `#!${process.execPath}\n`
      + "if (process.argv[2] === 'sandbox') { const index = process.argv.lastIndexOf('probe'); require('node:fs').writeFileSync(process.argv[index + 1], 'changed\\n'); console.log('isolated'); process.exit(0); }\n"
      + "const readline = require('node:readline').createInterface({ input: process.stdin });\n"
      + "readline.on('line', (line) => { const message = JSON.parse(line);\n"
      + "if (message.method === 'initialize') console.log(JSON.stringify({ id: message.id, result: { userAgent: 'fake', codexHome: '/fake', platformFamily: 'unix', platformOs: 'macos' } }));\n"
      + "if (message.method === 'thread/start') console.log(JSON.stringify({ id: message.id, result: { thread: { id: 'thread-1', sessionId: '00000000-0000-4000-8000-000000000002' } } }));\n"
      + "if (message.method === 'turn/start') { console.log(JSON.stringify({ id: message.id, result: { turn: { id: 'turn-1' } } }));"
      + ` console.log(JSON.stringify({ method: 'item/commandExecution/requestApproval', id: 99, params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1', command: 'git push origin HEAD', cwd: ${JSON.stringify(worktree)}, networkApprovalContext: { host: 'github.com', protocol: 'https' } } })); }\n`
      + "if (message.id === 99 && message.result?.decision === 'accept') {"
      + " console.log(JSON.stringify({ method: 'item/completed', params: { threadId: 'thread-1', turnId: 'turn-1', item: { type: 'agentMessage', text: 'Opened https://github.com/example/repository/pull/1' } } }));"
      + " console.log(JSON.stringify({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } })); } });\n"
      + "setInterval(() => {}, 1000);\n", { mode: 0o700 });
    const job: DevelopmentJob = {
      missionId: "00000000-0000-4000-8000-000000000001",
      repositoryId: "sample",
      objective: "Fix the sample and open a pull request.",
      codexPath: executable,
      gitPath: "/usr/bin/git",
      gitAuthorName: "Test Author",
      gitAuthorEmail: "test@ventneuf.invalid",
      worktree,
      gitDirectory,
      gitCommonDirectory,
      gitObjectsDirectory,
      gitBranchRef,
      gitBranchLog,
      authorityExpiresAt: Date.now() + 60_000,
    };
    await writeReviewState(join(directory, "job.json"), job);
    await writeReviewState(join(directory, "lease.json"), { mode: "running", expiresAt: Date.now() + 60_000 });
    const running = superviseDevelopment(directory);
    let approval: { requestId: string; action: { category: string } } | undefined;
    for (let attempt = 0; attempt < 100 && !approval; attempt += 1) {
      try { approval = JSON.parse(await readFile(join(directory, "approval-request.json"), "utf8")); }
      catch { await new Promise((resolveDelay) => setTimeout(resolveDelay, 20)); }
    }
    assert.equal(approval?.action.category, "network.access");
    await writeReviewState(join(directory, "approval-decision.json"), {
      approvalId: "00000000-0000-4000-8000-000000000003",
      requestId: approval!.requestId,
      status: "approved",
    });
    await running;
    assert.equal(JSON.parse(await readFile(join(directory, "status.json"), "utf8")).status, "completed");
    assert.equal(JSON.parse(await readFile(join(directory, "approval-consumed.json"), "utf8")).approvalId,
      "00000000-0000-4000-8000-000000000003");
    assert.match(await readFile(join(directory, "result.txt"), "utf8"), /pull\/1/);
    const args = codexAppServerArguments(job);
    assert.ok(args.includes("--strict-config"));
    assert.ok(args.some((value) => value.includes("permissions.ventneuf-development.network.enabled=false")));
    assert.ok(!args.join(" ").includes("credential"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
