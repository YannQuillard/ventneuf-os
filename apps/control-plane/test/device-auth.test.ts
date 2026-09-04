import assert from "node:assert/strict";
import test from "node:test";
import {
  createDeviceCredential,
  createEnrollmentToken,
  hashDeviceToken,
  parseDeviceCredential,
  parseEnrollmentToken,
} from "../src/device-auth.js";

const organizationId = "00000000-0000-4000-8000-000000000001";
const deviceId = "00000000-0000-4000-8000-000000000002";

test("creates opaque enrollment tokens containing only their routing scope", () => {
  const first = createEnrollmentToken(organizationId);
  const second = createEnrollmentToken(organizationId);

  assert.notEqual(first.token, second.token);
  assert.equal(first.tokenHash, hashDeviceToken(first.token));
  assert.deepEqual(parseEnrollmentToken(first.token), { organizationId });
  assert.equal(parseEnrollmentToken(`${first.token}.extra`), undefined);
});

test("accepts canonical PostgreSQL UUIDs without an RFC version nibble", () => {
  const legacyOrganizationId = "4fa55520-fa01-d779-8b85-4d2b823e0abb";
  const enrollment = createEnrollmentToken(legacyOrganizationId);

  assert.deepEqual(parseEnrollmentToken(enrollment.token), {
    organizationId: legacyOrganizationId,
  });
});

test("creates parseable device credentials without exposing their secret", () => {
  const credential = createDeviceCredential(organizationId, deviceId);

  assert.deepEqual(parseDeviceCredential(credential.token), { organizationId, deviceId });
  assert.equal(parseDeviceCredential(credential.token.replace("vnod.", "vnoe.")), undefined);
  assert.equal(credential.tokenHash.length, 64);
  assert.equal(credential.tokenHash.includes(organizationId), false);
});
