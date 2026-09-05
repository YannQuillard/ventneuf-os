import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import postgres from "postgres";
import { ConversationRuntimeRepository, createDatabase, DeviceRuntimeRepository, migrate, RunnerMissionRepository } from "@ventneuf/database";
import { createApp } from "../src/app.js";
import { createDeviceCredential } from "../src/device-auth.js";
import type { ConversationRuntime } from "../src/runtime.js";
import { RunnerCloudClient } from "../../runner/src/cloud-client.js";
import { RunnerMissionWorker } from "../../runner/src/mission-worker.js";
import { loadRepositories, RepositoryCheckAdapter } from "../../runner/src/repositories.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

test("browser API delivers a read-only mission through the real runner client and persists its result", { skip: !databaseUrl }, async () => {
  await migrate(databaseUrl!);
  const runtimeUrl = new URL(databaseUrl!);
  runtimeUrl.searchParams.set("options", "-c role=ventneuf_runtime");
  const database = createDatabase(runtimeUrl.toString());
  const admin = postgres(databaseUrl!, { max: 1, prepare: false });
  const organizationId = randomUUID();
  const memberId = randomUUID();
  const deviceId = randomUUID();
  const credential = createDeviceCredential(organizationId, deviceId);
  const device = { deviceId, credential: credential.token, name: "Integration Mac", platform: "darwin" as const };
  const repository = new ConversationRuntimeRepository(database);
  const temporary = await mkdtemp(join(tmpdir(), "runner-delivery-"));
  const runtime = { database, repository, devices: new DeviceRuntimeRepository(database),
    runnerMissions: new RunnerMissionRepository(database),
    queue: { publish: async () => { throw new Error("Runner mission must not enter the Hermes queue."); } },
  } as unknown as ConversationRuntime;
  const server = createServer(createApp({
    verifier: { verify: async (token) => token === "integration-user" ? {
      organizationId, principalId: "integration-subject", principalType: "user",
      projectIds: [], capabilities: ["mission:create", "hermes:ask", "device:manage"],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    } : token === "unprivileged-user" ? { organizationId, principalId: "integration-subject", principalType: "user",
      projectIds: [], capabilities: [], expiresAt: new Date(Date.now() + 60_000).toISOString(),
    } : undefined },
    hermes: { ask: async () => { throw new Error("Runner mission must not invoke Hermes."); } },
    conversations: runtime,
  }));
  try {
    await admin`insert into organizations (id, slug, name) values (${organizationId}, ${organizationId}, 'Delivery test')`;
    await admin`insert into members (id, organization_id, external_subject, handle, display_name)
      values (${memberId}, ${organizationId}, 'integration-subject', 'integration', 'Integration member')`;
    await admin`insert into devices (id, organization_id, member_id, name, platform)
      values (${deviceId}, ${organizationId}, ${memberId}, 'Integration Mac', 'darwin')`;
    await admin`insert into device_credentials (organization_id, device_id, token_hash)
      values (${organizationId}, ${deviceId}, ${credential.tokenHash})`;
    await mkdir(join(temporary, ".git"));
    const configuration = join(temporary, "repositories.json");
    await writeFile(configuration, JSON.stringify([{ id: "sample", name: "Sample", path: temporary }]));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const baseUrl = new URL(`http://127.0.0.1:${address.port}`);
    const cloud = new RunnerCloudClient(baseUrl);
    await cloud.registerRepositories(device, [{ id: "sample", name: "Sample" }]);
    const post = (path: string, body: unknown, token = "integration-user") => fetch(new URL(path, baseUrl), {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body),
    });
    assert.equal((await post("/api/missions/runner", { deviceId, repositoryId: "sample" }, "invalid")).status, 401);
    assert.equal((await post("/api/missions/runner", { deviceId, repositoryId: "sample" }, "unprivileged-user")).status, 403);
    assert.equal((await post("/api/missions/runner", { deviceId, repositoryId: "../outside" })).status, 400);
    assert.equal((await post("/api/missions/runner", { deviceId, repositoryId: "missing" })).status, 404);
    assert.equal((await post("/api/runner/missions/claim", { owner: randomUUID() })).status, 401);
    assert.equal((await post("/api/runner/repositories", { repositories: [{ id: "sample", name: "Sample", path: temporary }] }, credential.token)).status, 400);
    const accepted = await post("/api/missions/runner", { deviceId, repositoryId: "sample" });
    assert.equal(accepted.status, 202);
    const queued = await accepted.json() as { missionId: string };
    const worker = new RunnerMissionWorker({ client: cloud,
      store: { load: async () => device, save: async () => {} },
      repositories: () => loadRepositories(configuration),
      adapter: new RepositoryCheckAdapter(),
    });
    await worker.tick();
    const snapshotResponse = await fetch(new URL("/api/conversations/hermes/messages", baseUrl), {
      headers: { authorization: "Bearer integration-user" },
    });
    assert.equal(snapshotResponse.status, 200);
    const snapshot = await snapshotResponse.json() as {
      mission: { id: string; status: string }; messages: Array<{ content: string }>; events: Array<{ type: string }>;
    };
    assert.equal(snapshot.mission.id, queued.missionId);
    assert.equal(snapshot.mission.status, "completed");
    assert.match(snapshot.messages.at(-1)!.content, /Repository check completed for sample/);
    assert.ok(snapshot.events.some(({ type }) => type === "runner.progress"));
    assert.ok(snapshot.events.some(({ type }) => type === "run.completed"));
    assert.ok(!JSON.stringify(snapshot).includes(credential.token));
    assert.ok(!JSON.stringify(snapshot).includes(temporary));
    assert.equal((await post("/api/missions/runner", { deviceId, repositoryId: "sample", adapter: "orca-review" })).status, 404);
    await cloud.registerRepositories(device, [{ id: "sample", name: "Sample", orcaReview: true }]);
    assert.equal((await post("/api/missions/runner", { deviceId, repositoryId: "sample", adapter: "orca-review" })).status, 202);
    const owner = randomUUID();
    const review = await cloud.claimMission(device, owner);
    assert.equal(review?.adapter, "orca-review");
    assert.equal(review?.objective, "Review registered repository sample in read-only mode.");
    assert.ok(review);
    await assert.rejects(cloud.renewMission(device, review.id, { owner: randomUUID(), token: review.leaseToken }));
    assert.ok(Date.parse(await cloud.renewMission(device, review.id, { owner, token: review.leaseToken })) >= Date.parse(review.leaseExpiresAt));
    await repository.cancelMission(organizationId, review.id, {});
    await assert.rejects(cloud.renewMission(device, review.id, { owner, token: review.leaseToken }));
  } finally {
    await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); });
    for (const table of ["mission_events", "missions", "messages", "conversations", "device_credentials", "devices", "members"]) {
      await admin.unsafe(`delete from ${table} where organization_id = $1`, [organizationId]);
    }
    await admin`delete from organizations where id = ${organizationId}`;
    await database.close();
    await admin.end();
    await rm(temporary, { recursive: true, force: true });
  }
});
