import assert from "node:assert/strict";
import test from "node:test";
import { buildSearchItems, SEARCH_ACTIONS } from "../app/prototype/_components/search-items";
import { prototypeData } from "../lib/prototype/fixtures";
import { buildNavigation, selectionFromPath } from "../lib/prototype/navigation";
import { conversationById, prototypeReducer, threadsForMessage } from "../lib/prototype/state";
import { recordsInPeriod, usageRows } from "../lib/prototype/usage";

const at = "2026-09-05T14:45:00.000Z";

test("creating a temporary conversation isolates it from durable knowledge and keeping it converts it", () => {
  const created = prototypeReducer(prototypeData, { type: "createConversation", conversationId: "conv-x", title: "", isTemporary: true, at });
  const conversation = conversationById(created, "conv-x");
  assert.equal(conversation?.kind, "temporary");
  assert.equal(conversation?.knowledgeScope, "none");
  assert.ok(conversation?.expiresAt);
  assert.equal(created.entries["conv-x"]?.[0]?.kind, "system");

  const kept = prototypeReducer(created, { type: "keepConversation", conversationId: "conv-x", at });
  assert.equal(conversationById(kept, "conv-x")?.kind, "personal");
  assert.equal(conversationById(kept, "conv-x")?.knowledgeScope, "personal");
  assert.equal(conversationById(kept, "conv-x")?.expiresAt, undefined);
  assert.equal(prototypeReducer(kept, { type: "keepConversation", conversationId: "conv-x", at }), kept);
});

test("starting a thread snapshots the source message and links the thread back to it", () => {
  const next = prototypeReducer(prototypeData, {
    type: "startThread",
    threadId: "thread-x",
    conversationId: "ch-ventneuf",
    messageId: "c8",
    title: "",
    at,
  });
  const thread = conversationById(next, "thread-x");
  const entries = next.entries["thread-x"] ?? [];
  const source = (next.entries["ch-ventneuf"] ?? []).find((entry) => entry.id === "c8");

  assert.equal(thread?.kind, "thread");
  assert.equal(thread?.parentId, "ch-ventneuf");
  assert.equal(thread?.projectId, "ventneuf-os");
  assert.equal(thread?.knowledgeScope, "project");
  assert.ok((thread?.title.length ?? 0) > 0);
  assert.equal(entries[0]?.kind, "system");
  assert.equal(entries[1]?.kind, "snapshot");
  assert.equal(entries[1]?.kind === "snapshot" ? entries[1].authorName : undefined, "Hermes");
  assert.equal(source?.kind === "message" ? source.threadId : undefined, "thread-x");
  assert.equal(threadsForMessage(next, "c8")[0]?.id, "thread-x");
  assert.equal(prototypeReducer(next, { type: "startThread", threadId: "thread-x", conversationId: "ch-ventneuf", messageId: "c8", title: "", at }), next);
});

test("archiving hides a conversation from navigation but keeps it searchable", () => {
  const next = prototypeReducer(prototypeData, { type: "archiveConversation", conversationId: "conv-week", at });
  const personal = buildNavigation(next, "hermes").find(({ id }) => id === "personal");
  assert.ok(!personal?.entries.some(({ id }) => id === "conv-week"));
  assert.ok(buildSearchItems(next).some(({ id, auxiliaryData }) => id === "conversation:conv-week" && auxiliaryData.detail?.includes("Archived")));
  assert.equal(prototypeReducer(prototypeData, { type: "archiveConversation", conversationId: "hermes", at }), prototypeData);
});

test("device capabilities, enrolment, and revocation update the device registry", () => {
  const toggled = prototypeReducer(prototypeData, { type: "setDeviceCapability", deviceId: "dev-studio", repositoryId: "repo-infra", capability: "review", enabled: true });
  const infra = toggled.devices.find(({ id }) => id === "dev-studio")?.repositories.find(({ repositoryId }) => repositoryId === "repo-infra");
  assert.equal(infra?.capabilities.review, true);

  const enrolled = prototypeReducer(toggled, { type: "enrollDevice", deviceId: "dev-new", name: "This Mac", platform: "macOS", at });
  const device = enrolled.devices.find(({ id }) => id === "dev-new");
  assert.equal(device?.isOnline, true);
  assert.equal(device?.ownerId, "mem-ada");
  assert.deepEqual(device?.repositories, []);

  const revoked = prototypeReducer(enrolled, { type: "revokeDevice", deviceId: "dev-new", at });
  assert.equal(revoked.devices.find(({ id }) => id === "dev-new")?.isRevoked, true);
  assert.equal(revoked.devices.find(({ id }) => id === "dev-new")?.isOnline, false);
});

test("connectors can be authorised and scoped to projects", () => {
  const connected = prototypeReducer(prototypeData, { type: "connectConnector", connectorId: "conn-cloudflare", at });
  assert.equal(connected.connectors.find(({ id }) => id === "conn-cloudflare")?.status, "connected");
  const granted = prototypeReducer(connected, { type: "setConnectorProjectAccess", connectorId: "conn-cloudflare", projectId: "ampel", enabled: true });
  assert.deepEqual(granted.connectors.find(({ id }) => id === "conn-cloudflare")?.projectIds, ["brandstamp", "ampel"]);
  const removed = prototypeReducer(granted, { type: "setConnectorProjectAccess", connectorId: "conn-cloudflare", projectId: "brandstamp", enabled: false });
  assert.deepEqual(removed.connectors.find(({ id }) => id === "conn-cloudflare")?.projectIds, ["ampel"]);
});

