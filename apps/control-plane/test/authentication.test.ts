import assert from "node:assert/strict";
import { test } from "node:test";
import { bearerToken, DevelopmentTokenVerifier } from "../src/authentication.js";

test("extracts a bearer token", () => {
  assert.equal(bearerToken({ headers: { authorization: "Bearer secret" } } as never), "secret");
  assert.equal(bearerToken({ headers: {} } as never), undefined);
});

test("verifies the development token without exposing it", async () => {
  const verifier = new DevelopmentTokenVerifier("expected-token");
  assert.equal(await verifier.verify("wrong-token"), undefined);
  const context = await verifier.verify("expected-token");
  assert.equal(context?.organizationId, "ventneuf");
  assert.ok(context?.capabilities.includes("hermes:ask"));
});
