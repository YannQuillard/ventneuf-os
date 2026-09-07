import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { createDatabase } from "../src/client.js";
import { migrate } from "../src/migrate.js";
import { MissionApprovalRepository } from "../src/mission-approvals.js";
import { RunnerMissionRepository } from "../src/runner-missions.js";
import { ConversationRuntimeRepository } from "../src/runtime.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

test("workspace runtime isolates private threads and dispatches delegated work into private mission conversations", { skip: !databaseUrl }, async () => {
  await migrate(databaseUrl!);
  const admin = postgres(databaseUrl!, { max: 1, prepare: false });
  const runtimeUrl = new URL(databaseUrl!);
  runtimeUrl.searchParams.set("options", "-c role=ventneuf_runtime");
  const database = createDatabase(runtimeUrl.toString());
  const runtime = new ConversationRuntimeRepository(database);
  const runner = new RunnerMissionRepository(database);
  const organizationId = randomUUID();
  const ownerId = randomUUID();
  const collaboratorId = randomUUID();
  const deviceId = randomUUID();
  const progressDeviceId = randomUUID();
  const completionDeviceId = randomUUID();
  const approvalDeviceId = randomUUID();
  const projectId = randomUUID();
  const sourceConversationId = randomUUID();
  const ownerScope = { organizationId, externalSubject: "workspace-runtime-owner" };
  const collaboratorScope = { organizationId, externalSubject: "workspace-runtime-collaborator" };
  const runnerScope = { organizationId, deviceId, credentialHash: "workspace-runtime-device-credential" };
  const progressRunnerScope = { organizationId, deviceId: progressDeviceId, credentialHash: "workspace-runtime-progress-credential" };
  const completionRunnerScope = { organizationId, deviceId: completionDeviceId, credentialHash: "workspace-runtime-completion-credential" };
  const approvalRunnerScope = { organizationId, deviceId: approvalDeviceId, credentialHash: "workspace-runtime-approval-credential" };
  const runnerOwner = randomUUID();

  const enqueue = (scope: typeof ownerScope, content: string) => runtime.enqueuePrivateMessage({
    ...scope,
    content,
    conversationId: sourceConversationId,
  });
  const delegatedInput = (parentMissionId: string, memberId: string, requestId = randomUUID(), targetDeviceId = deviceId) => ({
    organizationId,
    parentMissionId,
    conversationId: sourceConversationId,
    memberId,
    serviceId: "hermes-supervisor",
    delegationId: randomUUID(),
    requestId,
    expiresAt: new Date(Date.now() + 60_000),
    objective: "Implement the workspace task",
    deviceId: targetDeviceId,
    repositoryId: "workspace-repository",
    projectId,
    adapter: "claude-development" as const,
    model: "opus" as const,
  });

  try {
    await admin`insert into organizations (id, slug, name)
      values (${organizationId}, ${organizationId}, 'Workspace runtime test')`;
    await admin`insert into members (id, organization_id, external_subject, handle, display_name) values
      (${ownerId}, ${organizationId}, ${ownerScope.externalSubject}, 'owner', 'Owner'),
      (${collaboratorId}, ${organizationId}, ${collaboratorScope.externalSubject}, 'collaborator', 'Collaborator')`;
    await admin`insert into devices (id, organization_id, member_id, name, platform, repositories) values
      (${deviceId}, ${organizationId}, ${ownerId}, 'Owner device', 'darwin',
        ${JSON.stringify([
          { id: "workspace-repository", name: "Workspace repository", claudeDevelopment: true, claudeModels: ["opus"] },
          { id: "unassociated-repository", name: "Unassociated repository", claudeDevelopment: true, claudeModels: ["sonnet"] },
        ])}::jsonb),
      (${progressDeviceId}, ${organizationId}, ${ownerId}, 'Progress device', 'darwin',
        ${JSON.stringify([{ id: "workspace-repository", name: "Workspace repository", claudeDevelopment: true, claudeModels: ["opus"] }])}::jsonb),
      (${completionDeviceId}, ${organizationId}, ${ownerId}, 'Completion device', 'darwin',
        ${JSON.stringify([{ id: "workspace-repository", name: "Workspace repository", claudeDevelopment: true, claudeModels: ["opus"] }])}::jsonb),
      (${approvalDeviceId}, ${organizationId}, ${ownerId}, 'Approval device', 'darwin',
        ${JSON.stringify([{ id: "workspace-repository", name: "Workspace repository", claudeDevelopment: true, claudeModels: ["opus"] }])}::jsonb)`;
    await admin`insert into device_credentials (organization_id, device_id, token_hash)
      values (${organizationId}, ${deviceId}, ${runnerScope.credentialHash}),
      (${organizationId}, ${progressDeviceId}, ${progressRunnerScope.credentialHash}),
      (${organizationId}, ${completionDeviceId}, ${completionRunnerScope.credentialHash}),
      (${organizationId}, ${approvalDeviceId}, ${approvalRunnerScope.credentialHash})`;
    await admin`insert into projects (id, organization_id, owner_member_id, name, context)
      values (${projectId}, ${organizationId}, ${ownerId}, 'Workspace project', '{}'::jsonb)`;
    await admin`insert into project_members (organization_id, project_id, member_id)
      values (${organizationId}, ${projectId}, ${collaboratorId})`;
    await admin`insert into project_repositories (organization_id, project_id, device_id, repository_id)
      values (${organizationId}, ${projectId}, ${deviceId}, 'workspace-repository'),
      (${organizationId}, ${projectId}, ${progressDeviceId}, 'workspace-repository'),
      (${organizationId}, ${projectId}, ${completionDeviceId}, 'workspace-repository'),
      (${organizationId}, ${projectId}, ${approvalDeviceId}, 'workspace-repository')`;
    await admin`insert into conversations (id, organization_id, owner_member_id, project_id, kind, title)
      values (${sourceConversationId}, ${organizationId}, ${ownerId}, ${projectId}, 'private', 'Private source')`;

    await assert.rejects(
      enqueue(collaboratorScope, "Project membership cannot append to a private thread."),
      /not found or access denied/,
    );
    await assert.rejects(
      runtime.getConversationSnapshot({ ...collaboratorScope, conversationId: sourceConversationId }),
      /not found or access denied/,
    );

    const ownerParent = await enqueue(ownerScope, "Prepare a private project mission.");
    assert.equal(ownerParent.conversationId, sourceConversationId);
    assert.equal(ownerParent.mission.context.workspaceVersion, 1);
    assert.equal(ownerParent.mission.context.projectId, projectId);
    await runtime.setMissionRunning(organizationId, ownerParent.mission.id, ownerParent.mission.context);
    const ownerDispatchScope = await runtime.getHermesDispatchScope(organizationId, ownerParent.mission.id);
    assert.deepEqual(ownerDispatchScope?.targets, [deviceId, progressDeviceId, completionDeviceId, approvalDeviceId].map((id) => ({
      deviceId: id,
      repositoryId: "workspace-repository",
      projectId,
      projectName: "Workspace project",
      adapters: ["repository-check", "claude-development"],
      claudeModels: ["opus"],
    })));

    await admin`insert into conversation_grants (organization_id, conversation_id, member_id)
      values (${organizationId}, ${sourceConversationId}, ${collaboratorId})`;
    const collaboratorSnapshot = await runtime.getConversationSnapshot({ ...collaboratorScope, conversationId: sourceConversationId });
    assert.equal(collaboratorSnapshot.messages.some(({ content }) => content === "Prepare a private project mission."), true);
    const beforeRevocation = collaboratorSnapshot.messages.length;
    await admin`delete from conversation_grants where organization_id = ${organizationId}
      and conversation_id = ${sourceConversationId} and member_id = ${collaboratorId}`;
    await assert.rejects(
      runtime.getConversationSnapshot({ ...collaboratorScope, conversationId: sourceConversationId }),
      /not found or access denied/,
    );
    await assert.rejects(enqueue(collaboratorScope, "This must remain unpublished."), /not found or access denied/);
    const ownerSnapshotAfterRevocation = await runtime.getConversationSnapshot({ ...ownerScope, conversationId: sourceConversationId });
    assert.equal(ownerSnapshotAfterRevocation.messages.length, beforeRevocation);

    const ownerDelegation = delegatedInput(ownerParent.mission.id, ownerId, randomUUID());
    await assert.rejects(runtime.enqueueDelegatedRunnerMission({
      ...ownerDelegation,
      requestId: randomUUID(),
      model: "sonnet",
    }));
    await assert.rejects(runtime.enqueueDelegatedRunnerMission({
      ...ownerDelegation,
      requestId: randomUUID(),
      projectId: randomUUID(),
    }));
    await assert.rejects(runtime.enqueueDelegatedRunnerMission({
      ...ownerDelegation,
      requestId: randomUUID(),
      repositoryId: "unassociated-repository",
    }));

    const ownerDelegated = await runtime.enqueueDelegatedRunnerMission(ownerDelegation);
    assert.notEqual(ownerDelegated.conversationId, sourceConversationId);
    assert.equal(ownerDelegated.mission.conversationId, ownerDelegated.conversationId);
    assert.equal(ownerDelegated.mission.projectId, projectId);
    const ownerDelegatedRetry = await runtime.enqueueDelegatedRunnerMission(ownerDelegation);
    assert.equal(ownerDelegatedRetry.mission.id, ownerDelegated.mission.id);
    assert.equal(ownerDelegatedRetry.conversationId, ownerDelegated.conversationId);
    const [ownerThread] = await admin<{ owner_member_id: string; parent_conversation_id: string; kind: string }[]>`
      select owner_member_id, parent_conversation_id, kind from conversations where id = ${ownerDelegated.conversationId}
    `;
    assert.deepEqual(ownerThread, {
      owner_member_id: ownerId,
      parent_conversation_id: sourceConversationId,
      kind: "mission",
    });
    const ownerClaim = await runner.claim(runnerScope, runnerOwner, "owner-mission-lease");
    assert.equal(ownerClaim?.id, ownerDelegated.mission.id);
    assert.equal(ownerClaim?.model, "opus");
    await runner.report(runnerScope, {
      missionId: ownerDelegated.mission.id,
      owner: runnerOwner,
      tokenHash: "owner-mission-lease",
      eventId: randomUUID(),
      kind: "completed",
      content: "Private mission result",
    });
    const ownerSourceAfterResult = await runtime.getConversationSnapshot({ ...ownerScope, conversationId: sourceConversationId });
    assert.equal(ownerSourceAfterResult.messages.some(({ content }) => content === "Private mission result"), false);
    const ownerMissionSnapshot = await runtime.getConversationSnapshot({ ...ownerScope, conversationId: ownerDelegated.conversationId });
    assert.equal(ownerMissionSnapshot.messages.some(({ content }) => content === "Private mission result"), true);

    await admin`insert into conversation_grants (organization_id, conversation_id, member_id)
      values (${organizationId}, ${sourceConversationId}, ${collaboratorId})`;
    const collaboratorParent = await enqueue(collaboratorScope, "Prepare my private project mission.");
    await runtime.setMissionRunning(organizationId, collaboratorParent.mission.id, collaboratorParent.mission.context);
    const collaboratorDispatchScope = await runtime.getHermesDispatchScope(organizationId, collaboratorParent.mission.id);
    assert.deepEqual(collaboratorDispatchScope?.targets, ownerDispatchScope?.targets);
    const collaboratorDelegation = delegatedInput(collaboratorParent.mission.id, collaboratorId, randomUUID());
    const collaboratorDelegated = await runtime.enqueueDelegatedRunnerMission(collaboratorDelegation);
    assert.notEqual(collaboratorDelegated.conversationId, sourceConversationId);
    const [collaboratorThread] = await admin<{ owner_member_id: string; project_id: string; parent_conversation_id: string }[]>`
      select owner_member_id, project_id, parent_conversation_id from conversations where id = ${collaboratorDelegated.conversationId}
    `;
    assert.deepEqual(collaboratorThread, {
      owner_member_id: collaboratorId,
      project_id: projectId,
      parent_conversation_id: sourceConversationId,
    });
    await assert.rejects(
      runtime.getConversationSnapshot({ ...ownerScope, conversationId: collaboratorDelegated.conversationId }),
      /not found or access denied/,
    );
    assert.ok(await runtime.getConversationSnapshot({ ...collaboratorScope, conversationId: collaboratorDelegated.conversationId }));
    const collaboratorClaim = await runner.claim(runnerScope, runnerOwner, "c".repeat(64));
    assert.equal(collaboratorClaim?.id, collaboratorDelegated.mission.id);
    const approvals = new MissionApprovalRepository(database);
    await approvals.requestFromRunner(runnerScope, {
      missionId: collaboratorDelegated.mission.id, owner: runnerOwner, tokenHash: "c".repeat(64), requestId: randomUUID(),
      action: { category: "pull_request.merge", target: "project repository", argumentsDigest: "a".repeat(64),
        summary: "Merge the reviewed pull request", expectedEffect: "Update the repository default branch." },
      reason: "The agent needs a human decision.", evidence: { command: "gh pr merge 1 --squash" },
      resume: { adapter: "claude", sessionId: "workspace-approval-session" },
    });
    const approvalSnapshot = await runtime.getConversationSnapshot({ ...collaboratorScope, conversationId: collaboratorDelegated.conversationId });
    const approval = approvalSnapshot.approvals[0]!;
    assert.equal(approval.canDecide, true);
    assert.equal(approval.route, "human");
    await assert.rejects(approvals.decideByMember({ ...ownerScope, approvalId: approval.id,
      decisionRequestId: randomUUID(), decision: "approved", rationale: "Project owner is not mission initiator." }));
    const decision = await approvals.decideByMember({ ...collaboratorScope, approvalId: approval.id,
      decisionRequestId: randomUUID(), decision: "approved", rationale: "Approve this exact request." });
    assert.equal(decision.status, "approved", "A collaborator can approve their mission on the project's authorized device.");
    const resumed = await runner.claim(runnerScope, runnerOwner, "d".repeat(64));
    assert.equal(resumed?.id, collaboratorDelegated.mission.id);
    const progressParent = await enqueue(collaboratorScope, "Keep a private progress lease.");
    await runtime.setMissionRunning(organizationId, progressParent.mission.id, progressParent.mission.context);
    const progressDelegated = await runtime.enqueueDelegatedRunnerMission(
      delegatedInput(progressParent.mission.id, collaboratorId, randomUUID(), progressDeviceId),
    );
    const progressLease = "p".repeat(64);
    assert.equal((await runner.claim(progressRunnerScope, runnerOwner, progressLease))?.id, progressDelegated.mission.id);
    const completionParent = await enqueue(collaboratorScope, "Keep a private completion lease.");
    await runtime.setMissionRunning(organizationId, completionParent.mission.id, completionParent.mission.context);
    const completionDelegated = await runtime.enqueueDelegatedRunnerMission(
      delegatedInput(completionParent.mission.id, collaboratorId, randomUUID(), completionDeviceId),
    );
    const completionLease = "f".repeat(64);
    assert.equal((await runner.claim(completionRunnerScope, runnerOwner, completionLease))?.id, completionDelegated.mission.id);
    const approvalParent = await enqueue(collaboratorScope, "Keep a private approval lease.");
    await runtime.setMissionRunning(organizationId, approvalParent.mission.id, approvalParent.mission.context);
    const approvalDelegated = await runtime.enqueueDelegatedRunnerMission(
      delegatedInput(approvalParent.mission.id, collaboratorId, randomUUID(), approvalDeviceId),
    );
    const approvalLease = "a".repeat(64);
    assert.equal((await runner.claim(approvalRunnerScope, runnerOwner, approvalLease))?.id, approvalDelegated.mission.id);
    await admin`delete from project_members where organization_id = ${organizationId} and project_id = ${projectId} and member_id = ${collaboratorId}`;
    assert.equal(await runtime.canProcessConversationMission(organizationId, collaboratorParent.mission.id), false);
    await assert.rejects(runner.renew(runnerScope, { missionId: collaboratorDelegated.mission.id,
      owner: runnerOwner, tokenHash: "d".repeat(64) }), /withdrawn/);
    const executionSnapshot = { version: 1 as const, provider: "claude" as const, revision: 1,
      rootThreadId: "workspace-private-thread", updatedAt: new Date().toISOString(), omittedItems: 0, items: [] };
    await assert.rejects(runner.execution(runnerScope, {
      missionId: collaboratorDelegated.mission.id, owner: runnerOwner, tokenHash: "d".repeat(64), snapshot: executionSnapshot,
    }), /withdrawn/);
    await assert.rejects(runner.report(progressRunnerScope, {
      missionId: progressDelegated.mission.id, owner: runnerOwner, tokenHash: progressLease,
      eventId: randomUUID(), kind: "progress", content: "This progress must be fenced.", snapshot: executionSnapshot,
    }), /withdrawn/);
    await assert.rejects(runner.report(completionRunnerScope, {
      missionId: completionDelegated.mission.id, owner: runnerOwner, tokenHash: completionLease,
      eventId: randomUUID(), kind: "completed", content: "This result must be fenced.",
    }), /withdrawn/);
    await assert.rejects(approvals.requestFromRunner(approvalRunnerScope, {
      missionId: approvalDelegated.mission.id, owner: runnerOwner, tokenHash: approvalLease, requestId: randomUUID(),
      action: { category: "pull_request.merge", target: "project repository", argumentsDigest: "b".repeat(64),
        summary: "Merge after access revocation", expectedEffect: "Update the repository default branch." },
      reason: "This request must not be persisted after revocation.", evidence: { command: "gh pr merge 1 --squash" },
      resume: { adapter: "claude", sessionId: "revoked-approval-session" },
    }), /withdrawn/);
    assert.equal((await runner.inspect(runnerScope, collaboratorDelegated.mission.id))?.status, "cancelled");
    assert.equal((await runner.inspect(progressRunnerScope, progressDelegated.mission.id))?.status, "cancelled");
    assert.equal((await runner.inspect(completionRunnerScope, completionDelegated.mission.id))?.status, "cancelled");
    assert.equal((await runner.inspect(approvalRunnerScope, approvalDelegated.mission.id))?.status, "cancelled");
    const [cancelledLeases] = await admin<{ count: string }[]>`
      select count(*) from missions where organization_id = ${organizationId}
        and id in (${collaboratorDelegated.mission.id}, ${progressDelegated.mission.id}, ${completionDelegated.mission.id}, ${approvalDelegated.mission.id})
        and status = 'cancelled' and lease_owner is null and lease_token_hash is null and lease_expires_at is null
    `;
    assert.equal(cancelledLeases?.count, "4");
    const [fencedEvents] = await admin<{ count: string }[]>`
      select count(*) from mission_events where organization_id = ${organizationId}
        and mission_id in (${collaboratorDelegated.mission.id}, ${progressDelegated.mission.id}, ${completionDelegated.mission.id})
        and type in ('runner.execution', 'runner.progress', 'run.completed')
    `;
    assert.equal(fencedEvents?.count, "0");
    const [fencedMessages] = await admin<{ count: string }[]>`
      select count(*) from messages where organization_id = ${organizationId}
        and content in ('This progress must be fenced.', 'This result must be fenced.')
    `;
    assert.equal(fencedMessages?.count, "0");
    const [fencedApprovals] = await admin<{ count: string }[]>`
      select count(*) from mission_approvals where organization_id = ${organizationId}
        and mission_id = ${approvalDelegated.mission.id}
    `;
    assert.equal(fencedApprovals?.count, "0");
    await admin`update missions set lease_expires_at = now() - interval '1 second' where id = ${collaboratorDelegated.mission.id}`;
    assert.equal(await runner.claim(runnerScope, runnerOwner, "revoked-lease"), null);
    assert.equal((await runtime.getMission(organizationId, collaboratorDelegated.mission.id))?.mission.status, "cancelled");

  } finally {
    await database.close();
    try {
      await admin`update conversations set mission_id = null where organization_id = ${organizationId}`;
      for (const table of [
        "mission_events",
        "mission_approvals",
        "missions",
        "messages",
        "conversation_grants",
        "conversations",
        "project_repositories",
        "project_members",
        "projects",
        "device_credentials",
        "devices",
        "members",
      ]) {
        await admin.unsafe(`delete from ${table} where organization_id = $1`, [organizationId]);
      }
      await admin`delete from organizations where id = ${organizationId}`;
    } finally {
      await admin.end();
    }
  }
});
