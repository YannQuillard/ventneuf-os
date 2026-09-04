import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bearerToken,
  CognitoTokenVerifier,
  createTokenVerifier,
  DevelopmentTokenVerifier,
} from "../src/authentication.js";

test("extracts a bearer token", () => {
  assert.equal(bearerToken({ headers: { authorization: "Bearer secret" } } as never), "secret");
  assert.equal(bearerToken({ headers: {} } as never), undefined);
});

test("verifies the development token without exposing it", async () => {
  const verifier = new DevelopmentTokenVerifier("expected-token");
  assert.equal(await verifier.verify("wrong-token"), undefined);
  const context = await verifier.verify("expected-token");
  assert.equal(context?.organizationId, "00000000-0000-4000-8000-000000000001");
  assert.ok(context?.capabilities.includes("hermes:ask"));
});

test("maps verified Cognito access claims to an authorization context", async () => {
  const verifier = new CognitoTokenVerifier(
    {
      async verify() {
        return { sub: "member-subject", exp: 2_000_000_000 };
      },
    },
    "organization-id",
  );

  const context = await verifier.verify("signed-access-token");
  assert.equal(context?.organizationId, "organization-id");
  assert.equal(context?.memberId, "member-subject");
  assert.equal(context?.expiresAt, new Date(2_000_000_000 * 1000).toISOString());
});

test("fails closed when Cognito rejects a token", async () => {
  const verifier = new CognitoTokenVerifier(
    {
      async verify() {
        throw new Error("invalid token");
      },
    },
    "organization-id",
  );

  assert.equal(await verifier.verify("invalid"), undefined);
});

test("requires complete Cognito configuration in production", () => {
  assert.throws(
    () => createTokenVerifier({ NODE_ENV: "production" }),
    /COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID, and VENTNEUF_ORGANIZATION_ID/,
  );
});
