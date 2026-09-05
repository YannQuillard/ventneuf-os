import assert from "node:assert/strict";
import { test } from "node:test";
import { assertAuthorized, evaluateApprovalPolicy, type AuthorizationContext } from "../src/index.js";

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

test("evaluates bounded mission approval policy", () => {
  const now = new Date("2026-09-05T10:00:00.000Z");
  const authority = {
    version: 1 as const,
    expiresAt: "2026-09-06T10:00:00.000Z",
    actions: {
      "repository.write": "allow" as const,
      "network.access": "hermes" as const,
      "pull_request.merge": "human" as const,
      "deployment.apply": "deny" as const,
    },
  };

  assert.equal(evaluateApprovalPolicy(authority, "repository.write", now), "allow");
  assert.equal(evaluateApprovalPolicy(authority, "network.access", now), "hermes");
  assert.equal(evaluateApprovalPolicy(authority, "pull_request.merge", now), "human");
  assert.equal(evaluateApprovalPolicy(authority, "deployment.apply", now), "deny");
  assert.equal(evaluateApprovalPolicy(authority, "connector.write", now), "deny");
  assert.equal(evaluateApprovalPolicy({ ...authority, expiresAt: now.toISOString() }, "repository.write", now), "deny");
  assert.equal(evaluateApprovalPolicy({ version: 2 }, "repository.write", now), "deny");
});
