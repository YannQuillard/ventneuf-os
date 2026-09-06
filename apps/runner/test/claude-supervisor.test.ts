import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import type { DevelopmentJob } from "../src/development-supervisor.js";
import {
  claudeArguments,
  claudeMissionSettings,
  claudeProcessEnvironment,
  classifyClaudeTool,
  handleClaudeHook,
  renderClaudeStreamEvent,
  superviseClaudeDevelopment,
} from "../src/claude-supervisor.js";
import { writeReviewState } from "../src/review-supervisor.js";

const missionId = "00000000-0000-4000-8000-000000000101";

async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "claude-supervisor-")));
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
  const job: DevelopmentJob = {
    agent: "claude",
    agentPath: "/usr/bin/false",
    missionId,
    repositoryId: "sample",
    objective: "Fix the sample and open a pull request.",
    model: "opus",
    claudePath: "/usr/bin/false",
    gitPath: "/usr/bin/git",
    gitAuthorName: "Test Author",
    gitAuthorEmail: "test@ventneuf.invalid",
    worktree,
    gitDirectory,
    gitCommonDirectory,
    gitObjectsDirectory,
    gitBranchRef,
    gitBranchLog,
    remoteHost: "github.com",
    remoteRepository: "example/repository",
    authorityExpiresAt: Date.now() + 60_000,
  };
  return { directory, worktree, job };
}

function hook(job: DevelopmentJob, toolName: string, input: Record<string, unknown>, toolUseId = "tool-1") {
  return {
    session_id: job.missionId,
    cwd: job.worktree,
    hook_event_name: "PreToolUse",
    tool_name: toolName,
    tool_input: input,
    tool_use_id: toolUseId,
  };
}

test("confines Claude tools and exposes only bounded approval evidence", async () => {
  const state = await fixture();
  try {
    assert.equal(classifyClaudeTool(state.job, hook(state.job, "Read", {
      file_path: join(state.worktree, "README.md"),
    })).behavior, "allow");
    assert.equal(classifyClaudeTool(state.job, hook(state.job, "Read", {
      file_path: join(state.directory, "private.txt"),
    })).behavior, "deny");
    assert.equal(classifyClaudeTool(state.job, hook(state.job, "WebSearch", { query: "Node.js documentation" })).behavior,
      "passthrough");
    assert.equal(classifyClaudeTool(state.job, hook(state.job, "AskUserQuestion", {})).behavior, "passthrough");
    assert.equal(classifyClaudeTool(state.job, hook(state.job, "Bash", { command: "npm test" })).behavior,
      "passthrough");
    assert.equal(classifyClaudeTool(state.job, hook(state.job, "Bash", {
      command: "python3 -m pytest && npm test",
    })).behavior, "passthrough");
    assert.equal(classifyClaudeTool(state.job, hook(state.job, "Bash", {
      command: "npm test",
      cwd: state.directory,
    })).behavior, "deny");

    const deployment = classifyClaudeTool(state.job, hook(state.job, "Bash", { command: "terraform apply" }));
    assert.equal(deployment.behavior, "defer");
    if (deployment.behavior === "defer") {
      assert.equal(deployment.candidate.request.action.category, "deployment.apply");
    }

    const push = classifyClaudeTool(state.job, hook(state.job, "Bash", { command: "git push origin HEAD" }));
    assert.equal(push.behavior, "defer");
    if (push.behavior !== "defer") return;
    assert.equal(push.candidate.request.action.category, "network.access");
    assert.equal(push.candidate.request.action.target, "github.com");
    assert.match(push.candidate.request.action.argumentsDigest, /^[a-f0-9]{64}$/);

    assert.equal(classifyClaudeTool(state.job, hook(state.job, "Bash", {
      command: "npm install",
    }, "tool-2")).behavior, "passthrough");

    const sensitive = classifyClaudeTool(state.job, hook(state.job, "Bash", {
      command: "npm install --token=private-token",
      description: "Use private-token",
      dangerouslyDisableSandbox: true,
    }, "tool-3"));
    assert.equal(sensitive.behavior, "defer");
    if (sensitive.behavior !== "defer") return;
    assert.equal(JSON.stringify(sensitive.candidate.request).includes("private-token"), false);

    const elevated = classifyClaudeTool(state.job, hook(state.job, "Bash", {
      command: "python3 scripts/release.py",
      dangerouslyDisableSandbox: true,
    }, "tool-4"));
    assert.equal(elevated.behavior, "defer");
    if (elevated.behavior === "defer") {
      assert.equal(elevated.candidate.request.action.category, "development.command");
    }
  } finally {
    await rm(state.directory, { recursive: true, force: true });
  }
});

