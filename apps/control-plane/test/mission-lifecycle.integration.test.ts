import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import postgres from "postgres";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ConversationRuntimeRepository, createDatabase, migrate, MissionApprovalRepository, RunnerMissionRepository, WorkspaceRepository } from "@ventneuf/database";
import type { AuthorizationContext } from "@ventneuf/domain";
import { createApp } from "../src/app.js";
import { createDeviceCredential } from "../src/device-auth.js";
import { HmacMissionDelegationMac, MissionDelegation } from "../src/mission-delegation.js";
import { createRemoteMcpServer } from "../src/mcp.js";
import { MissionWorker, type ConversationRuntime, type MissionQueue } from "../src/runtime.js";
import { StaticTokenProvider, type HermesClient } from "../src/hermes.js";
import { RunnerCloudClient } from "../../runner/src/cloud-client.js";
import { RunnerMissionWorker } from "../../runner/src/mission-worker.js";
import { MissionPausedError } from "../../runner/src/repositories.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

test("project chat reaches a completed mission through forms, delegated dispatch, approval and lost-result acknowledgement", { skip: !databaseUrl }, async () => {
  await migrate(databaseUrl!);
  const runtimeUrl = new URL(databaseUrl!);
  runtimeUrl.searchParams.set("options", "-c role=ventneuf_runtime");
  const database = createDatabase(runtimeUrl.toString());
  const admin = postgres(databaseUrl!, { max: 1, prepare: false });
  const organizationId = randomUUID(), memberId = randomUUID(), deviceId = randomUUID(), projectId = randomUUID(), conversationId = randomUUID();
  const credential = createDeviceCredential(organizationId, deviceId);
  const device = { deviceId, credential: credential.token, name: "Test runner", platform: "darwin" as const };
  const repository = new ConversationRuntimeRepository(database);
  const approvals = new MissionApprovalRepository(database);
  const queue: Array<{ organizationId: string; missionId: string }> = [];
  const missionQueue = { publish: async (envelope: { organizationId: string; missionId: string }) => { queue.push(envelope); } } as MissionQueue;
  const delegations = new MissionDelegation(new HmacMissionDelegationMac(new StaticTokenProvider("isolated-lifecycle-test-secret-00000000")));
  const runtime = { database, repository, approvals, queue: missionQueue, workspace: new WorkspaceRepository(database),
    runnerMissions: new RunnerMissionRepository(database) } as ConversationRuntime;
  const user: AuthorizationContext = { organizationId, principalId: "lifecycle-member", principalType: "user",
    capabilities: ["hermes:ask", "mission:create"], projectIds: [projectId], expiresAt: new Date(Date.now() + 600_000).toISOString() };
  const service: AuthorizationContext = { ...user, principalId: "hermes-supervisor", principalType: "service",
    capabilities: ["mission:dispatch", "approval:decide"] };
  const call = async (name: string, args: Record<string, unknown>) => {
    const server = createRemoteMcpServer(service, { conversations: runtime, delegations });
    const client = new Client({ name: "lifecycle-test", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport); await client.connect(clientTransport);
    try {
      const result = await client.callTool({ name, arguments: args });
      assert.equal(result.isError, undefined, JSON.stringify(result.content));
      return result.structuredContent as Record<string, string>;
    } finally { await client.close(); await server.close(); }
  };
  let turns = 0;
  let formMessageId = "", childMissionId = "", childConversationId = "", approvalReference = "";
  const hermes: HermesClient = { ask: async ({ message }) => {
    turns += 1;
    const delegationId = message.match(/(?:Approval )?Delegation ID: ([0-9a-f-]{36})/)?.[1];
    assert.ok(delegationId);
    assert.doesNotMatch(message, /vnd1\./);
    if (message.includes("<ventneuf_approval_authority>")) {
      const approvalId = message.match(/Approval request: ([0-9a-f-]{36})/)?.[1];
      assert.ok(approvalId);
      approvalReference = delegationId;
      const lookup = { organizationId, serviceId: service.principalId, delegationId };
      assert.equal(await repository.getMissionApprovalDelegation({ ...lookup, serviceId: "other-service" }), undefined);
      assert.equal(await repository.getMissionApprovalDelegation({ ...lookup, organizationId: randomUUID() }), undefined);
      assert.equal(await repository.getMissionApprovalDelegation({ ...lookup, delegationId: randomUUID() }), undefined);
      assert.equal(await repository.getMissionDispatchDelegation(lookup), undefined);
      await call("approval.decide", { approvalId, delegationToken: delegationId, requestId: randomUUID(),
        decision: "approved", rationale: "The pull request is within the confirmed project mission." });
    } else if (turns === 1) {
      assert.match(message, /Keep existing pagination URLs/);
      const form = await call("conversation.ask_questions", { delegationId, requestId: randomUUID(), title: "Confirm the execution plan",
        questions: [{ id: "plan", label: "Execution plan", mode: "single", defaultValues: ["opus-high"],
          options: [{ value: "opus-high", label: "Claude Code: Opus/high, sub-agents Opus/high" },
            { value: "sonnet-high", label: "Claude Code: Sonnet/high, sub-agents Sonnet/high" }] }] });
      formMessageId = form.messageId;
    } else {
      assert.match(message, /Claude Code: Opus\/high, sub-agents Opus\/high/);
      const args = { delegationToken: delegationId, requestId: randomUUID(), projectId, deviceId, repositoryId: "sample",
        objective: "Improve product listing performance while preserving pagination URLs", adapter: "claude-development", model: "opus",
        reasoningEffort: "high", subagents: { models: ["opus"], reasoningEffort: "high" } };
      const child = await call("mission.dispatch", args);
      assert.deepEqual(await call("mission.dispatch", args), child);
      childMissionId = child.missionId; childConversationId = child.conversationId;
    }
    return { contextId: "lifecycle-context", text: turns === 1 ? "Choose the execution plan in the form." : "The requested operation is ready." };
  } };
  const worker = new MissionWorker(repository, missionQueue, hermes, { serviceId: service.principalId, issuer: delegations }, approvals);
  const server = createServer(createApp({ verifier: { verify: async token => token === "lifecycle-user" ? user : undefined },
    hermes, conversations: runtime, delegations }));
  try {
    await admin`insert into organizations (id, slug, name) values (${organizationId}, ${organizationId}, 'Lifecycle test')`;
    await admin`insert into members (id, organization_id, external_subject, handle, display_name)
      values (${memberId}, ${organizationId}, 'lifecycle-member', 'lifecycle', 'Lifecycle member')`;
    await admin`insert into devices (id, organization_id, member_id, name, platform)
      values (${deviceId}, ${organizationId}, ${memberId}, 'Test runner', 'darwin')`;
    await admin`insert into device_credentials (organization_id, device_id, token_hash) values (${organizationId}, ${deviceId}, ${credential.tokenHash})`;
    await admin`insert into projects (id, organization_id, owner_member_id, name, context)
      values (${projectId}, ${organizationId}, ${memberId}, 'Performance', '{"memory":["Keep existing pagination URLs"]}'::jsonb)`;
    await admin`insert into project_repositories (organization_id, project_id, device_id, repository_id)
      values (${organizationId}, ${projectId}, ${deviceId}, 'sample')`;
    await admin`insert into conversations (id, organization_id, owner_member_id, project_id, kind, title, is_project_general)
      values (${conversationId}, ${organizationId}, ${memberId}, ${projectId}, 'private', 'General', true)`;
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const base = new URL(`http://127.0.0.1:${address.port}`);
    const cloud = new RunnerCloudClient(base);
    await cloud.registerRepositories(device, [{ id: "sample", name: "Sample" }], { claude: { models: ["opus", "sonnet"] } });
    const post = (path: string, body: unknown) => fetch(new URL(path, base), { method: "POST",
      headers: { authorization: "Bearer lifecycle-user", "content-type": "application/json" }, body: JSON.stringify(body) });
    const endpoint = `/api/workspace/conversations/${conversationId}/messages`;
    assert.equal((await post(endpoint, { content: "@hermes Improve product listing performance", delivery: "project_chat" })).status, 202);
    assert.equal(queue.length, 1);
    await worker.process(queue.shift()!);
    assert.ok(formMessageId);
    assert.equal((await post(endpoint, { content: "Confirm", questionnaireReply: { messageId: formMessageId, answers: { plan: ["opus-high"] } } })).status, 202);
    await worker.process(queue.shift()!);
    assert.ok(childMissionId); assert.notEqual(childConversationId, conversationId);
    let executions = 0, lostAcknowledgements = 0;
    const reportMission = cloud.reportMission.bind(cloud);
    cloud.reportMission = async (...args) => {
      await reportMission(...args);
      if (args[2].kind === "completed" && lostAcknowledgements++ === 0) throw new TypeError("Lost response after persistence");
    };
    const runner = new RunnerMissionWorker({ client: cloud, store: { load: async () => device, save: async () => {} },
      repositories: async () => [{ id: "sample", name: "Sample", path: "/synthetic-repository" }],
      harnesses: async () => ({ claude: { models: ["opus", "sonnet"] } }),
      adapter: { execute: async (mission, _repository, _signal, execution) => {
        executions += 1;
        assert.equal(mission.id, childMissionId); assert.equal(mission.model, "opus"); assert.equal(mission.reasoningEffort, "high");
        assert.deepEqual(mission.subagents, { models: ["opus"], reasoningEffort: "high" });
        if (executions === 1) {
          const approval = await execution!.requestApproval({ requestId: randomUUID(),
            action: { category: "pull_request.create", target: "GitHub pull request creation", argumentsDigest: "a".repeat(64),
              summary: "Create the mission pull request", expectedEffect: "Publish the validated changes for review" },
            reason: "Deliver the requested changes", evidence: {}, resume: { adapter: "claude", sessionId: mission.id } });
          assert.equal(approval.approval.status, "pending");
          throw new MissionPausedError();
        }
        assert.equal(mission.approvalDecision?.status, "approved");
        return "Performance changes completed. Tests passed. https://github.com/example/sample/pull/1";
      } } });
    await runner.tick();
    assert.equal(await cloud.getMissionStatus(device, childMissionId), "waiting_for_approval");
    assert.equal(queue.length, 1);
    await worker.process(queue.shift()!);
    assert.equal(await cloud.getMissionStatus(device, childMissionId), "queued");
    await runner.tick();
    const snapshot = await repository.getConversationSnapshot({ organizationId, externalSubject: user.principalId, conversationId: childConversationId });
    assert.equal(await cloud.getMissionStatus(device, childMissionId), "completed");
    assert.equal(snapshot.messages.filter(message => message.content.includes("https://github.com/example/sample/pull/1")).length, 1);
    assert.equal(executions, 2); assert.equal(lostAcknowledgements, 2); assert.equal(turns, 3);
    const children = await admin`select id from missions where organization_id=${organizationId} and assigned_device_id=${deviceId}`;
    assert.equal(children.length, 1);
    assert.equal(await repository.getMissionApprovalDelegation({ organizationId, serviceId: service.principalId,
      delegationId: approvalReference }), undefined);
  } finally {
    await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
    await database.close();
    try {
      await admin`update conversations set mission_id = null where organization_id=${organizationId}`;
      for (const table of ["mission_approvals", "mission_events", "missions", "messages", "conversations", "project_repositories", "projects", "device_credentials", "devices", "members"])
        await admin.unsafe(`delete from ${table} where organization_id = $1`, [organizationId]);
      await admin`delete from organizations where id=${organizationId}`;
    } finally { await admin.end(); }
  }
});
