import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { AuthorizationContext } from "@ventneuf/domain";
import { createRemoteMcpServer, type RemoteMcpServices } from "../src/mcp.js";

const identity: AuthorizationContext = {
  organizationId: "organization-a", principalId: "subject-a", principalType: "user",
  capabilities: ["hermes:ask"], projectIds: [], expiresAt: new Date(Date.now() + 60_000).toISOString(),
};

async function callTool(
  services: RemoteMcpServices,
  context: AuthorizationContext,
  name: string,
  args: Record<string, unknown>,
) {
  const server = createRemoteMcpServer(context, services);
  const client = new Client({ name: "test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    return await client.callTool({ name, arguments: args });
  } finally {
    await client.close();
    await server.close();
  }
}

const ask = (services: RemoteMcpServices, context = identity, contextId?: string) =>
  callTool(services, context, "hermes.ask", { message: "Investigate", contextId });

test("MCP queues through the authenticated private conversation boundary", async () => {
  const published: unknown[] = [];
  const result = await ask({ conversations: {
    repository: {
      enqueuePrivateMessage: async (input: unknown) => {
        assert.deepEqual(input, {
          organizationId: "organization-a", externalSubject: "subject-a", content: "Investigate", contextId: "owned-context",
        });
        return { conversationId: "owned-conversation", message: { createdAt: new Date() }, mission: { id: "mission-a", status: "queued", context: {} } };
      },
      setMissionQueued: async () => {},
    },
    queue: { publish: async (...args: unknown[]) => { published.push(args); } },
  } as never }, identity, "owned-context");
  assert.equal(result.isError, undefined);
  assert.equal((result.structuredContent as { missionId: string }).missionId, "mission-a");
  assert.deepEqual(published, [[{ organizationId: "organization-a", missionId: "mission-a" }, "owned-conversation"]]);
});

test("MCP fails closed without a runtime, capability, user identity, or owned context", async () => {
  assert.equal((await ask({})).isError, true);
  const services = { conversations: {
    repository: { enqueuePrivateMessage: async () => { throw new Error("The private conversation context is unavailable."); } },
    queue: { publish: async () => assert.fail("An unauthorized request must not be published") },
  } as never };
  assert.equal((await ask(services, identity, "someone-elses-context")).isError, true);
  for (const context of [
    { ...identity, capabilities: [] },
    { ...identity, principalType: "mission" as const },
    { ...identity, principalType: "device" as const },
    { ...identity, expiresAt: new Date(0).toISOString() },
  ]) {
    assert.equal((await ask({ conversations: {
      repository: { enqueuePrivateMessage: async () => assert.fail("Must reject before database access") },
    } as never }, context)).isError, true);
  }
});

test("MCP dispatches an objective only through the authenticated member's runner scope", async () => {
  const authorized = { ...identity, capabilities: ["mission:create" as const] };
  let received: unknown;
  const services = { conversations: { repository: {
    enqueuePrivateMessage: async (input: unknown) => {
      received = input;
      return { conversationId: "conversation-a", mission: { id: "mission-a", status: "queued" } };
    },
  } as never } };
  const args = {
    objective: "Review cancellation behavior",
    deviceId: "00000000-0000-4000-8000-000000000001",
    repositoryId: "ventneuf-os",
    adapter: "orca-review",
  };
  const result = await callTool(services, authorized, "mission.dispatch", args);
  assert.equal(result.isError, undefined);
  assert.deepEqual(result.structuredContent, {
    conversationId: "conversation-a",
    missionId: "mission-a",
    status: "queued",
  });
  assert.deepEqual(received, {
    organizationId: "organization-a",
    externalSubject: "subject-a",
    content: args.objective,
    runner: {
      deviceId: args.deviceId,
      repositoryId: args.repositoryId,
      adapter: args.adapter,
    },
  });

  for (const context of [identity, { ...authorized, principalType: "mission" as const }]) {
    const rejected = await callTool({ conversations: { repository: {
      enqueuePrivateMessage: async () => assert.fail("Authorization must fail before database access"),
    } as never } }, context, "mission.dispatch", args);
    assert.equal(rejected.isError, true);
  }
});
