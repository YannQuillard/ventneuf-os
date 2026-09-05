import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { createDatabase } from "../src/client.js";
import { migrate } from "../src/migrate.js";
import { ConversationRuntimeRepository } from "../src/runtime.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

test("Hermes context ownership and terminal transitions under the runtime database role", { skip: !databaseUrl }, async () => {
  await migrate(databaseUrl!);
  const admin = postgres(databaseUrl!, { max: 1, prepare: false });
  const runtimeUrl = new URL(databaseUrl!);
  runtimeUrl.searchParams.set("options", "-c role=ventneuf_runtime");
  const database = createDatabase(runtimeUrl.toString());
  const repository = new ConversationRuntimeRepository(database);
  const organizationId = randomUUID();
  const otherOrganizationId = randomUUID();
  const owner = { organizationId, externalSubject: "owner", content: "Test" };
  try {
    await repository.ensureOrganization({ id: organizationId, slug: organizationId, name: "Hermes test" });
    await repository.ensureOrganization({ id: otherOrganizationId, slug: otherOrganizationId, name: "Other tenant" });
    const first = await repository.enqueuePrivateMessage(owner);
    await repository.completeMission({ organizationId, missionId: first.mission.id, conversationId: first.conversationId,
      contextId: "owned-context", content: "Reply", context: {} });
    assert.equal(await repository.setMissionRunning(organizationId, first.mission.id, {}), false);
    await repository.failMission(organizationId, first.mission.id, "Late failure", {});
    assert.equal((await repository.getMission(organizationId, first.mission.id))?.mission.status, "completed");
    for (const scope of [{ ...owner, externalSubject: "other" }, { ...owner, organizationId: otherOrganizationId }]) {
      await assert.rejects(repository.enqueuePrivateMessage({ ...scope, contextId: "owned-context" }), /context is unavailable/);
      assert.deepEqual(await repository.listPrivateMessages(scope), []);
    }
    await assert.rejects(repository.enqueuePrivateMessage({ ...owner, contextId: "unknown" }), /context is unavailable/);
    const own = await repository.enqueuePrivateMessage({ ...owner, contextId: "owned-context" });
    assert.equal(own.conversationId, first.conversationId);

    // Cancellation wins before either worker transition.
    await repository.cancelMission(organizationId, own.mission.id, { cancelledAt: "cancelled-first" });
    assert.equal(await repository.setMissionRunning(organizationId, own.mission.id, {}), false);
    await repository.rememberCancelledHermesRun(organizationId, own.mission.id, "late-run");
    await repository.failMission(organizationId, own.mission.id, "Stop failed", {});
    await repository.setMissionQueued(organizationId, own.mission.id, {});
    assert.equal(await repository.completeMission({ organizationId, missionId: own.mission.id,
      conversationId: own.conversationId, contextId: "wrong", content: "Must not persist", context: {} }), false);
    const cancelled = (await repository.getMission(organizationId, own.mission.id))!.mission;
    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.context.hermesRunId, "late-run");
    assert.equal(cancelled.context.cancelledAt, "cancelled-first");
    assert.equal((await repository.listPrivateMessages(owner)).some(({ content }) => content === "Must not persist"), false);

    // The run ID is committed after the route's read but before its cancellation update.
    const next = await repository.enqueuePrivateMessage(owner);
    await repository.setMissionRunning(organizationId, next.mission.id, { hermesRunId: "recorded-before-cancel" });
    const rows = await repository.cancelMission(organizationId, next.mission.id, next.mission.context);
    assert.equal(rows[0]?.context.hermesRunId, "recorded-before-cancel");
    assert.equal(await repository.setMissionRunning(organizationId, next.mission.id, {}), false);
    assert.deepEqual(await repository.cancelMission(otherOrganizationId, next.mission.id, {}), []);

    // Concurrent database connections exercise both updates contending for the row.
    for (let i = 0; i < 5; i++) {
      const race = await repository.enqueuePrivateMessage(owner);
      const [running, stopped] = await Promise.all([
        repository.setMissionRunning(organizationId, race.mission.id, { hermesRunId: "racing-run" }),
        repository.cancelMission(organizationId, race.mission.id, {}),
      ]);
      assert.equal(stopped.length, 1);
      if (running) assert.equal(stopped[0]?.context.hermesRunId, "racing-run");
      else await repository.rememberCancelledHermesRun(organizationId, race.mission.id, "racing-run");
      const record = (await repository.getMission(organizationId, race.mission.id))!.mission;
      assert.equal(record.status, "cancelled");
      assert.equal(record.context.hermesRunId, "racing-run");
    }
  } finally {
    await database.close();
    try {
      for (const table of ["mission_events", "missions", "messages", "conversations", "members"]) {
        await admin.unsafe(`delete from ${table} where organization_id in ($1, $2)`, [organizationId, otherOrganizationId]);
      }
      await admin`delete from organizations where id in (${organizationId}, ${otherOrganizationId})`;
    } finally {
      await admin.end();
    }
  }
});
