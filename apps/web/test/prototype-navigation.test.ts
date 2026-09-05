import assert from "node:assert/strict";
import test from "node:test";
import { prototypeData } from "../lib/prototype/fixtures";
import {
  buildNavigation,
  conversationHref,
  conversationTrail,
  missionHref,
  RECENT_CONVERSATION_LIMIT,
  recentPersonalConversations,
} from "../lib/prototype/navigation";
import { prototypeReducer } from "../lib/prototype/state";

function entriesOf(groupId: "personal" | "projects", selectedId?: string) {
  const group = buildNavigation(prototypeData, selectedId).find(({ id }) => id === groupId);
  assert.ok(group);
  return group.entries;
}

test("the personal group leads with the main Hermes conversation and caps recent conversations", () => {
  const entries = entriesOf("personal", "hermes");
  assert.equal(entries[0]?.kind, "main");
  assert.equal(entries[0]?.isSelected, true);
  const recent = entries.filter(({ kind }) => kind === "conversation" || kind === "temporary");
  assert.equal(recent.length, RECENT_CONVERSATION_LIMIT);
  assert.ok(!recent.some(({ id }) => id === "conv-retro"), "oldest conversation is left to search");
  assert.equal(recentPersonalConversations(prototypeData).length, RECENT_CONVERSATION_LIMIT);
});

test("threads appear under their parent only when active, pinned, or recently visited", () => {
  const ventneuf = entriesOf("projects").find(({ id }) => id === "ventneuf-os");
  assert.ok(ventneuf);
  const threadIds = ventneuf.children.filter(({ kind }) => kind === "thread").map(({ id }) => id);
  assert.deepEqual(threadIds, ["thread-retention", "thread-expiry", "thread-cleanup"]);

  const withConnectors = entriesOf("projects", "thread-connectors").find(({ id }) => id === "ventneuf-os");
  assert.ok(withConnectors?.children.some(({ id, isSelected }) => id === "thread-connectors" && isSelected));

  const pinned = entriesOf("personal")[0];
  assert.ok(pinned.children.some(({ id }) => id === "thread-vault"));
});

test("visiting a hidden thread makes it appear in the sidebar", () => {
  const visited = prototypeReducer(prototypeData, {
    type: "visitConversation",
    conversationId: "thread-connectors",
    at: prototypeData.now,
  });
  const ventneuf = buildNavigation(visited, "hermes").find(({ id }) => id === "projects")?.entries.find(({ id }) => id === "ventneuf-os");
  assert.ok(ventneuf?.children.some(({ id }) => id === "thread-connectors"));
});

test("threads with active missions carry a status and escalated approvals demand attention", () => {
  const ventneuf = entriesOf("projects").find(({ id }) => id === "ventneuf-os");
  const retention = ventneuf?.children.find(({ id }) => id === "thread-retention");
  const expiry = ventneuf?.children.find(({ id }) => id === "thread-expiry");
  const ampel = entriesOf("projects").find(({ id }) => id === "ampel");
  const sentry = ampel?.children.find(({ id }) => id === "thread-sentry");

  assert.equal(retention?.status, "attention");
  assert.equal(expiry?.status, undefined);
  assert.equal(sentry?.status, "running");
});

test("hrefs and trails follow the conversation hierarchy", () => {
  assert.equal(conversationHref("thread-retention"), "/prototype/c/thread-retention");
  assert.equal(missionHref("thread-retention", "m-retention"), "/prototype/c/thread-retention?mission=m-retention");
  assert.equal(missionHref("thread-retention", "m-retention", "changes"), "/prototype/c/thread-retention?mission=m-retention&tab=changes");
  const thread = prototypeData.conversations.find(({ id }) => id === "thread-retention");
  assert.ok(thread);
  assert.deepEqual(conversationTrail(prototypeData, thread).map(({ id }) => id), ["ch-ventneuf", "thread-retention"]);
});
