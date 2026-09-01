import assert from "node:assert/strict";
import { test } from "node:test";
import postgres from "postgres";
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
  } finally {
    await client.end();
  }
});
