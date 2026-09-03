import assert from "node:assert/strict";
import { createServer, get, request } from "node:http";
import test from "node:test";
import type { ConversationRuntime } from "../src/runtime.js";
import { createApp } from "../src/app.js";

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

test("persists and queues an authenticated Hermes message", async () => {
  const published: unknown[] = [];
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
          message: { id: "message-1", content: "Hello Hermes" },
          mission: { id: "mission-1", status: "queued" },
        }),
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
    assert.deepEqual(published, [[{
      organizationId: "00000000-0000-4000-8000-000000000001",
      missionId: "mission-1",
    }, "conversation-1"]]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