test("binds an approval decision to one exact deferred Claude tool", async () => {
  const state = await fixture();
  try {
    await writeReviewState(join(state.directory, "job.json"), state.job);
    const requestHook = hook(state.job, "Bash", { command: "git push origin HEAD" });
    const deferred = await handleClaudeHook(state.directory, requestHook);
    assert.equal(deferred.hookSpecificOutput.permissionDecision, "defer");
    const candidate = JSON.parse(await readFile(join(state.directory, "deferred-tool.json"), "utf8")) as {
      request: { requestId: string };
    };
    await writeReviewState(join(state.directory, "approval-decision.json"), {
      approvalId: "approval-1",
      requestId: candidate.request.requestId,
      status: "approved",
    });
    await writeReviewState(join(state.directory, "approved-operation.json"), {
      requestId: candidate.request.requestId,
      status: "succeeded",
      message: "Hermes completed the approved Git push.",
    });
    const unrelated = await handleClaudeHook(state.directory, { ...requestHook, tool_use_id: "tool-foreign" });
    assert.equal(unrelated.hookSpecificOutput.permissionDecision, "deny");
    const delivered = await handleClaudeHook(state.directory, requestHook);
    assert.equal(delivered.hookSpecificOutput.permissionDecision, "deny");
    assert.equal(delivered.continue, false);
    assert.equal(JSON.parse(await readFile(join(state.directory, "approval-consumed.json"), "utf8")).approvalId,
      "approval-1");

    await writeReviewState(join(state.directory, "approved-operation.json"), {
      requestId: candidate.request.requestId,
      status: "delegated",
      message: "Hermes approved this exact sandboxed network operation.",
    });
    const allowed = await handleClaudeHook(state.directory, requestHook);
    assert.equal(allowed.hookSpecificOutput.permissionDecision, "allow");
    const stopped = await handleClaudeHook(state.directory, {
      ...requestHook,
      hook_event_name: "PostToolUse",
    });
    assert.equal(stopped.continue, false);
    assert.equal(JSON.parse(await readFile(join(state.directory, "approved-tool-completed.json"), "utf8")).succeeded,
      true);
  } finally {
    await rm(state.directory, { recursive: true, force: true });
  }
});

