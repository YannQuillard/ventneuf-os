import assert from "node:assert/strict";
import { test } from "node:test";
import { assertAuthorized, type AuthorizationContext } from "../src/index.js";

const context: AuthorizationContext = {
  organizationId: "org-1",
  principalId: "user-1",
  principalType: "user",
  projectIds: ["project-1"],
  capabilities: ["system:identity:read", "hermes:ask"],
  expiresAt: "2030-01-01T00:00:00.000Z",
};

test("accepts an active granted capability", () => {
  assert.doesNotThrow(() => assertAuthorized(context, "hermes:ask", new Date("2029-01-01")));
});

test("rejects missing capabilities", () => {
  assert.throws(
    () => assertAuthorized(context, "mission:progress:write", new Date("2029-01-01")),
    /Missing capability/,
  );
});

test("rejects expired contexts", () => {
  assert.throws(
    () => assertAuthorized(context, "hermes:ask", new Date("2031-01-01")),
    /expired/,
  );
});
