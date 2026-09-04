import assert from "node:assert/strict";
import test from "node:test";
import type { StoredDevice } from "../src/credential-store.js";
import { LocalRunnerBridge } from "../src/local-bridge.js";

const origin = "http://localhost:3000";

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