test("usage aggregates by period and grouping with consistent totals", () => {
  const week = recordsInPeriod(prototypeData.usage, "7d", prototypeData.now);
  const month = recordsInPeriod(prototypeData.usage, "30d", prototypeData.now);
  assert.ok(week.length < month.length);

  const byMission = usageRows(prototypeData, { period: "30d", group: "mission" });
  const byAgent = usageRows(prototypeData, { period: "30d", group: "agent" });
  assert.equal(byMission.totals.costUsd, byAgent.totals.costUsd);
  assert.equal(byMission.totals.inputTokens, byAgent.totals.inputTokens);
  assert.deepEqual(byAgent.rows.map(({ key }) => key).sort(), ["claude", "codex", "hermes"]);
  assert.ok(byMission.rows.some(({ key }) => key === "conversations"));
  assert.ok(byMission.rows[0].costUsd >= byMission.rows[byMission.rows.length - 1].costUsd);

  const byProject = usageRows(prototypeData, { period: "90d", group: "project" });
  assert.ok(byProject.rows.some(({ key }) => key === "personal"));
  assert.equal(byProject.totals.missions, new Set(recordsInPeriod(prototypeData.usage, "90d", prototypeData.now).flatMap((record) => record.missionId ? [record.missionId] : [])).size);
});

test("navigation exposes the workspace group and path selection covers every route", () => {
  const groups = buildNavigation(prototypeData, "devices");
  const workspace = groups.find(({ id }) => id === "workspace");
  assert.deepEqual(workspace?.entries.map(({ id }) => id), ["devices", "usage"]);
  assert.equal(workspace?.entries[0]?.isSelected, true);
  assert.equal(workspace?.entries[0]?.status, "running");

  assert.equal(selectionFromPath("/prototype/c/thread-retention"), "thread-retention");
  assert.equal(selectionFromPath("/prototype/p/ampel"), "project:ampel");
  assert.equal(selectionFromPath("/prototype/devices"), "devices");
  assert.equal(selectionFromPath("/prototype/usage"), "usage");
  assert.equal(selectionFromPath("/prototype"), undefined);
  const projects = buildNavigation(prototypeData, "project:ampel").find(({ id }) => id === "projects");
  assert.equal(projects?.entries.find(({ id }) => id === "ampel")?.isSelected, true);
});

test("search lists actions first and covers projects, knowledge, and devices", () => {
  const items = buildSearchItems(prototypeData);
  assert.equal(items[0]?.id, SEARCH_ACTIONS.newConversation);
  assert.equal(items[1]?.id, SEARCH_ACTIONS.newTemporaryConversation);
  const groups = new Set(items.map(({ auxiliaryData }) => auxiliaryData.group));
  for (const group of ["Actions", "Conversations", "Threads", "Channels", "Projects", "Missions", "Pending approvals", "Changed files", "Knowledge", "Devices"]) {
    assert.ok(groups.has(group), group);
  }
  assert.ok(items.some(({ id }) => id === "conversation:conv-archived"));
});

test("new fixtures reference existing repositories, projects, missions, and sources", () => {
  const projectIds = new Set(prototypeData.projects.map(({ id }) => id));
  const repositoryIds = new Set(prototypeData.repositories.map(({ id }) => id));
  const missionIds = new Set(prototypeData.missions.map(({ id }) => id));
  const sourceIds = new Set(prototypeData.knowledgeSources.map(({ id }) => id));
  const memberIds = new Set(prototypeData.members.map(({ id }) => id));

  for (const repository of prototypeData.repositories) assert.ok(projectIds.has(repository.projectId), repository.id);
  for (const device of prototypeData.devices) {
    assert.ok(memberIds.has(device.ownerId), device.id);
    for (const assignment of device.repositories) assert.ok(repositoryIds.has(assignment.repositoryId), `${device.id} ${assignment.repositoryId}`);
  }
  for (const connector of prototypeData.connectors) {
    assert.ok(memberIds.has(connector.ownerId), connector.id);
    for (const projectId of connector.projectIds) assert.ok(projectIds.has(projectId), `${connector.id} ${projectId}`);
  }
  for (const note of prototypeData.knowledgeNotes) assert.ok(sourceIds.has(note.sourceId), note.id);
  for (const record of prototypeData.usage) {
    if (record.missionId) assert.ok(missionIds.has(record.missionId), record.id);
    if (record.projectId) assert.ok(projectIds.has(record.projectId), record.id);
    assert.match(record.date, /^\d{4}-\d{2}-\d{2}$/);
  }
  for (const conversation of prototypeData.conversations) {
    if (!conversation.sourceMessageId || !conversation.parentId) continue;
    const source = (prototypeData.entries[conversation.parentId] ?? []).find(({ id }) => id === conversation.sourceMessageId);
    assert.equal(source?.kind === "message" ? source.threadId : undefined, conversation.id, `${conversation.id} provenance`);
  }
});
