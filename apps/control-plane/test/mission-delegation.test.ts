import assert from "node:assert/strict";
import test from "node:test";
import { StaticTokenProvider } from "../src/hermes.js";
import { InvalidMissionDelegationError, MissionDelegation } from "../src/mission-delegation.js";

const input = {
  serviceId: "hermes-supervisor",
  organizationId: "00000000-0000-4000-8000-000000000001",
  parentMissionId: "00000000-0000-4000-8000-000000000002",
  conversationId: "00000000-0000-4000-8000-000000000003",
  memberId: "00000000-0000-4000-8000-000000000004",
  targets: [{
    deviceId: "00000000-0000-4000-8000-000000000005",
    repositoryId: "ventneuf-os",
    adapters: ["repository-check" as const, "orca-review" as const],
  }],
};

test("issues and verifies a short parent-scoped mission delegation", async () => {
  const delegations = new MissionDelegation(new StaticTokenProvider("a".repeat(32)), 60_000);
  const now = new Date("2026-09-05T12:00:00.000Z");
  const grant = await delegations.issue(input, now);
  assert.match(grant.token, /^vnd1\./);
  assert.deepEqual(await delegations.verify(grant.token, new Date(now.getTime() + 30_000)), grant.claims);
  assert.equal(grant.claims.capabilities[0], "mission:dispatch");
  assert.equal(grant.claims.expiresAt, "2026-09-05T12:01:00.000Z");
});

test("rejects expired, tampered, foreign-key, and weak mission delegations", async () => {
  const now = new Date("2026-09-05T12:00:00.000Z");
  const delegations = new MissionDelegation(new StaticTokenProvider("a".repeat(32)), 60_000);
  const grant = await delegations.issue(input, now);
  const parts = grant.token.split(".");
  const tampered = `${parts[0]}.${parts[1]}.${parts[2]![0] === "a" ? "b" : "a"}${parts[2]!.slice(1)}`;
  await assert.rejects(delegations.verify(tampered, now), InvalidMissionDelegationError);
  await assert.rejects(delegations.verify(grant.token, new Date(now.getTime() + 60_000)), InvalidMissionDelegationError);
  await assert.rejects(
    new MissionDelegation(new StaticTokenProvider("b".repeat(32))).verify(grant.token, now),
    InvalidMissionDelegationError,
  );
  await assert.rejects(
    new MissionDelegation(new StaticTokenProvider("short")).issue(input, now),
    /at least 32 bytes/,
  );
});
