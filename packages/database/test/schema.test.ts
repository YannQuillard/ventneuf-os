import assert from "node:assert/strict";
import { test } from "node:test";
import { channels, conversations, members, messages, missionEvents, missions, organizations } from "../src/schema.js";
import { splitMigration } from "../src/migrate.js";

test("exports the initial multi-tenant conversation schema", () => {
  assert.ok(organizations);
  assert.ok(members);
  assert.ok(channels);
  assert.ok(conversations);
  assert.ok(messages);
  assert.ok(missions);
  assert.ok(missionEvents);
});

test("splits versioned SQL migrations into executable statements", () => {
  assert.deepEqual(splitMigration("select 1;--> statement-breakpoint\nselect 2;"), [
    "select 1;",
    "select 2;",
  ]);
});
