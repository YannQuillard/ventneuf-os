import { execFile } from "node:child_process";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const label = "com.ventneuf.os.runner";

export interface LaunchAgentConfiguration {
  nodePath: string;
  runnerSourceDirectory: string;
  controlPlaneUrl: string;
  webOrigins: string;
  homeDirectory?: string;
  userId?: number;
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function launchAgentPaths(homeDirectory = homedir()) {
  const supportDirectory = join(homeDirectory, "Library", "Application Support", "ventneuf.os", "runner");
  return {
    supportDirectory,
    executable: join(supportDirectory, "index.js"),
    stdoutLog: join(supportDirectory, "runner.log"),
    stderrLog: join(supportDirectory, "runner.error.log"),
    plist: join(homeDirectory, "Library", "LaunchAgents", `${label}.plist`),
  };
}

export function renderLaunchAgentPlist(configuration: LaunchAgentConfiguration) {
  const paths = launchAgentPaths(configuration.homeDirectory);
  const values = {
    nodePath: escapeXml(configuration.nodePath),
    executable: escapeXml(paths.executable),
    controlPlaneUrl: escapeXml(configuration.controlPlaneUrl),
    webOrigins: escapeXml(configuration.webOrigins),
    stdoutLog: escapeXml(paths.stdoutLog),
    stderrLog: escapeXml(paths.stderrLog),
  };
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${values.nodePath}</string>
    <string>${values.executable}</string>
    <string>serve</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>VENTNEUF_CONTROL_PLANE_URL</key>
    <string>${values.controlPlaneUrl}</string>
    <key>VENTNEUF_WEB_ORIGINS</key>
    <string>${values.webOrigins}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${values.stdoutLog}</string>
  <key>StandardErrorPath</key>
  <string>${values.stderrLog}</string>
</dict>
</plist>
`;
}

async function bootout(userId: number, plist: string) {
  try {
    await execute("/bin/launchctl", ["bootout", `gui/${userId}`, plist]);
  } catch {
    // An agent that has not been installed or loaded needs no cleanup.
  }
}

export async function installLaunchAgent(configuration: LaunchAgentConfiguration) {
  const userId = configuration.userId ?? process.getuid?.();
  if (userId === undefined) throw new Error("Unable to determine the current macOS user ID.");
  const paths = launchAgentPaths(configuration.homeDirectory);
  await bootout(userId, paths.plist);
  await rm(paths.supportDirectory, { force: true, recursive: true });
  await mkdir(paths.supportDirectory, { recursive: true, mode: 0o700 });
  await mkdir(dirname(paths.plist), { recursive: true });
  await cp(configuration.runnerSourceDirectory, paths.supportDirectory, {
    recursive: true,
    force: true,
  });
  await writeFile(paths.plist, renderLaunchAgentPlist(configuration), { mode: 0o600 });
  await execute("/bin/launchctl", ["bootstrap", `gui/${userId}`, paths.plist]);
  await execute("/bin/launchctl", ["enable", `gui/${userId}/${label}`]);
  await execute("/bin/launchctl", ["kickstart", "-k", `gui/${userId}/${label}`]);
  return paths;
}

export async function uninstallLaunchAgent(homeDirectory = homedir(), userId = process.getuid?.()) {
  if (userId === undefined) throw new Error("Unable to determine the current macOS user ID.");
  const paths = launchAgentPaths(homeDirectory);
  await bootout(userId, paths.plist);
  await rm(paths.plist, { force: true });
  await rm(paths.supportDirectory, { force: true, recursive: true });
}

export async function launchAgentStatus(userId = process.getuid?.()) {
  if (userId === undefined) throw new Error("Unable to determine the current macOS user ID.");
  try {
    const { stdout } = await execute("/bin/launchctl", ["print", `gui/${userId}/${label}`]);
    return stdout;
  } catch {
    return undefined;
  }
}
