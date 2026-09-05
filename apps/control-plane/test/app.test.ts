import assert from "node:assert/strict";
import { createServer, get, request } from "node:http";
import test from "node:test";
import type { ConversationRuntime } from "../src/runtime.js";
import { createApp } from "../src/app.js";
import { hashDeviceToken, parseDeviceCredential } from "../src/device-auth.js";

async function postJson(server: ReturnType<typeof createServer>, path: string, body: unknown, token?: string) {
  const address = server.address();
  assert(address && typeof address === "object");
  return new Promise<{ body: string; statusCode?: number; headers: Record<string, string | string[] | undefined> }>((resolve, reject) => {
    const outgoing = request({
      hostname: "127.0.0.1",
      port: address.port,
      path,
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    }, (incoming) => {
      let responseBody = "";
      incoming.setEncoding("utf8");
      incoming.on("data", (chunk) => { responseBody += chunk; });
      incoming.on("end", () => resolve({
        body: responseBody,
        statusCode: incoming.statusCode,
        headers: incoming.headers,
      }));
    });
    outgoing.on("error", reject);
    outgoing.end(JSON.stringify(body));
  });
}

test("accepts platform health checks when listening on all interfaces", async () => {
  const app = createApp({
    host: "0.0.0.0",
    verifier: { verify: async () => undefined },
    hermes: {
      ask: async () => ({ contextId: "unused", text: "unused" }),
    },
  });
  const server = createServer(app);

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert(address && typeof address === "object");

    const response = await new Promise<{ body: string; statusCode?: number }>(
      (resolve, reject) => {
        get(
          {
            hostname: "127.0.0.1",
            port: address.port,
            path: "/health",
            headers: { host: "10.0.0.42:8787" },
          },
          (incoming) => {
            let body = "";
            incoming.setEncoding("utf8");
            incoming.on("data", (chunk) => {
              body += chunk;
            });
            incoming.on("end", () => resolve({ body, statusCode: incoming.statusCode }));
          },
        ).on("error", reject);
      },
    );

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), {
      service: "ventneuf-os-control-plane",
      status: "ok",
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("enrolls a device with one-time and durable opaque credentials", async () => {
  const organizationId = "00000000-0000-4000-8000-000000000001";
  let enrollmentHash = "";
  let credentialHash = "";
  const app = createApp({
    verifier: {
      verify: async () => ({
        organizationId,
        principalId: "member-subject",
        principalType: "user",
        memberId: "00000000-0000-4000-8000-000000000002",
        projectIds: [],
        capabilities: ["device:manage"],
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    },
    hermes: { ask: async () => ({ contextId: "unused", text: "unused" }) },
    conversations: {
      devices: {
        createEnrollment: async (input: { tokenHash: string }) => {
          enrollmentHash = input.tokenHash;
          return { id: "enrollment-1" };
        },
        consumeEnrollment: async (input: { deviceId: string; credentialHash: string }) => {
          credentialHash = input.credentialHash;
          return { id: input.deviceId, name: "Yann MacBook", platform: "darwin" };
        },
      },
    } as unknown as ConversationRuntime,
  });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const enrollmentResponse = await postJson(server, "/api/devices/enrollments", {}, "user-token");
    assert.equal(enrollmentResponse.statusCode, 201);
    assert.equal(enrollmentResponse.headers["cache-control"], "no-store");
    const enrollment = JSON.parse(enrollmentResponse.body) as { token: string };
    assert.notEqual(enrollment.token, enrollmentHash);
    assert.equal(hashDeviceToken(enrollment.token), enrollmentHash);

    const deviceResponse = await postJson(server, "/api/runner/enroll", {
      token: enrollment.token,
      name: "Yann MacBook",
      platform: "darwin",
    });
    assert.equal(deviceResponse.statusCode, 201);
    assert.equal(deviceResponse.headers["cache-control"], "no-store");
    const enrolled = JSON.parse(deviceResponse.body) as { credential: string; device: { id: string } };
    assert.deepEqual(parseDeviceCredential(enrolled.credential), {
      organizationId,
      deviceId: enrolled.device.id,
    });
    assert.equal(hashDeviceToken(enrolled.credential), credentialHash);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("authenticates runner heartbeats with the device credential", async () => {
  const organizationId = "00000000-0000-4000-8000-000000000001";
  const deviceId = "00000000-0000-4000-8000-000000000003";
  const credential = `vnod.${organizationId}.${deviceId}.${"a".repeat(43)}`;
  let receivedHash = "";
  const app = createApp({
    verifier: { verify: async () => undefined },
    hermes: { ask: async () => ({ contextId: "unused", text: "unused" }) },
    conversations: {
      devices: {
        heartbeat: async (input: { credentialHash: string }) => {
          receivedHash = input.credentialHash;
          return { id: deviceId };
        },
      },
    } as unknown as ConversationRuntime,
  });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const response = await postJson(server, "/api/runner/heartbeat", {}, credential);
    assert.equal(response.statusCode, 200);
    assert.equal((JSON.parse(response.body) as { status: string }).status, "online");
    assert.equal(receivedHash, hashDeviceToken(credential));

    const rejected = await postJson(server, "/api/runner/heartbeat", {}, "invalid");
    assert.equal(rejected.statusCode, 401);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("persists and queues an authenticated Hermes message", async () => {
  const published: unknown[] = [];
  let queuedContext: Record<string, unknown> | undefined;
  const app = createApp({
    verifier: {
      verify: async () => ({
        organizationId: "00000000-0000-4000-8000-000000000001",
        principalId: "00000000-0000-4000-8000-000000000002",
        principalType: "user",
        memberId: "00000000-0000-4000-8000-000000000002",
        projectIds: [],
        capabilities: ["hermes:ask"],
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    },
    hermes: { ask: async () => ({ contextId: "unused", text: "unused" }) },
    conversations: {
      repository: {
        enqueuePrivateMessage: async () => ({
          conversationId: "conversation-1",
          message: { id: "message-1", content: "Hello Hermes", createdAt: new Date() },
          mission: { id: "mission-1", status: "queued", context: {} },
        }),
        setMissionQueued: async (
          _organizationId: string,
          _missionId: string,
          context: Record<string, unknown>,
        ) => { queuedContext = context; },
      },
      queue: {
        publish: async (...input: unknown[]) => { published.push(input); },
      },
    } as unknown as ConversationRuntime,
  });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const address = server.address();
    assert(address && typeof address === "object");
    const result = await new Promise<{ body: string; statusCode?: number }>((resolve, reject) => {
      const outgoing = request({
        hostname: "127.0.0.1",
        port: address.port,
        path: "/api/conversations/hermes/messages",
        method: "POST",
        headers: { authorization: "Bearer valid", "content-type": "application/json" },
      }, (incoming) => {
        let body = "";
        incoming.setEncoding("utf8");
        incoming.on("data", (chunk) => { body += chunk; });
        incoming.on("end", () => resolve({ body, statusCode: incoming.statusCode }));
      });
      outgoing.on("error", reject);
      outgoing.end(JSON.stringify({ content: "Hello Hermes" }));
    });

    assert.equal(result.statusCode, 202);
    assert.equal(JSON.parse(result.body).missionId, "mission-1");
    assert.equal(typeof (queuedContext?.timing as Record<string, unknown>)?.queuedAt, "string");
    assert.deepEqual(published, [[{
      organizationId: "00000000-0000-4000-8000-000000000001",
      missionId: "mission-1",
    }, "conversation-1"]]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("records an explicit approval decision for the authenticated initiating member", async () => {
  const organizationId = "00000000-0000-4000-8000-000000000001";
  const approvalId = "00000000-0000-4000-8000-000000000002";
  const requestId = "00000000-0000-4000-8000-000000000003";
  let received: unknown;
  const app = createApp({
    verifier: { verify: async () => ({
      organizationId,
      principalId: "member-subject",
      principalType: "user",
      projectIds: [],
      capabilities: ["approval:decide"],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }) },
    hermes: { ask: async () => ({ contextId: "unused", text: "unused" }) },
    conversations: {
      approvals: {
        decideByMember: async (input: unknown) => {
          received = input;
          return { id: approvalId, status: "approved" };
        },
      },
    } as unknown as ConversationRuntime,
  });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await postJson(
      server,
      `/api/conversations/hermes/approvals/${approvalId}/decision`,
      { requestId, decision: "approved", rationale: "The exact action is expected." },
      "member-token",
    );
    assert.equal(response.statusCode, 200);
    assert.deepEqual(received, {
      organizationId,
      externalSubject: "member-subject",
      approvalId,
      decisionRequestId: requestId,
      decision: "approved",
      rationale: "The exact action is expected.",
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("accepts a lease-bound runner approval request and queues its Hermes review", async () => {
  const organizationId = "00000000-0000-4000-8000-000000000001";
  const deviceId = "00000000-0000-4000-8000-000000000002";
  const missionId = "00000000-0000-4000-8000-000000000003";
  const approvalId = "00000000-0000-4000-8000-000000000004";
  const reviewMissionId = "00000000-0000-4000-8000-000000000005";
  const conversationId = "00000000-0000-4000-8000-000000000006";
  const credential = `vnod.${organizationId}.${deviceId}.${"a".repeat(43)}`;
  const leaseToken = "b".repeat(64);
  const requestId = "00000000-0000-4000-8000-000000000007";
  let received: unknown;
  const published: unknown[] = [];
  const app = createApp({
    verifier: { verify: async () => undefined },
    hermes: { ask: async () => ({ contextId: "unused", text: "unused" }) },
    conversations: {
      approvals: {
        requestFromRunner: async (scope: unknown, input: unknown) => {
          received = { scope, input };
          return {
            created: true,
            approval: {
              id: approvalId,
              status: "pending",
              route: "hermes",
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
            },
            reviewMission: { id: reviewMissionId, conversationId },
          };
        },
      },
      queue: { publish: async (...input: unknown[]) => { published.push(input); } },
    } as unknown as ConversationRuntime,
  });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const body = {
      owner: "00000000-0000-4000-8000-000000000008",
      token: leaseToken,
      requestId,
      action: {
        category: "development.command",
        target: "npm test",
        argumentsDigest: "c".repeat(64),
        summary: "Run the repository test suite.",
        expectedEffect: "The test process reads the worktree and writes temporary output.",
      },
      reason: "The agent needs validation before opening a pull request.",
      evidence: { command: "npm test" },
      resume: { adapter: "codex", sessionId: "session-1" },
    };
    const response = await postJson(server, `/api/runner/missions/${missionId}/approvals`, body, credential);
    assert.equal(response.statusCode, 202);
    assert.deepEqual(received, {
      scope: { organizationId, deviceId, credentialHash: hashDeviceToken(credential) },
      input: { ...body, missionId, tokenHash: hashDeviceToken(leaseToken) },
    });
    assert.deepEqual(published, [[{ organizationId, missionId: reviewMissionId }, conversationId]]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("stops and cancels only the authenticated member's latest mission", async () => {
  const stopped: string[] = [];
  const cancelled: string[] = [];
  const app = createApp({
    verifier: {
      verify: async () => ({
        organizationId: "00000000-0000-4000-8000-000000000001",
        principalId: "member-subject",
        principalType: "user",
        memberId: "00000000-0000-4000-8000-000000000002",
        projectIds: [],
        capabilities: ["hermes:ask"],
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    },
    hermes: {
      ask: async () => ({ contextId: "unused", text: "unused" }),
      stop: async (runId) => { stopped.push(runId); },
    },
    conversations: {
      repository: {
        getLatestPrivateMission: async () => ({
          id: "mission-1",
          status: "running",
          context: {},
        }),
        cancelMission: async (_organizationId: string, missionId: string) => {
          cancelled.push(missionId);
          return [{ id: missionId, context: { hermesRunId: "run-created-after-read" } }];
        },
      },
    } as unknown as ConversationRuntime,
  });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const address = server.address();
    assert(address && typeof address === "object");
    const result = await new Promise<{ body: string; statusCode?: number }>((resolve, reject) => {
      const outgoing = request({
        hostname: "127.0.0.1",
        port: address.port,
        path: "/api/conversations/hermes/missions/mission-1/cancel",
        method: "POST",
        headers: { authorization: "Bearer valid" },
      }, (incoming) => {
        let body = "";
        incoming.setEncoding("utf8");
        incoming.on("data", (chunk) => { body += chunk; });
        incoming.on("end", () => resolve({ body, statusCode: incoming.statusCode }));
      });
      outgoing.on("error", reject);
      outgoing.end();
    });

    assert.equal(result.statusCode, 200);
    assert.equal(JSON.parse(result.body).status, "cancelled");
    assert.deepEqual(stopped, ["run-created-after-read"]);
    assert.deepEqual(cancelled, ["mission-1"]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("streams tenant-scoped mission activity as authenticated SSE", async () => {
  const app = createApp({
    verifier: {
      verify: async () => ({
        organizationId: "00000000-0000-4000-8000-000000000001",
        principalId: "member-subject",
        principalType: "user",
        memberId: "00000000-0000-4000-8000-000000000002",
        projectIds: [],
        capabilities: ["hermes:ask"],
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    },
    hermes: { ask: async () => ({ contextId: "unused", text: "unused" }) },
    conversations: {
      repository: {
        getLatestPrivateMission: async () => ({
          id: "mission-1",
          status: "running",
          context: { timing: { acceptedAt: "2026-09-03T20:00:00.000Z" } },
        }),
        listMissionEvents: async () => [{
          id: "event-1",
          missionId: "mission-1",
          type: "tool.started",
          payload: { tool: "terminal" },
          occurredAt: new Date("2026-09-03T20:00:01.000Z"),
        }],
      },
    } as unknown as ConversationRuntime,
  });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert(address && typeof address === "object");
    const body = await new Promise<string>((resolve, reject) => {
      const outgoing = get({
        hostname: "127.0.0.1",
        port: address.port,
        path: "/api/conversations/hermes/events",
        headers: { authorization: "Bearer valid" },
      }, (incoming) => {
        incoming.setEncoding("utf8");
        incoming.once("data", (chunk) => {
          resolve(chunk);
          incoming.destroy();
        });
      });
      outgoing.on("error", reject);
    });
    assert.match(body, /event: snapshot/);
    assert.match(body, /tool\.started/);
    assert.doesNotMatch(body, /member-subject/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("a failed upstream stop can be retried without reopening the cancelled mission", async () => {
  let status = "running";
  let transitions = 0;
  let stopAttempts = 0;
  const app = createApp({
    verifier: { verify: async () => ({
      organizationId: "organization-1", principalId: "member-1", principalType: "user",
      projectIds: [], capabilities: ["hermes:ask"], expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }) },
    hermes: {
      ask: async () => assert.fail("Cancellation must not submit work"),
      stop: async () => {
        assert.equal(status, "cancelled");
        if (++stopAttempts === 1) throw new Error("Stop temporarily unavailable");
      },
    },
    conversations: { repository: {
      getLatestPrivateMission: async () => ({ id: "mission-1", status, context: { hermesRunId: "run-1" } }),
      cancelMission: async () => {
        transitions++;
        status = "cancelled";
        return [{ id: "mission-1", context: { hermesRunId: "run-1" } }];
      },
    } } as unknown as ConversationRuntime,
  });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const path = "/api/conversations/hermes/missions/mission-1/cancel";
    assert.equal((await postJson(server, path, {}, "valid")).statusCode, 500);
    assert.equal((await postJson(server, path, {}, "valid")).statusCode, 200);
    assert.equal(transitions, 1);
    assert.equal(stopAttempts, 2);
    assert.equal((await postJson(server, "/api/conversations/hermes/missions/foreign/cancel", {}, "valid")).statusCode, 404);
    assert.equal(stopAttempts, 2);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
