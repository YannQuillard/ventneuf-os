import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { createDatabase } from "../src/client.js";
import { migrate } from "../src/migrate.js";
import { WorkspaceAccessError, WorkspaceRepository } from "../src/workspace.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

test("workspace projects and conversations require explicit tenant-scoped grants", { skip: !databaseUrl }, async () => {
  await migrate(databaseUrl!);
  const admin = postgres(databaseUrl!, { max: 1, prepare: false });
  const runtimeUrl = new URL(databaseUrl!);
  runtimeUrl.searchParams.set("options", "-c role=ventneuf_runtime");
  const database = createDatabase(runtimeUrl.toString());
  const workspace = new WorkspaceRepository(database);
  const organizationId = randomUUID();
  const otherOrganizationId = randomUUID();
  const ownerSubject = "workspace-owner";
  const collaboratorSubject = "workspace-collaborator";
  const otherSubject = "workspace-other";

  try {
    await admin`insert into organizations (id, slug, name) values
      (${organizationId}, ${organizationId}, 'Workspace tenant'),
      (${otherOrganizationId}, ${otherOrganizationId}, 'Other tenant')`;
    const [owner] = await admin<{ id: string }[]>`
      insert into members (organization_id, external_subject, handle, display_name)
      values (${organizationId}, ${ownerSubject}, 'owner', 'Owner') returning id
    `;
    const [collaborator] = await admin<{ id: string }[]>`
      insert into members (organization_id, external_subject, handle, display_name)
      values (${organizationId}, ${collaboratorSubject}, 'collaborator', 'Collaborator') returning id
    `;
    const [otherMember] = await admin<{ id: string }[]>`
      insert into members (organization_id, external_subject, handle, display_name)
      values (${otherOrganizationId}, ${otherSubject}, 'other', 'Other') returning id
    `;
    assert.ok(owner && collaborator && otherMember);

    const deviceId = randomUUID();
    await admin`
      insert into devices (id, organization_id, member_id, name, platform, repositories)
      values (${deviceId}, ${organizationId}, ${owner.id}, 'Owner Mac', 'darwin',
        ${JSON.stringify([{ id: 'repository-a', name: 'Repository A' }])}::jsonb)
    `;
    const collaboratorDeviceId = randomUUID();
    await admin`
      insert into devices (id, organization_id, member_id, name, platform, repositories)
      values (${collaboratorDeviceId}, ${organizationId}, ${collaborator.id}, 'Collaborator Mac', 'darwin',
        ${JSON.stringify([{ id: 'repository-b', name: 'Repository B' }])}::jsonb)
    `;

    const ownerScope = { organizationId, externalSubject: ownerSubject };
    const collaboratorScope = { organizationId, externalSubject: collaboratorSubject };
    const otherScope = { organizationId: otherOrganizationId, externalSubject: otherSubject };
    const project = await workspace.createProject(ownerScope, {
      name: "Private project",
      context: { purpose: "Validate privacy" },
      repositoryAssociations: [{ deviceId, repositoryId: "repository-a" }],
    });
    assert.equal(project.ownerMemberId, owner.id);
    assert.deepEqual(project.repositoryAssociations.map(({ deviceId: id, repositoryId }) => ({ id, repositoryId })), [{
      id: deviceId,
      repositoryId: "repository-a",
    }]);
    assert.deepEqual(await workspace.listProjects(collaboratorScope), []);
    await assert.rejects(
      workspace.shareProject(ownerScope, project.id, otherMember.id),
      WorkspaceAccessError,
    );

    await workspace.shareProject(ownerScope, project.id, collaborator.id);
    assert.deepEqual((await workspace.listProjects(collaboratorScope)).map(({ id }) => id), [project.id]);
    await assert.rejects(workspace.updateProject(ownerScope, project.id, {
      repositoryAssociations: [
        { deviceId, repositoryId: "repository-a" },
        { deviceId: collaboratorDeviceId, repositoryId: "repository-b" },
      ],
    }), WorkspaceAccessError);

    const ownerThread = await workspace.createConversation(ownerScope, {
      title: "Owner-only mission context",
      kind: "mission",
      projectId: project.id,
    });
    await admin`
      insert into messages (organization_id, conversation_id, member_id, role, content)
      values (${organizationId}, ${ownerThread.id}, ${owner.id}, 'user', 'Private project request')
    `;
    assert.deepEqual(await workspace.listConversations(collaboratorScope), []);
    await assert.rejects(workspace.getConversation(collaboratorScope, ownerThread.id), WorkspaceAccessError);
    await assert.rejects(workspace.listMessages(collaboratorScope, ownerThread.id), WorkspaceAccessError);

    await workspace.shareConversation(ownerScope, ownerThread.id, collaborator.id);
    assert.deepEqual((await workspace.listConversations(collaboratorScope)).map(({ id }) => id), [ownerThread.id]);
    assert.equal((await workspace.listMessages(collaboratorScope, ownerThread.id))[0]?.content, "Private project request");

    const privateSource = await workspace.createConversation(ownerScope, {
      title: "Private source",
      kind: "private",
    });
    const derivedTopic = await workspace.createConversation(ownerScope, {
      title: "Shared result without source",
      kind: "topic",
      parentConversationId: privateSource.id,
    });
    await workspace.shareConversation(ownerScope, derivedTopic.id, collaborator.id);
    assert.equal((await workspace.getConversation(collaboratorScope, derivedTopic.id)).parentConversationId, undefined);

    const collaboratorThread = await workspace.createConversation(collaboratorScope, {
      title: "Collaborator-only topic",
      kind: "topic",
      projectId: project.id,
      parentConversationId: ownerThread.id,
    });
    assert.equal((await workspace.listConversations(ownerScope)).some(({ id }) => id === collaboratorThread.id), false);
    await workspace.shareConversation(collaboratorScope, collaboratorThread.id, owner.id);
    const ownerConversationIds = (await workspace.listConversations(ownerScope)).map(({ id }) => id);
    assert.equal(ownerConversationIds.includes(ownerThread.id), true);
    assert.equal(ownerConversationIds.includes(collaboratorThread.id), true);

    await workspace.revokeProjectMember(ownerScope, project.id, collaborator.id);
    assert.deepEqual(await workspace.listProjects(collaboratorScope), []);
    assert.deepEqual(await workspace.listConversations(collaboratorScope), []);
    await assert.rejects(workspace.getConversation(collaboratorScope, ownerThread.id), WorkspaceAccessError);
    await assert.rejects(workspace.getConversation(collaboratorScope, collaboratorThread.id), WorkspaceAccessError);
    assert.equal((await workspace.listConversations(ownerScope)).some(({ id }) => id === ownerThread.id), true);

    assert.deepEqual(await workspace.listProjects(otherScope), []);
    assert.deepEqual(await workspace.listConversations(otherScope), []);
    await assert.rejects(workspace.getProject(otherScope, project.id), WorkspaceAccessError);
  } finally {
    await database.close();
    try {
      for (const table of [
        "conversation_grants",
        "messages",
        "conversations",
        "project_repositories",
        "project_members",
        "projects",
        "devices",
        "members",
      ]) {
        await admin.unsafe(`delete from ${table} where organization_id in ($1, $2)`, [organizationId, otherOrganizationId]);
      }
      await admin`delete from organizations where id in (${organizationId}, ${otherOrganizationId})`;
    } finally {
      await admin.end();
    }
  }
});
