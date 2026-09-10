import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { createDatabase } from "../src/client.js";
import { migrate } from "../src/migrate.js";
import { RunnerMissionRepository, RunnerLeaseError, RunnerAccessError } from "../src/runner-missions.js";
import { WorkspaceRepository, WorkspaceAccessError } from "../src/workspace.js";
import type { MissionHistoryEntry } from "@ventneuf/domain";
const databaseUrl = process.env.TEST_DATABASE_URL;

test("history is immutable, paginated, device scoped and available after completion", { skip: !databaseUrl }, async () => {
  await migrate(databaseUrl!);
  const admin = postgres(databaseUrl!, { max: 1 });
  const url = new URL(databaseUrl!); url.searchParams.set("options", "-c role=ventneuf_runtime");
  const database = createDatabase(url.toString());
  const runner = new RunnerMissionRepository(database);
  const workspace = new WorkspaceRepository(database);
  const org = randomUUID(), member = randomUUID(), device = randomUUID(), conversation = randomUUID(), mission = randomUUID();
  const scope = { organizationId: org, deviceId: device, credentialHash: "history-test" };
  const viewer = { organizationId: org, externalSubject: "history-member" };
  const entries: MissionHistoryEntry[] = Array.from({ length: 55 }, (_, index) => ({ id: randomUUID(), provider: "claude", sessionId: mission,
    occurredAt: new Date().toISOString(), item: { id: `tool-${index}`, threadId: mission, kind: "tool", label: "Read file", text: "output", status: "completed" } }));
  try {
    await admin`insert into organizations(id,slug,name) values(${org},${org},'History test')`;
    await admin`insert into members(id,organization_id,external_subject,handle,display_name) values(${member},${org},'history-member','history','History')`;
    await admin`insert into devices(id,organization_id,member_id,name,platform) values(${device},${org},${member},'Test','darwin')`;
    await admin`insert into device_credentials(organization_id,device_id,token_hash) values(${org},${device},'history-test')`;
    await admin`insert into conversations(id,organization_id,owner_member_id,kind) values(${conversation},${org},${member},'private')`;
    await admin`insert into missions(id,organization_id,conversation_id,requested_by_member_id,assigned_device_id,goal,status,attempts,context)
      values(${mission},${org},${conversation},${member},${device},'History test','completed',1,'{"type":"runner.claude-development"}')`;
    await assert.rejects(runner.history({ ...scope, credentialHash: "wrong" }, mission, entries.slice(0, 1)), RunnerAccessError);
    await assert.rejects(runner.history(scope, randomUUID(), entries.slice(0, 1)), RunnerLeaseError);
    await runner.history(scope, mission, entries.slice(0, 50));
    await runner.history(scope, mission, entries.slice(0, 50));
    await runner.history(scope, mission, entries.slice(50));
    await assert.rejects(runner.history(scope, mission, [{ ...entries[0]!, item: { ...entries[0]!.item, text: "changed" } }]), RunnerLeaseError);
    const first = await workspace.listMissionHistory(viewer, conversation, mission);
    assert.equal(first.items.length, 50); assert.equal(first.hasMore, true);
    const second = await workspace.listMissionHistory(viewer, conversation, mission, first.nextCursor);
    assert.equal(second.items.length, 5); assert.equal(second.hasMore, false);
    await assert.rejects(workspace.listMissionHistory({ ...viewer, externalSubject: "outsider" }, conversation, mission), WorkspaceAccessError);
    await assert.rejects(workspace.listMissionHistory(viewer, randomUUID(), mission), WorkspaceAccessError);
    await admin`update conversations set deleted_at=now() where id=${conversation}`;
    await assert.rejects(workspace.listMissionHistory(viewer, conversation, mission), WorkspaceAccessError);
    await assert.rejects(runner.history(scope, mission, entries.slice(0, 1)), RunnerLeaseError);
  } finally {
    await admin`delete from mission_history where organization_id=${org}`;
    await admin`delete from missions where organization_id=${org}`;
    await admin`delete from conversations where organization_id=${org}`;
    await admin`delete from device_credentials where organization_id=${org}`;
    await admin`delete from devices where organization_id=${org}`;
    await admin`delete from members where organization_id=${org}`;
    await admin`delete from organizations where id=${org}`;
    await database.close(); await admin.end();
  }
});
