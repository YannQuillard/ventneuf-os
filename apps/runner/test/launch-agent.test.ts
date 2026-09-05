import assert from "node:assert/strict";
import test from "node:test";
import { launchAgentPaths, renderLaunchAgentPlist } from "../src/launch-agent.js";

test("renders a persistent launch agent without embedding credentials", () => {
  const plist = renderLaunchAgentPlist({
    nodePath: "/opt/node & tools/node",
    runnerSourceDirectory: "/tmp/runner",
    controlPlaneUrl: "https://control.example.com?a=1&b=2",
    webOrigins: "https://os.example.com,http://localhost:3000",
    orcaPath: "/Applications/Orca.app/Contents/MacOS/orca",
    codexPath: "/usr/local/bin/codex",
    claudePath: "/Users/test/.local/bin/claude",
    homeDirectory: "/Users/test",
  });

  assert.match(plist, /com\.ventneuf\.os\.runner/);
  assert.match(plist, /RunAtLoad/);
  assert.match(plist, /KeepAlive/);
  assert.match(plist, /\/Users\/test\/Library\/Application Support\/ventneuf\.os\/runner\/index\.js/);
  assert.match(plist, /https:\/\/control\.example\.com\?a=1&amp;b=2/);
  assert.match(plist, /VENTNEUF_CODEX_PATH/);
  assert.match(plist, /VENTNEUF_CLAUDE_PATH/);
  assert.match(plist, /\/Users\/test\/\.local\/bin\/claude/);
  assert.doesNotMatch(plist, /credential|token/i);
});

test("derives runner installation paths without a personal hard-coded path", () => {
  assert.deepEqual(launchAgentPaths("/Users/someone"), {
    supportDirectory: "/Users/someone/Library/Application Support/ventneuf.os/runner",
    executable: "/Users/someone/Library/Application Support/ventneuf.os/runner/index.js",
    stdoutLog: "/Users/someone/Library/Application Support/ventneuf.os/runner/runner.log",
    stderrLog: "/Users/someone/Library/Application Support/ventneuf.os/runner/runner.error.log",
    plist: "/Users/someone/Library/LaunchAgents/com.ventneuf.os.runner.plist",
  });
});