test("uses Claude native autonomy with mission-scoped authority boundaries", async () => {
  const state = await fixture();
  try {
    const settings = claudeMissionSettings(state.job, state.directory);
    assert.equal(settings.permissions.disableBypassPermissionsMode, "disable");
    assert.equal(settings.sandbox.enabled, true);
    assert.equal(settings.sandbox.failIfUnavailable, true);
    assert.equal(settings.sandbox.autoAllowBashIfSandboxed, true);
    assert.equal(settings.sandbox.allowUnsandboxedCommands, true);
    assert.equal("network" in settings.sandbox, false);
    assert.equal("denyRead" in settings.sandbox.filesystem, false);
    assert.equal("allowRead" in settings.sandbox.filesystem, false);
    assert.equal("denyWrite" in settings.sandbox.filesystem, false);
    for (const path of [state.job.gitDirectory, state.job.gitObjectsDirectory, state.job.gitBranchRef,
      `${state.job.gitBranchRef}.lock`, state.job.gitBranchLog, `${state.job.gitBranchLog}.lock`]) {
      assert.ok(settings.sandbox.filesystem.allowWrite.includes(path));
    }
    assert.ok(settings.sandbox.credentials.envVars.every(({ mode }) => mode === "deny"));
    const environment = claudeProcessEnvironment(state.job);
    assert.equal(environment.PATH.split(":")[0], dirname(state.job.agentPath!));
    assert.ok(environment.PATH.split(":").includes(dirname(process.execPath)));
    for (const name of ["TMPDIR", "CLAUDE_CODE_TMPDIR", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "NPM_CONFIG_CACHE",
      "NPM_CONFIG_USERCONFIG", "CLAUDE_CODE_SUBPROCESS_ENV_SCRUB"]) assert.equal(name in environment, false);
    assert.equal(environment.GIT_CONFIG_NOSYSTEM, "1");
    for (const name of ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "GH_TOKEN", "GITHUB_TOKEN", "NPM_TOKEN",
      "ANTHROPIC_API_KEY"]) assert.equal(name in environment, false);
    const args = claudeArguments(state.job, { directory: state.directory, resume: false });
    assert.ok(!args.includes("--restricted"));
    assert.equal(args[args.indexOf("--model") + 1], "opus");
    assert.ok(args.includes("auto"));
    assert.ok(args.includes("none"));
    assert.ok(args.includes("--forward-subagent-text"));
    assert.ok(args.includes("--include-hook-events"));
    assert.ok(args.includes("--strict-mcp-config"));
    assert.ok(!args.includes("--tools"));
    assert.throws(() => claudeArguments({ ...state.job, model: undefined }, {
      directory: state.directory,
      resume: false,
    }), /no authorized model/);
  } finally {
    await rm(state.directory, { recursive: true, force: true });
  }
});

test("renders Claude messages, tools, results, and subagent output in the terminal", () => {
  assert.equal(renderClaudeStreamEvent({
    type: "assistant",
    message: { content: [
      { type: "text", text: "Inspecting the repository." },
      { type: "tool_use", name: "Bash", input: { command: "python3 -m pytest && npm test" } },
    ] },
  }), "Inspecting the repository.\n[Bash] python3 -m pytest && npm test\n");
  assert.equal(renderClaudeStreamEvent({
    type: "user",
    parent_tool_use_id: "agent-1",
    message: { content: [{ type: "tool_result", content: "All checks passed." }] },
  }), "[Subagent] [result] All checks passed.\n");
  assert.equal(renderClaudeStreamEvent({
    type: "assistant",
    message: { content: [{ type: "thinking", thinking: "private reasoning" }] },
  }), "");
});

async function waitForJson<T>(path: string): Promise<T> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try { return JSON.parse(await readFile(path, "utf8")) as T; }
    catch { await new Promise((resolveDelay) => setTimeout(resolveDelay, 20)); }
  }
  throw new Error(`Timed out waiting for ${path}.`);
}

