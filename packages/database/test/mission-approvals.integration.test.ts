import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { createDatabase } from "../src/client.js";
import {
  MissionApprovalConflictError,
  MissionApprovalRepository,
  MissionApprovalUnavailableError,
  type RunnerApprovalRequest,
} from "../src/mission-approvals.js";
import { migrate } from "../src/migrate.js";
import { RunnerLeaseError, RunnerMissionRepository } from "../src/runner-missions.js";
import { ConversationRuntimeRepository } from "../src/runtime.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

test("approval policy, escalation, resumption, expiry, and cancellation are durable", { skip: !databaseUrl }, async () => {
  await migrate(databaseUrl!);
  const client = postgres(databaseUrl!, { max: 1, prepare: false });
  const runtimeUrl = new URL(databaseUrl!);
  runtimeUrl.searchParams.set("options", "-c role=ventneuf_runtime");
  const database = createDatabase(runtimeUrl.toString());
  const conversations = new ConversationRuntimeRepository(database);
  const runner = new RunnerMissionRepository(database);
  const approvals = new MissionApprovalRepository(database);
  const organizationId = randomUUID();
  const memberId = randomUUID();
  const otherMemberId = randomUUID();
  const deviceId = randomUUID();
  const owner = randomUUID();
  const scope = { organizationId, deviceId, credentialHash: "approval-device-credential" };
  const authorityExpiry = new Date(Date.now() + 10 * 60_000).toISOString();

  const createClaimedMission = async (
    category: RunnerApprovalRequest["action"]["category"],
    policy: "allow" | "hermes" | "human",
  ) => {
    const queued = await conversations.enqueuePrivateMessage({
      organizationId,
      externalSubject: "approval-subject",
      content: `Exercise ${category}`,
      runner: { deviceId, repositoryId: "sample" },
    });
    const context = {
      ...queued.mission.context,
      agent: { adapter: "codex", profile: "default" },
      authority: { version: 1, expiresAt: authorityExpiry, actions: { [category]: policy } },
    };
    await client`update missions set context = ${client.json(context)} where id = ${queued.mission.id}`;
    const [stored] = await client<{ status: string; type: string; assigned_device_id: string }[]>`
      select status, context->>'type' as type, assigned_device_id from missions where id = ${queued.mission.id}
    `;
    assert.deepEqual(stored, {
      status: "queued",
      type: "runner.repository-check",
      assigned_device_id: deviceId,
    });
    const tokenHash = "b".repeat(64);
    const claimed = await runner.claim(scope, owner, tokenHash);
    assert.equal(claimed?.id, queued.mission.id);
    return { queued, tokenHash };
  };

  const request = (
    missionId: string,
    tokenHash: string,
    category: RunnerApprovalRequest["action"]["category"],
    requestId = randomUUID(),
  ): RunnerApprovalRequest => ({
    missionId,
    owner,
    tokenHash,
    requestId,
    action: {
      category,
      target: `${category}:sample`,
      argumentsDigest: "a".repeat(64),
      summary: `Authorize ${category}.`,
      expectedEffect: "The exact operation may change the assigned worktree or an external resource.",
    },
    reason: "The coding agent needs this operation to continue the mission.",
    evidence: { repositoryId: "sample", revision: "abc123" },
    resume: { adapter: "codex", sessionId: `session-${category.replaceAll(".", "-")}` },
  });

  const complete = async (missionId: string, tokenHash: string) => {
    await runner.report(scope, {
      missionId,
      owner,
      tokenHash,
      eventId: randomUUID(),
      kind: "completed",
      content: "Approval lifecycle completed.",
    });
  };

  try {
    await client`insert into organizations (id, slug, name) values (${organizationId}, ${organizationId}, 'Approval test')`;
    await client`insert into members (id, organization_id, external_subject, handle, display_name) values
      (${memberId}, ${organizationId}, 'approval-subject', 'approval', 'Approval member'),
      (${otherMemberId}, ${organizationId}, 'foreign-subject', 'foreign', 'Foreign member')`;
    await client`insert into devices (id, organization_id, member_id, name, platform, repositories) values
      (${deviceId}, ${organizationId}, ${memberId}, 'Approval device', 'darwin', '[{"id":"sample","name":"Sample"}]'::jsonb)`;
    await client`insert into device_credentials (organization_id, device_id, token_hash) values
      (${organizationId}, ${deviceId}, ${scope.credentialHash})`;

    const automaticMission = await createClaimedMission("development.command", "allow");
    const automaticRequest = request(
      automaticMission.queued.mission.id,
      automaticMission.tokenHash,
      "development.command",
    );
    const automatic = await approvals.requestFromRunner(scope, automaticRequest);
    assert.equal(automatic.approval.route, "automatic");
    assert.equal(automatic.approval.status, "approved");
    assert.equal(automatic.reviewMission, undefined);
    assert.equal((await approvals.requestFromRunner(scope, automaticRequest)).created, false);
    await assert.rejects(
      approvals.requestFromRunner(scope, {
        ...automaticRequest,
        reason: "A changed retry must not inherit the prior decision.",
      }),
      MissionApprovalConflictError,
    );
    await complete(automaticMission.queued.mission.id, automaticMission.tokenHash);

    const hermesMission = await createClaimedMission("network.access", "hermes");
    const hermesRequest = request(hermesMission.queued.mission.id, hermesMission.tokenHash, "network.access");
    const hermes = await approvals.requestFromRunner(scope, hermesRequest);
    assert.equal(hermes.approval.status, "pending");
    assert.equal(hermes.approval.route, "hermes");
    assert.ok(hermes.reviewMission);
    await assert.rejects(runner.renew(scope, {
      missionId: hermesMission.queued.mission.id,
      owner,
      tokenHash: hermesMission.tokenHash,
    }), RunnerLeaseError);
    assert.equal((await conversations.getLatestPrivateMission({
      organizationId,
      externalSubject: "approval-subject",
    }))?.id, hermesMission.queued.mission.id);
    const hermesScope = await approvals.getHermesDecisionScope(organizationId, hermes.reviewMission!.id);
    assert.deepEqual(hermesScope, {
      approvalId: hermes.approval.id,
      organizationId,
      parentMissionId: hermes.reviewMission!.id,
      conversationId: hermesMission.queued.conversationId,
      memberId,
    });
    await assert.rejects(approvals.decideByService({
      organizationId,
      serviceId: "hermes-supervisor",
      approvalId: hermes.approval.id,
      reviewMissionId: hermes.reviewMission!.id,
      conversationId: hermesMission.queued.conversationId,
      memberId: otherMemberId,
      decisionRequestId: randomUUID(),
      decision: "approved",
      rationale: "Foreign scope",
    }), MissionApprovalUnavailableError);
    const hermesDecisionId = randomUUID();
    const serviceDecision = {
      organizationId,
      serviceId: "hermes-supervisor",
      approvalId: hermes.approval.id,
      reviewMissionId: hermes.reviewMission!.id,
      conversationId: hermesMission.queued.conversationId,
      memberId,
      decisionRequestId: hermesDecisionId,
      decision: "approved" as const,
      rationale: "The network target is within the delegated mission scope.",
    };
    const [decided, duplicateDecision] = await Promise.all([
      approvals.decideByService(serviceDecision),
      approvals.decideByService(serviceDecision),
    ]);
    assert.equal(decided.status, "approved");
    assert.equal(duplicateDecision.status, "approved");
    await assert.rejects(approvals.decideByService({
      ...serviceDecision,
      decision: "rejected",
    }), MissionApprovalConflictError);
    const hermesResumeOwner = randomUUID();
    const resumedHermes = await runner.claim(scope, hermesResumeOwner, "fresh-hermes-lease");
    assert.equal(resumedHermes?.id, hermesMission.queued.mission.id);
    assert.deepEqual(resumedHermes?.approvalDecision, {
      id: hermes.approval.id,
      requestId: hermesRequest.requestId,
      status: "approved",
      action: hermesRequest.action,
      resume: hermesRequest.resume,
      rationale: serviceDecision.rationale,
    });
    await assert.rejects(complete(hermesMission.queued.mission.id, hermesMission.tokenHash), RunnerLeaseError);
    await runner.report(scope, {
      missionId: hermesMission.queued.mission.id,
      owner: hermesResumeOwner,
      tokenHash: "fresh-hermes-lease",
      eventId: randomUUID(),
      kind: "completed",
      content: "Hermes-approved mission resumed.",
    });

    const escalatedMission = await createClaimedMission("pull_request.merge", "hermes");
    const escalatedRequest = request(escalatedMission.queued.mission.id, escalatedMission.tokenHash, "pull_request.merge");
    const escalated = await approvals.requestFromRunner(scope, escalatedRequest);
    await assert.rejects(approvals.decideByService({
      organizationId,
      serviceId: "hermes-supervisor",
      approvalId: escalated.approval.id,
      reviewMissionId: escalated.reviewMission!.id,
      conversationId: escalatedMission.queued.conversationId,
      memberId,
      decisionRequestId: hermesDecisionId,
      decision: "escalated",
      rationale: "A reused decision ID must not affect another approval.",
    }), MissionApprovalConflictError);
    const escalatedByHermes = await approvals.decideByService({
      organizationId,
      serviceId: "hermes-supervisor",
      approvalId: escalated.approval.id,
      reviewMissionId: escalated.reviewMission!.id,
      conversationId: escalatedMission.queued.conversationId,
      memberId,
      decisionRequestId: randomUUID(),
      decision: "escalated",
      rationale: "Merge requires the initiating member's judgment.",
    });
    assert.equal(escalatedByHermes.route, "human");
    await assert.rejects(approvals.decideByMember({
      organizationId,
      externalSubject: "foreign-subject",
      approvalId: escalated.approval.id,
      decisionRequestId: randomUUID(),
      decision: "approved",
      rationale: "Foreign approval",
    }), MissionApprovalUnavailableError);
    const memberDecision = await approvals.decideByMember({
      organizationId,
      externalSubject: "approval-subject",
      approvalId: escalated.approval.id,
      decisionRequestId: randomUUID(),
      decision: "rejected",
      rationale: "Keep this pull request unmerged for review.",
    });
    assert.equal(memberDecision.status, "rejected");
    const rejectionOwner = randomUUID();
    const rejectedResume = await runner.claim(scope, rejectionOwner, "fresh-rejection-lease");
    assert.equal(rejectedResume?.approvalDecision?.status, "rejected");
    assert.equal(rejectedResume?.approvalDecision?.resume.sessionId, escalatedRequest.resume.sessionId);
    await runner.report(scope, {
      missionId: escalatedMission.queued.mission.id,
      owner: rejectionOwner,
      tokenHash: "fresh-rejection-lease",
      eventId: randomUUID(),
      kind: "completed",
      content: "The agent continued after the rejected operation.",
    });

    const expiringMission = await createClaimedMission("connector.write", "hermes");
    const expiringRequest = request(expiringMission.queued.mission.id, expiringMission.tokenHash, "connector.write");
    const expiring = await approvals.requestFromRunner(scope, expiringRequest);
    await client`update mission_approvals set expires_at = now() - interval '1 second' where id = ${expiring.approval.id}`;
    const expired = await approvals.decideByService({
      organizationId,
      serviceId: "hermes-supervisor",
      approvalId: expiring.approval.id,
      reviewMissionId: expiring.reviewMission!.id,
      conversationId: expiringMission.queued.conversationId,
      memberId,
      decisionRequestId: randomUUID(),
      decision: "approved",
      rationale: "This arrives after expiry.",
    });
    assert.equal(expired.status, "expired");
    const expiryOwner = randomUUID();
    const expiredResume = await runner.claim(scope, expiryOwner, "fresh-expiry-lease");
    assert.equal(expiredResume?.approvalDecision?.status, "expired");
    await runner.report(scope, {
      missionId: expiringMission.queued.mission.id,
      owner: expiryOwner,
      tokenHash: "fresh-expiry-lease",
      eventId: randomUUID(),
      kind: "completed",
      content: "The agent handled the expired operation.",
    });

    const revalidatedMission = await createClaimedMission("repository.write", "human");
    const revalidatedRequest = request(
      revalidatedMission.queued.mission.id,
      revalidatedMission.tokenHash,
      "repository.write",
    );
    const revalidated = await approvals.requestFromRunner(scope, revalidatedRequest);
    assert.equal((await approvals.decideByMember({
      organizationId,
      externalSubject: "approval-subject",
      approvalId: revalidated.approval.id,
      decisionRequestId: randomUUID(),
      decision: "approved",
      rationale: "Approve the exact worktree write.",
    })).status, "approved");
    await client`
      update missions
      set context = jsonb_set(context, '{authority,actions,repository.write}', '"deny"'::jsonb)
      where id = ${revalidatedMission.queued.mission.id}
    `;
    const revalidationOwner = randomUUID();
    const revalidatedResume = await runner.claim(scope, revalidationOwner, "revalidated-lease");
    assert.equal(revalidatedResume?.approvalDecision?.status, "expired");
    await runner.report(scope, {
      missionId: revalidatedMission.queued.mission.id,
      owner: revalidationOwner,
      tokenHash: "revalidated-lease",
      eventId: randomUUID(),
      kind: "completed",
      content: "The agent did not execute the invalidated write.",
    });

    const cancelledMission = await createClaimedMission("deployment.apply", "human");
    const cancelledRequest = request(cancelledMission.queued.mission.id, cancelledMission.tokenHash, "deployment.apply");
    const cancelled = await approvals.requestFromRunner(scope, cancelledRequest);
    await conversations.cancelMission(organizationId, cancelledMission.queued.mission.id, {});
    const visible = await approvals.listForMember({ organizationId, externalSubject: "approval-subject" });
    assert.equal(visible.find(({ id }) => id === cancelled.approval.id)?.status, "cancelled");
    assert.equal(await runner.claim(scope, randomUUID(), "cancelled-lease"), null);
    assert.ok((await conversations.listMissionEvents(organizationId, cancelledMission.queued.mission.id))
      .some(({ type }) => type === "approval.cancelled"));
  } finally {
    for (const table of [
      "mission_approvals",
      "mission_events",
      "missions",
      "messages",
      "conversations",
      "device_credentials",
      "devices",
      "members",
    ]) {
      await client.unsafe(`delete from ${table} where organization_id = $1`, [organizationId]);
    }
    await client`delete from organizations where id = ${organizationId}`;
    await database.close();
    await client.end();
  }
});
