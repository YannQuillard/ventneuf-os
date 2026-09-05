import assert from "node:assert/strict";
import test from "node:test";
import { StaticTokenProvider } from "../src/hermes.js";
import {
  HmacMissionDelegationMac,
  InvalidMissionDelegationError,
  KmsMissionDelegationMac,
  MissionDelegation,
} from "../src/mission-delegation.js";

const localMac = (secret: string) => new HmacMissionDelegationMac(new StaticTokenProvider(secret));

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
  const delegations = new MissionDelegation(localMac("a".repeat(32)), 60_000);
  const now = new Date("2026-09-05T12:00:00.000Z");
  const grant = await delegations.issue(input, now);
  assert.match(grant.token, /^vnd1\./);
  assert.deepEqual(await delegations.verify(grant.token, new Date(now.getTime() + 30_000)), grant.claims);
  assert.equal(grant.claims.capabilities[0], "mission:dispatch");
  assert.equal(grant.claims.expiresAt, "2026-09-05T12:01:00.000Z");
});

test("issues an approval delegation bound to one request and parent review mission", async () => {
  const delegations = new MissionDelegation(localMac("a".repeat(32)), 60_000);
  const now = new Date("2026-09-05T12:00:00.000Z");
  const approvalId = "00000000-0000-4000-8000-000000000006";
  const grant = await delegations.issueApproval({
    serviceId: input.serviceId,
    organizationId: input.organizationId,
    parentMissionId: input.parentMissionId,
    conversationId: input.conversationId,
    memberId: input.memberId,
    approvalId,
  }, now);
  assert.deepEqual(await delegations.verify(grant.token, new Date(now.getTime() + 30_000)), grant.claims);
  assert.deepEqual(grant.claims.capabilities, ["approval:decide"]);
  assert.equal(grant.claims.approvalId, approvalId);
  assert.equal("targets" in grant.claims, false);
});

test("rejects expired, tampered, foreign-key, and weak mission delegations", async () => {
  const now = new Date("2026-09-05T12:00:00.000Z");
  const delegations = new MissionDelegation(localMac("a".repeat(32)), 60_000);
  const grant = await delegations.issue(input, now);
  const parts = grant.token.split(".");
  const tampered = `${parts[0]}.${parts[1]}.${parts[2]![0] === "a" ? "b" : "a"}${parts[2]!.slice(1)}`;
  await assert.rejects(delegations.verify(tampered, now), InvalidMissionDelegationError);
  await assert.rejects(delegations.verify(grant.token, new Date(now.getTime() + 60_000)), InvalidMissionDelegationError);
  await assert.rejects(
    new MissionDelegation(localMac("b".repeat(32))).verify(grant.token, now),
    InvalidMissionDelegationError,
  );
  await assert.rejects(
    new MissionDelegation(localMac("short")).issue(input, now),
    /at least 32 bytes/,
  );
});

test("uses AWS KMS only for generating and verifying delegation MACs", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const kms = new KmsMissionDelegationMac({
    send: async (command: { input: Record<string, unknown> }) => {
      calls.push(command.input);
      return "Mac" in command.input
        ? { MacValid: true }
        : { Mac: Uint8Array.from([1, 2, 3]) };
    },
  } as never, "delegation-key");
  const message = Buffer.from("payload");
  assert.deepEqual(await kms.sign(message), Uint8Array.from([1, 2, 3]));
  assert.equal(await kms.verify(message, Uint8Array.from([1, 2, 3])), true);
  assert.deepEqual(calls, [
    { KeyId: "delegation-key", MacAlgorithm: "HMAC_SHA_256", Message: message },
    { KeyId: "delegation-key", MacAlgorithm: "HMAC_SHA_256", Message: message, Mac: Uint8Array.from([1, 2, 3]) },
  ]);
});