test("supervises a deferred push without exposing credentials to Claude", { timeout: 15_000 }, async () => {
  const state = await fixture();
  try {
    const fakeClaude = join(state.directory, "fake-claude");
    const fakeGit = join(state.directory, "fake-git");
    await writeFile(fakeGit, `#!${process.execPath}\n`
      + "const fs = require('node:fs'); const args = process.argv.slice(2);\n"
      + "if (args.includes('get-url')) { console.log('git@github.com:example/repository.git'); process.exit(0); }\n"
      + "if (args.includes('push')) { const root = args[args.indexOf('-C') + 1]; fs.writeFileSync(root + '/push-ran.json', JSON.stringify(args)); process.exit(0); }\n"
      + "process.exit(1);\n", { mode: 0o700 });
    await writeFile(fakeClaude, `#!${process.execPath}\n`
      + "const fs = require('node:fs'); const path = require('node:path'); const args = process.argv.slice(2);\n"
      + "if (!process.env.HOME || !process.env.USER || process.env.LOGNAME !== process.env.USER || !process.env.SHELL) process.exit(2);\n"
      + "if (args.includes('--version')) { console.log('2.1.261 (Claude Code)'); process.exit(0); }\n"
      + "if (args.includes('doctor')) { console.log('Claude Code doctor\\n\\nRunning: native (2.1.261)'); process.exit(0); }\n"
      + "if (args[0] === 'auth' && args[1] === 'status') { console.log(JSON.stringify({ loggedIn: true, authMethod: 'oauth' })); process.exit(0); }\n"
      + "const value = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; }; const session = value('--session-id') || value('--resume');\n"
      + "const statePath = path.join(process.cwd(), 'fake-state'); const state = fs.existsSync(statePath) ? fs.readFileSync(statePath, 'utf8') : '0';\n"
      + "if (state === '2') { console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'Opened https://github.com/example/repository/pull/7', session_id: session })); process.exit(0); }\n"
      + "const input = { session_id: session, cwd: process.cwd(), hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git push origin HEAD' }, tool_use_id: 'tool-push' };\n"
      + "fs.writeFileSync(statePath, state === '0' ? '1' : '2'); fs.writeFileSync(path.join(process.cwd(), 'hook-input-' + state + '.json'), JSON.stringify(input));\n"
      + "const output = path.join(process.cwd(), 'hook-output-' + state + '.json'); const wait = new Int32Array(new SharedArrayBuffer(4)); while (!fs.existsSync(output)) Atomics.wait(wait, 0, 0, 20);\n"
      + "if (state === '0') console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, stop_reason: 'tool_deferred', session_id: session, deferred_tool_use: { id: 'tool-push', name: 'Bash', input: input.tool_input } }));\n"
      + "else console.log(JSON.stringify({ type: 'result', subtype: 'error', is_error: true, stop_reason: 'hook_stopped', session_id: session }));\n",
    { mode: 0o700 });
    state.job.agentPath = fakeClaude;
    state.job.claudePath = fakeClaude;
    state.job.gitPath = fakeGit;
    await writeReviewState(join(state.directory, "job.json"), state.job);
    await writeReviewState(join(state.directory, "lease.json"), { mode: "running", expiresAt: Date.now() + 60_000 });
    const running = superviseClaudeDevelopment(state.directory);

    const first = await waitForJson<Record<string, unknown>>(join(state.worktree, "hook-input-0.json"));
    await writeReviewState(join(state.worktree, "hook-output-0.json"), await handleClaudeHook(state.directory, first));
    const approval = await waitForJson<{ requestId: string; action: { category: string } }>(
      join(state.directory, "approval-request.json"),
    );
    assert.equal(approval.action.category, "network.access");
    await writeReviewState(join(state.directory, "approval-decision.json"), {
      approvalId: "approval-push",
      requestId: approval.requestId,
      status: "approved",
    });
    const second = await waitForJson<Record<string, unknown>>(join(state.worktree, "hook-input-1.json"));
    await writeReviewState(join(state.worktree, "hook-output-1.json"), await handleClaudeHook(state.directory, second));
    await running;

    assert.equal(JSON.parse(await readFile(join(state.directory, "status.json"), "utf8")).status, "completed");
    assert.match(await readFile(join(state.directory, "result.txt"), "utf8"), /pull\/7/);
    const pushArguments = JSON.parse(await readFile(join(state.worktree, "push-ran.json"), "utf8")) as string[];
    assert.deepEqual(pushArguments.slice(-4), ["push", "--receive-pack=git-receive-pack", "origin", "HEAD"]);
    assert.equal(JSON.stringify(claudeArguments(state.job, { directory: state.directory, resume: true })).includes(".ssh"), false);
  } finally {
    await rm(state.directory, { recursive: true, force: true });
  }
});
