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

async function call(services: RemoteMcpServices, context = identity, contextId?: string) {
  const server = createRemoteMcpServer(context, services);
  const client = new Client({ name: "test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    return await client.callTool({ name: "hermes.ask", arguments: { message: "Investigate", contextId } });
  } finally {
    await client.close();
    await server.close();
  }
}

test("MCP queues through the authenticated private conversation boundary", async () => {
  const published: unknown[] = [];
  const result = await call({ conversations: {
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
  assert.equal((await call({})).isError, true);
  const services = { conversations: {
    repository: { enqueuePrivateMessage: async () => { throw new Error("The private conversation context is unavailable."); } },
    queue: { publish: async () => assert.fail("An unauthorized request must not be published") },
  } as never };
  assert.equal((await call(services, identity, "someone-elses-context")).isError, true);
  for (const context of [
    { ...identity, capabilities: [] },
    { ...identity, principalType: "mission" as const },
    { ...identity, principalType: "device" as const },
    { ...identity, expiresAt: new Date(0).toISOString() },
  ]) {
    assert.equal((await call({ conversations: {
      repository: { enqueuePrivateMessage: async () => assert.fail("Must reject before database access") },
    } as never }, context)).isError, true);
  }
});
