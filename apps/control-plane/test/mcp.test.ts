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

test("MCP dispatches for Hermes only through a matching parent delegation", async () => {
  const organizationId = "00000000-0000-4000-8000-000000000001";
  const service = {
    organizationId,
    principalId: "hermes-supervisor",
    principalType: "service" as const,
    capabilities: ["mission:dispatch" as const],
    projectIds: [],
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  const args = {
    objective: "Inspect the repository",
    deviceId: "00000000-0000-4000-8000-000000000002",
    repositoryId: "ventneuf-os",
    adapter: "orca-review",
    delegationToken: "signed-parent-delegation",
    requestId: "00000000-0000-4000-8000-000000000003",
  };
  const claims = {
    version: 1 as const,
    issuer: "ventneuf-control-plane" as const,
    audience: "ventneuf-mcp" as const,
    delegationId: "00000000-0000-4000-8000-000000000004",
    serviceId: service.principalId,
    organizationId,
    parentMissionId: "00000000-0000-4000-8000-000000000005",
    conversationId: "00000000-0000-4000-8000-000000000006",
    memberId: "00000000-0000-4000-8000-000000000007",
    capabilities: ["mission:dispatch" as const] as ["mission:dispatch"],
    targets: [{
      deviceId: args.deviceId,
      repositoryId: args.repositoryId,
      adapters: ["orca-review" as const],
    }],
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  let received: unknown;
  const services: RemoteMcpServices = {
    delegations: {
      verify: async (token) => {
        assert.equal(token, args.delegationToken);
        return claims;
      },
    },
    conversations: { repository: {
      enqueueDelegatedRunnerMission: async (input: unknown) => {
        received = input;
        return { conversationId: claims.conversationId, mission: { id: "child-mission", status: "queued" } };
      },
    } as never },
  };
  const result = await callTool(services, service, "mission.dispatch", args);
  assert.equal(result.isError, undefined);
  assert.deepEqual(result.structuredContent, {
    conversationId: claims.conversationId,
    missionId: "child-mission",
    status: "queued",
  });
  assert.deepEqual(received, {
    organizationId,
    parentMissionId: claims.parentMissionId,
    conversationId: claims.conversationId,
    memberId: claims.memberId,
    serviceId: service.principalId,
    delegationId: claims.delegationId,
    requestId: args.requestId,
    expiresAt: new Date(claims.expiresAt),
    objective: args.objective,
    deviceId: args.deviceId,
    repositoryId: args.repositoryId,
    adapter: args.adapter,
  });

  for (const [context, input, delegated] of [
    [{ ...service, capabilities: [] }, args, services.delegations],
    [service, { ...args, delegationToken: undefined }, services.delegations],
    [service, { ...args, requestId: undefined }, services.delegations],
    [service, { ...args, repositoryId: "foreign" }, services.delegations],
    [service, args, undefined],
  ] as const) {
    const rejected = await callTool({
      conversations: { repository: {
        enqueueDelegatedRunnerMission: async () => assert.fail("Invalid delegation must fail before database access"),
      } as never },
      delegations: delegated,
    }, context, "mission.dispatch", input);
    assert.equal(rejected.isError, true);
  }
  for (const foreignClaims of [
    { ...claims, serviceId: "other-service" },
    { ...claims, organizationId: "00000000-0000-4000-8000-000000000099" },
  ]) {
    const rejected = await callTool({
      conversations: { repository: {
        enqueueDelegatedRunnerMission: async () => assert.fail("Foreign claims must fail before database access"),
      } as never },
      delegations: { verify: async () => foreignClaims },
    }, service, "mission.dispatch", args);
    assert.equal(rejected.isError, true);
  }
});

test("MCP lets Hermes decide only the exact delegated approval", async () => {
  const organizationId = "00000000-0000-4000-8000-000000000001";
  const approvalId = "00000000-0000-4000-8000-000000000002";
  const service: AuthorizationContext = {
    organizationId,
    principalId: "hermes-supervisor",
    principalType: "service",
    capabilities: ["approval:decide"],
    projectIds: [],
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  const args = {
    approvalId,
    delegationToken: "signed-approval-delegation",
    requestId: "00000000-0000-4000-8000-000000000003",
    decision: "approved",
    rationale: "The command is within the delegated development policy.",
  };
  const claims = {
    version: 1 as const,
    issuer: "ventneuf-control-plane" as const,
    audience: "ventneuf-mcp" as const,
    delegationId: "00000000-0000-4000-8000-000000000004",
    serviceId: service.principalId,
    organizationId,
    parentMissionId: "00000000-0000-4000-8000-000000000005",
    conversationId: "00000000-0000-4000-8000-000000000006",
    memberId: "00000000-0000-4000-8000-000000000007",
    capabilities: ["approval:decide" as const] as ["approval:decide"],
    approvalId,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  let received: unknown;
  const services: RemoteMcpServices = {
    delegations: { verify: async () => claims },
    conversations: {
      repository: {} as never,
      queue: {} as never,
      approvals: {
        decideByService: async (input: unknown) => {
          received = input;
          return { id: approvalId, status: "approved" };
        },
      } as never,
    },
  };
  const result = await callTool(services, service, "approval.decide", args);
  assert.equal(result.isError, undefined);
  assert.deepEqual(received, {
    organizationId,
    serviceId: service.principalId,
    approvalId,
    reviewMissionId: claims.parentMissionId,
    conversationId: claims.conversationId,
    memberId: claims.memberId,
    decisionRequestId: args.requestId,
    decision: args.decision,
    rationale: args.rationale,
  });

  for (const [context, delegatedClaims] of [
    [{ ...service, capabilities: [] }, claims],
    [service, { ...claims, approvalId: "00000000-0000-4000-8000-000000000099" }],
    [service, { ...claims, serviceId: "foreign-service" }],
    [service, { ...claims, organizationId: "00000000-0000-4000-8000-000000000099" }],
  ] as const) {
    const rejected = await callTool({
      delegations: { verify: async () => delegatedClaims },
      conversations: {
        repository: {} as never,
        queue: {} as never,
        approvals: { decideByService: async () => assert.fail("Foreign approval scope must fail first") } as never,
      },
    }, context, "approval.decide", args);
    assert.equal(rejected.isError, true);
  }
});
