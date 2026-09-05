import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { createDatabase } from "../src/client.js";
import { migrate } from "../src/migrate.js";
import { ConversationRuntimeRepository, RunnerAssignmentError } from "../src/runtime.js";
import { RunnerAccessError, RunnerLeaseError, RunnerMissionRepository } from "../src/runner-missions.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

test("runner assignment, concurrent claims, fenced retries, cancellation and tenant isolation", { skip: !databaseUrl }, async () => {
  await migrate(databaseUrl!);
  const client = postgres(databaseUrl!, { max: 1, prepare: false });
  const runtimeUrl = new URL(databaseUrl!);
  runtimeUrl.searchParams.set("options", "-c role=ventneuf_runtime");
  const database = createDatabase(runtimeUrl.toString());
  const runner = new RunnerMissionRepository(database);
  const conversations = new ConversationRuntimeRepository(database);
  const organizationId = randomUUID();
  const otherOrganizationId = randomUUID();
  const memberId = randomUUID();
  const otherMemberId = randomUUID();
  const deviceId = randomUUID();
  const otherDeviceId = randomUUID();
  const scope = { organizationId, deviceId, credentialHash: "runner-test-hash" };
  const owner = randomUUID();
  const enqueue = () => conversations.enqueuePrivateMessage({ organizationId, externalSubject: "runner-subject",
    content: "Check the repository", runner: { deviceId, repositoryId: "sample" } });
  const expire = (id: string) => client`update missions set lease_expires_at = now() - interval '1 second' where id = ${id}`;
  try {
    await client`insert into organizations (id, slug, name) values
      (${organizationId}, ${organizationId}, 'Runner test'), (${otherOrganizationId}, ${otherOrganizationId}, 'Other tenant')`;
    await client`insert into members (id, organization_id, external_subject, handle, display_name) values
      (${memberId}, ${organizationId}, 'runner-subject', 'runner', 'Runner member'),
      (${otherMemberId}, ${organizationId}, 'other-subject', 'other', 'Other member')`;
    await client`insert into devices (id, organization_id, member_id, name, platform) values
      (${deviceId}, ${organizationId}, ${memberId}, 'Test device', 'darwin'),
      (${otherDeviceId}, ${organizationId}, ${otherMemberId}, 'Other device', 'darwin')`;
    await client`insert into device_credentials (organization_id, device_id, token_hash) values
      (${organizationId}, ${deviceId}, 'runner-test-hash'), (${organizationId}, ${otherDeviceId}, 'other-runner-test-hash')`;
    await runner.register(scope, [{ id: "sample", name: "Sample" }]);
    await assert.rejects(runner.register({ ...scope, credentialHash: "wrong" }, []), RunnerAccessError);
    await assert.rejects(runner.claim({ ...scope, organizationId: otherOrganizationId }, owner, "hash"), RunnerAccessError);
    await assert.rejects(conversations.enqueuePrivateMessage({ organizationId, externalSubject: "other-subject",
      content: "Forbidden", runner: { deviceId, repositoryId: "sample" } }), RunnerAssignmentError);
    await assert.rejects(conversations.enqueuePrivateMessage({ organizationId, externalSubject: "runner-subject",
      content: "Forbidden", runner: { deviceId, repositoryId: "missing" } }), RunnerAssignmentError);
    const queued = await enqueue();
    assert.equal(queued.mission.assignedDeviceId, deviceId);
    assert.equal(await runner.claim({ ...scope, deviceId: otherDeviceId, credentialHash: "other-runner-test-hash" }, owner, "hash"), null);
    const claims = await Promise.all([runner.claim(scope, owner, "lease-one"), runner.claim(scope, owner, "lease-one")]);
    assert.equal(claims.filter(Boolean).length, 1);
    const claimed = claims.find(Boolean)!;
    assert.equal(claimed.id, queued.mission.id);
    assert.equal(claimed.attempt, 1);
    const progress = { missionId: claimed.id, owner, tokenHash: "lease-one", eventId: randomUUID(), kind: "progress" as const, content: "Checking" };
    await assert.rejects(runner.report(scope, { ...progress, owner: randomUUID() }), RunnerLeaseError);
    await assert.rejects(runner.report(scope, { ...progress, tokenHash: "wrong" }), RunnerLeaseError);
    await runner.report(scope, progress);
    await runner.report(scope, progress);
    assert.equal((await conversations.listMissionEvents(organizationId, claimed.id)).filter(({ id }) => id === progress.eventId).length, 1);
    await assert.rejects(runner.report(scope, { ...progress, content: "Changed" }), RunnerLeaseError);
    await expire(claimed.id);
    await assert.rejects(runner.report(scope, { ...progress, eventId: randomUUID() }), RunnerLeaseError);
    const recovered = await runner.claim(scope, owner, "lease-two");
    assert.equal(recovered?.attempt, 2);
    await assert.rejects(runner.report(scope, progress), RunnerLeaseError);
    const completion = { ...progress, tokenHash: "lease-two", eventId: randomUUID(), kind: "completed" as const, content: "Durable result" };
    await runner.report(scope, completion);
    await runner.report(scope, completion);
    assert.equal((await conversations.listPrivateMessages({ organizationId, externalSubject: "runner-subject" }))
      .filter(({ content }) => content === "Durable result").length, 1);
    assert.equal(await runner.claim(scope, owner, "unused"), null);

    const cancelled = await enqueue();
    await runner.claim(scope, owner, "cancel-lease");
    await conversations.cancelMission(organizationId, cancelled.mission.id, cancelled.mission.context);
    assert.ok((await conversations.listMissionEvents(organizationId, cancelled.mission.id)).some(({ type }) => type === "run.cancelled"));
    await assert.rejects(runner.report(scope, { ...completion, missionId: cancelled.mission.id, tokenHash: "cancel-lease", eventId: randomUUID() }), RunnerLeaseError);

    const exhausted = await enqueue();
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      assert.equal((await runner.claim(scope, owner, `lease-${attempt}`))?.attempt, attempt);
      await expire(exhausted.mission.id);
    }
    assert.equal(await runner.claim(scope, owner, "fourth"), null);
    assert.equal((await conversations.getMission(organizationId, exhausted.mission.id))?.mission.status, "failed");
    assert.ok((await conversations.listMissionEvents(organizationId, exhausted.mission.id)).some(({ type }) => type === "run.failed"));
    const revoked = await enqueue();
    await runner.claim(scope, owner, "revoked-lease");
    await client`update devices set revoked_at = now() where id = ${deviceId}`;
    await assert.rejects(runner.report(scope, { ...completion, missionId: revoked.mission.id, tokenHash: "revoked-lease" }), RunnerAccessError);
    await assert.rejects(enqueue(), RunnerAssignmentError);
  } finally {
    for (const table of ["mission_events", "missions", "messages", "conversations", "device_credentials", "devices", "members"]) {
      await client.unsafe(`delete from ${table} where organization_id = $1`, [organizationId]);
    }
    await client`delete from organizations where id in (${organizationId}, ${otherOrganizationId})`;
    await database.close();
    await client.end();
  }
});
