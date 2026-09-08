import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { createDatabase } from "../src/client.js";
import { migrate } from "../src/migrate.js";
import {
  currentPersonalScope,
  currentScopeForConversation,
  currentScopeForMission,
  requireCurrentMissionMemoryScope,
  WorkspaceAccessError,
  WorkspaceMemoryFenceError,
  WorkspaceRepository,
} from "../src/workspace.js";

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
        ${JSON.stringify([
          { id: "repository-a", name: "Repository A", github: { owner: "shared", name: "repository" } },
          { id: "personal-repository", name: "Personal repository", github: { owner: "owner", name: "personal" } },
        ])}::jsonb)
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
    assert.deepEqual((await workspace.listDevices(ownerScope)).map(({ id }) => id), [deviceId]);
    assert.deepEqual((await workspace.listDevices(collaboratorScope)).map(({ id }) => id), [collaboratorDeviceId]);
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
    const collaboratorProjects = await workspace.listProjects(collaboratorScope);
    assert.deepEqual(collaboratorProjects.map(({ id }) => id), [project.id]);
    assert.equal(JSON.stringify(collaboratorProjects).includes("Personal repository"), false);
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
    assert.deepEqual((await workspace.listConversations(collaboratorScope)).map(({ id }) => id), [project.generalConversationId]);
    await assert.rejects(workspace.getConversation(collaboratorScope, ownerThread.id), WorkspaceAccessError);
    await assert.rejects(workspace.listMessages(collaboratorScope, ownerThread.id), WorkspaceAccessError);

    const ownerPersonalScope = await database.withOrganization(organizationId, (transaction) =>
      currentPersonalScope(transaction, ownerScope));
    const ownerPrivateScope = await database.withOrganization(organizationId, (transaction) =>
      currentScopeForConversation(transaction, ownerScope, ownerThread.id));
    assert.deepEqual(ownerPrivateScope.hermesMemoryScope, ownerPersonalScope);
    assert.match(ownerPersonalScope.scopeId, /^[0-9a-f]{64}$/);
    await assert.rejects(
      database.withOrganization(organizationId, (transaction) =>
        currentScopeForConversation(transaction, collaboratorScope, ownerThread.id)),
      WorkspaceAccessError,
    );
    await admin`update conversations set hermes_context_id = 'private-context' where id = ${ownerThread.id}`;

    await workspace.shareConversation(ownerScope, ownerThread.id, collaborator.id);
    assert.deepEqual((await workspace.listConversations(collaboratorScope)).map(({ id }) => id), [
      project.generalConversationId,
      ownerThread.id,
    ]);
    assert.equal((await workspace.listMessages(collaboratorScope, ownerThread.id))[0]?.content, "Private project request");
    const ownerSharedScope = await database.withOrganization(organizationId, (transaction) =>
      currentScopeForConversation(transaction, ownerScope, ownerThread.id));
    const collaboratorSharedScope = await database.withOrganization(organizationId, (transaction) =>
      currentScopeForConversation(transaction, collaboratorScope, ownerThread.id));
    assert.equal(ownerSharedScope.hermesMemoryScope.kind, "conversation");
    assert.deepEqual(ownerSharedScope.hermesMemoryScope, collaboratorSharedScope.hermesMemoryScope);
    assert.notEqual(ownerSharedScope.hermesMemoryScope.scopeId, ownerPersonalScope.scopeId);
    const [sharedConversation] = await admin<{ memoryEpoch: string; hermesContextId: string | null }[]>`
      select memory_epoch as "memoryEpoch", hermes_context_id as "hermesContextId"
      from conversations where id = ${ownerThread.id}
    `;
    assert.ok(sharedConversation?.memoryEpoch);
    assert.equal(sharedConversation?.hermesContextId, null);
    const [scopeMission] = await admin<{ id: string }[]>`
      insert into missions (organization_id, conversation_id, requested_by_member_id, goal)
      values (${organizationId}, ${ownerThread.id}, ${owner.id}, 'Fence shared Hermes output')
      returning id
    `;
    assert.ok(scopeMission);
    await database.withOrganization(organizationId, (transaction) => requireCurrentMissionMemoryScope(transaction, {
      organizationId,
      missionId: scopeMission.id,
      expectedScopeId: ownerSharedScope.hermesMemoryScope.scopeId,
    }));
    await admin`update conversations set hermes_context_id = 'shared-context' where id = ${ownerThread.id}`;
    await workspace.revokeConversationMember(ownerScope, ownerThread.id, collaborator.id);
    await assert.rejects(workspace.getConversation(collaboratorScope, ownerThread.id), WorkspaceAccessError);
    const ownerAfterConversationRevoke = await database.withOrganization(organizationId, (transaction) =>
      currentScopeForConversation(transaction, ownerScope, ownerThread.id));
    assert.equal(ownerAfterConversationRevoke.hermesMemoryScope.kind, "personal");
    assert.notEqual(ownerAfterConversationRevoke.memoryFence.memoryEpoch, ownerSharedScope.memoryFence.memoryEpoch);
    await assert.rejects(
      database.withOrganization(organizationId, (transaction) => requireCurrentMissionMemoryScope(transaction, {
        organizationId,
        missionId: scopeMission.id,
        expectedScopeId: ownerSharedScope.hermesMemoryScope.scopeId,
      })),
      WorkspaceMemoryFenceError,
    );
    await workspace.shareConversation(ownerScope, ownerThread.id, collaborator.id);
    const ownerSharedScopeBeforeProjectRevoke = await database.withOrganization(organizationId, (transaction) =>
      currentScopeForConversation(transaction, ownerScope, ownerThread.id));
    assert.equal(ownerSharedScopeBeforeProjectRevoke.hermesMemoryScope.kind, "conversation");

    const concurrentThread = await workspace.createConversation(ownerScope, {
      title: "Concurrent audience transitions",
      kind: "topic",
      projectId: project.id,
    });
    await workspace.shareConversation(ownerScope, concurrentThread.id, collaborator.id);
    const concurrentBefore = await database.withOrganization(organizationId, (transaction) =>
      currentScopeForConversation(transaction, ownerScope, concurrentThread.id));
    await admin`update conversations set hermes_context_id = 'concurrent-context' where id = ${concurrentThread.id}`;
    await Promise.all([
      workspace.revokeConversationMember(ownerScope, concurrentThread.id, collaborator.id),
      workspace.shareConversation(ownerScope, concurrentThread.id, collaborator.id),
    ]);
    const concurrentOwnerScope = await database.withOrganization(organizationId, (transaction) =>
      currentScopeForConversation(transaction, ownerScope, concurrentThread.id));
    const concurrentCollaboratorScope = await database.withOrganization(organizationId, (transaction) =>
      currentScopeForConversation(transaction, collaboratorScope, concurrentThread.id).catch((error: unknown) => error));
    assert.notEqual(concurrentOwnerScope.memoryFence.memoryEpoch, concurrentBefore.memoryFence.memoryEpoch);
    if (concurrentCollaboratorScope instanceof Error) {
      assert.ok(concurrentCollaboratorScope instanceof WorkspaceAccessError);
      assert.equal(concurrentOwnerScope.hermesMemoryScope.kind, "personal");
    } else {
      assert.deepEqual(concurrentOwnerScope.hermesMemoryScope, concurrentCollaboratorScope.hermesMemoryScope);
      assert.equal(concurrentOwnerScope.hermesMemoryScope.kind, "conversation");
    }

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
    const collaboratorPrivateProjectThread = await workspace.createConversation(collaboratorScope, {
      title: "Collaborator private project mission",
      kind: "mission",
      projectId: project.id,
    });
    const [collaboratorPrivateProjectMission] = await admin<{ id: string }[]>`
      insert into missions (organization_id, conversation_id, project_id, requested_by_member_id, goal)
      values (${organizationId}, ${collaboratorPrivateProjectThread.id}, ${project.id}, ${collaborator.id}, 'Private project work')
      returning id
    `;
    assert.ok(collaboratorPrivateProjectMission);
    const collaboratorPrivateMissionScope = await database.withOrganization(organizationId, (transaction) =>
      currentScopeForMission(transaction, collaboratorScope, collaboratorPrivateProjectMission.id));
    assert.equal(collaboratorPrivateMissionScope.hermesMemoryScope.kind, "personal");
    assert.equal((await workspace.listConversations(ownerScope)).some(({ id }) => id === collaboratorThread.id), false);
    await workspace.shareConversation(collaboratorScope, collaboratorThread.id, owner.id);
    const ownerConversationIds = (await workspace.listConversations(ownerScope)).map(({ id }) => id);
    assert.equal(ownerConversationIds.includes(ownerThread.id), true);
    assert.equal(ownerConversationIds.includes(collaboratorThread.id), true);

    await admin`update conversations set hermes_context_id = 'shared-context' where id = ${ownerThread.id}`;
    await workspace.revokeProjectMember(ownerScope, project.id, collaborator.id);
    assert.deepEqual(await workspace.listProjects(collaboratorScope), []);
    assert.deepEqual(
      (await workspace.listConversations(collaboratorScope)).map(({ id }) => id),
      [derivedTopic.id],
    );
    await assert.rejects(workspace.getConversation(collaboratorScope, ownerThread.id), WorkspaceAccessError);
    await assert.rejects(workspace.getConversation(collaboratorScope, collaboratorThread.id), WorkspaceAccessError);
    await assert.rejects(
      database.withOrganization(organizationId, (transaction) => requireCurrentMissionMemoryScope(transaction, {
        organizationId,
        missionId: collaboratorPrivateProjectMission.id,
        expectedScopeId: collaboratorPrivateMissionScope.hermesMemoryScope.scopeId,
      })),
      WorkspaceMemoryFenceError,
    );
    assert.equal((await workspace.listConversations(ownerScope)).some(({ id }) => id === ownerThread.id), true);
    const ownerAfterProjectRevoke = await database.withOrganization(organizationId, (transaction) =>
      currentScopeForConversation(transaction, ownerScope, ownerThread.id));
    assert.equal(ownerAfterProjectRevoke.hermesMemoryScope.kind, "personal");
    assert.deepEqual(ownerAfterProjectRevoke.hermesMemoryScope, ownerPersonalScope);
    assert.notEqual(ownerAfterProjectRevoke.memoryFence.memoryEpoch, ownerSharedScopeBeforeProjectRevoke.memoryFence.memoryEpoch);
    await assert.rejects(
      database.withOrganization(organizationId, (transaction) => requireCurrentMissionMemoryScope(transaction, {
        organizationId,
        missionId: scopeMission.id,
        expectedScopeId: ownerSharedScopeBeforeProjectRevoke.hermesMemoryScope.scopeId,
      })),
      WorkspaceMemoryFenceError,
    );
    const [projectRevokedConversation] = await admin<{ hermesContextId: string | null }[]>`
      select hermes_context_id as "hermesContextId" from conversations where id = ${ownerThread.id}
    `;
    assert.equal(projectRevokedConversation?.hermesContextId, null);

    assert.deepEqual(await workspace.listProjects(otherScope), []);
    assert.deepEqual(await workspace.listConversations(otherScope), []);
    await assert.rejects(workspace.getProject(otherScope, project.id), WorkspaceAccessError);
  } finally {
    await database.close();
    try {
      for (const table of [
        "conversation_grants",
        "messages",
        "missions",
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
