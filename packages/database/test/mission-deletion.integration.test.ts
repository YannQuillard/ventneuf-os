import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { createDatabase } from "../src/client.js";
import { migrate } from "../src/migrate.js";
import { WorkspaceRepository, WorkspaceAccessError } from "../src/workspace.js";
import { ConversationRuntimeRepository } from "../src/runtime.js";
import { RunnerMissionRepository, RunnerLeaseError } from "../src/runner-missions.js";

const url = process.env.TEST_DATABASE_URL;

test("mission deletion removes visibility, fences access and leaves cancellation available for runner cleanup", { skip: !url }, async () => {
  await migrate(url!);
  const admin = postgres(url!, { max: 1, prepare: false });
  const runtimeUrl = new URL(url!);
  runtimeUrl.searchParams.set("options", "-c role=ventneuf_runtime");
  const database = createDatabase(runtimeUrl.toString());
  const workspace = new WorkspaceRepository(database);
  const runtime = new ConversationRuntimeRepository(database);
  const runner = new RunnerMissionRepository(database);
  const organizationId = randomUUID();
  const memberId = randomUUID();
  const recipientId = randomUUID();
  const deviceId = randomUUID();
  const scope = { organizationId, externalSubject: "deletion-owner" };
  const recipient = { organizationId, externalSubject: "deletion-recipient" };
  const device = { organizationId, deviceId, credentialHash: randomUUID() };
  try {
    await admin`insert into organizations (id,slug,name) values (${organizationId},${organizationId},'Deletion test')`;
    await admin`insert into members (id,organization_id,external_subject,handle,display_name) values
      (${memberId},${organizationId},${scope.externalSubject},'owner','Owner'),
      (${recipientId},${organizationId},${recipient.externalSubject},'recipient','Recipient')`;
    await admin`insert into devices (id,organization_id,member_id,name,platform) values (${deviceId},${organizationId},${memberId},'Device','darwin')`;
    await admin`insert into device_credentials (organization_id,device_id,token_hash) values (${organizationId},${deviceId},${device.credentialHash})`;
    await runner.register(device, [{ id: "sample", name: "Sample" }], {});
    const project = await workspace.createProject(scope, { name: "Mission project", repositoryAssociations: [{ deviceId, repositoryId: "sample" }] });
    await workspace.shareProject(scope, project.id, recipientId);
    const conversation = await workspace.createConversation(scope, { title: "Disposable mission", kind: "mission", projectId: project.id });
    const primary = await workspace.createConversation(scope, { title: "Keep conversation", kind: "private" });
    await workspace.shareConversation(scope, conversation.id, recipientId);
    const queued = await runtime.enqueuePrivateMessage({ ...scope, conversationId: conversation.id, content: "Check repository",
      runner: { deviceId, repositoryId: "sample" } });
    const owner = randomUUID();
    const claim = await runner.claim(device, owner, "lease");
    assert.equal(claim?.id, queued.mission.id);
    await assert.rejects(workspace.deleteMissionConversation(recipient, conversation.id), WorkspaceAccessError);
    await assert.rejects(workspace.deleteMissionConversation({ ...scope, organizationId: randomUUID() }, conversation.id), WorkspaceAccessError);
    await assert.rejects(workspace.deleteMissionConversation(scope, primary.id), WorkspaceAccessError);
    assert.equal((await workspace.deleteMissionConversation(scope, conversation.id)).id, conversation.id);
    assert.equal((await workspace.deleteMissionConversation(scope, conversation.id)).id, conversation.id);
    assert.ok(!(await workspace.listConversations(scope)).some(({ id }) => id === conversation.id));
    assert.ok(!(await workspace.listConversations(recipient)).some(({ id }) => id === conversation.id));
    await assert.rejects(workspace.getConversation(scope, conversation.id), WorkspaceAccessError);
    await assert.rejects(runtime.getConversationSnapshot({ ...scope, conversationId: conversation.id }), WorkspaceAccessError);
    await assert.rejects(runtime.enqueuePrivateMessage({ ...scope, conversationId: conversation.id, content: "Restart" }));
    assert.deepEqual(await runner.inspect(device, queued.mission.id), { status: "cancelled" });
    await assert.rejects(runner.renew(device, { missionId: queued.mission.id, owner, tokenHash: "lease" }), RunnerLeaseError);
    assert.ok((await workspace.listConversations(scope)).some(({ id }) => id === primary.id));
  } finally { await database.close(); await admin.end(); }
});
