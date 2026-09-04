#!/usr/bin/env node
import { hostname, userInfo } from "node:os";
import { RunnerCloudClient } from "./cloud-client.js";
import { MacOSKeychainCredentialStore } from "./credential-store.js";
import { LocalRunnerBridge } from "./local-bridge.js";

if (process.platform !== "darwin") throw new Error("The first runner release supports macOS only.");

const controlPlaneUrl = process.env.VENTNEUF_CONTROL_PLANE_URL;
if (!controlPlaneUrl) throw new Error("VENTNEUF_CONTROL_PLANE_URL is required.");
const allowedOrigins = new Set(
  (process.env.VENTNEUF_WEB_ORIGINS ?? "http://localhost:3000")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const port = Number.parseInt(process.env.VENTNEUF_RUNNER_PORT ?? "41929", 10);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("VENTNEUF_RUNNER_PORT is invalid.");

const bridge = new LocalRunnerBridge({
  client: new RunnerCloudClient(new URL(controlPlaneUrl)),
  store: new MacOSKeychainCredentialStore(userInfo().username),
  deviceName: hostname(),
  allowedOrigins,
});
await bridge.start(port);
console.info(`ventneuf.os runner listening on http://127.0.0.1:${port}`);
