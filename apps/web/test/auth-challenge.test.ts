import assert from "node:assert/strict";
import test from "node:test";
import { decodeAuthChallenge, encodeAuthChallenge } from "../lib/auth/challenge";

const secret = "a-test-secret-that-is-long-enough-for-hmac-signing";
const now = 2_000_000_000;

test("round-trips a signed Cognito challenge", () => {
  const state = {
    challenge: "NEW_PASSWORD_REQUIRED" as const,
    issuedAt: now,
    requiredAttributes: ["userAttributes.email"],
    session: "cognito-session-value-that-is-long-enough",
    username: "member@example.com",
  };

  assert.deepEqual(decodeAuthChallenge(encodeAuthChallenge(state, secret), secret, now), state);
});

test("rejects tampered and expired Cognito challenges", () => {
  const encoded = encodeAuthChallenge(
    {
      challenge: "SOFTWARE_TOKEN_MFA",
      issuedAt: now,
      session: "cognito-session-value-that-is-long-enough",
      username: "member@example.com",
    },
    secret,
  );

  const [payload, signature] = encoded.split(".");
  assert.equal(decodeAuthChallenge(`${payload}x.${signature}`, secret, now), null);
  assert.equal(decodeAuthChallenge(encoded, secret, now + 601), null);
});

test("rejects malformed Cognito challenge state", () => {
  const malformed = encodeAuthChallenge(
    {
      challenge: "MFA_SETUP",
      issuedAt: now,
      session: "short",
      username: "member@example.com",
    },
    secret,
  );

  assert.equal(decodeAuthChallenge(malformed, secret, now), null);
  assert.equal(decodeAuthChallenge("not-a-signed-state", secret, now), null);
});
