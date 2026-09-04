import assert from "node:assert/strict";
import { test } from "node:test";
import postgres from "postgres";
import { createDatabase } from "../src/client.js";
import { DeviceRuntimeRepository } from "../src/devices.js";
import { migrate } from "../src/migrate.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

test("migrations enforce tenant integrity and row isolation", { skip: !databaseUrl }, async () => {
  await migrate(databaseUrl!);
  await migrate(databaseUrl!);

  const client = postgres(databaseUrl!, { max: 1, prepare: false });

  try {
    const [organizationA] = await client<{ id: string }[]>`
      insert into organizations (slug, name) values ('tenant-a', 'Tenant A') returning id
    `;
    const [organizationB] = await client<{ id: string }[]>`
      insert into organizations (slug, name) values ('tenant-b', 'Tenant B') returning id
    `;
    assert.ok(organizationA && organizationB);

    const [memberA] = await client<{ id: string }[]>`
      insert into members (organization_id, external_subject, handle, display_name)
      values (${organizationA.id}, 'subject-a', 'member-a', 'Member A') returning id
    `;
    const [memberB] = await client<{ id: string }[]>`
      insert into members (organization_id, external_subject, handle, display_name)
      values (${organizationB.id}, 'subject-b', 'member-b', 'Member B') returning id
    `;
    assert.ok(memberA && memberB);

    await assert.rejects(
      client`
        insert into conversations (organization_id, owner_member_id)
        values (${organizationA.id}, ${memberB.id})
      `,
      (error: unknown) =>
        typeof error === "object" && error !== null && "code" in error && error.code === "23503",
    );

    await client`
      insert into conversations (organization_id, owner_member_id, title)
      values
        (${organizationA.id}, ${memberA.id}, 'Visible conversation'),
        (${organizationB.id}, ${memberB.id}, 'Hidden conversation')
    `;

    const visibleConversations = await client.begin(async (transaction) => {
      await transaction.unsafe("set local role ventneuf_runtime");
      await transaction`select set_config('app.organization_id', ${organizationA.id}, true)`;
      return transaction<{ title: string }[]>`select title from conversations order by title`;
    });

    assert.equal(visibleConversations.length, 1);
    assert.equal(visibleConversations[0]?.title, "Visible conversation");

    const database = createDatabase(databaseUrl!);
    const devices = new DeviceRuntimeRepository(database);
    try {
      const now = new Date();
      await devices.createEnrollment({
        organizationId: organizationA.id,
        externalSubject: "subject-a",
        tokenHash: "enrollment-hash-a",
        expiresAt: new Date(now.getTime() + 60_000),
      });
      const enrolled = await devices.consumeEnrollment({
        organizationId: organizationA.id,
        tokenHash: "enrollment-hash-a",
        credentialHash: "credential-hash-a",
        deviceId: "00000000-0000-4000-8000-000000000101",
        name: "Test Mac",
        platform: "darwin",
        now,
      });
      assert.equal(enrolled?.name, "Test Mac");
      assert.equal(await devices.consumeEnrollment({
        organizationId: organizationA.id,
        tokenHash: "enrollment-hash-a",
        credentialHash: "credential-hash-b",
        deviceId: "00000000-0000-4000-8000-000000000102",
        name: "Duplicate Mac",
        platform: "darwin",
        now,
      }), undefined);

      const heartbeat = await devices.heartbeat({
        organizationId: organizationA.id,
        deviceId: enrolled!.id,
        credentialHash: "credential-hash-a",
        now: new Date(now.getTime() + 1_000),
      });
      assert.equal(heartbeat?.id, enrolled?.id);
      const memberDevices = await devices.listForMember({
        organizationId: organizationA.id,
        externalSubject: "subject-a",
      });
      assert.deepEqual(memberDevices.map(({ id }) => id), [enrolled!.id]);

      await client`update devices set revoked_at = now() where id = ${enrolled!.id}`;
      assert.equal(await devices.heartbeat({
        organizationId: organizationA.id,
        deviceId: enrolled!.id,
        credentialHash: "credential-hash-a",
        now: new Date(now.getTime() + 2_000),
      }), undefined);
    } finally {
      await database.close();
    }
  } finally {
    await client.end();
  }
});
