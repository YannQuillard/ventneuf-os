import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bearerToken,
  CognitoTokenVerifier,
  CompositeTokenVerifier,
  createTokenVerifier,
  DevelopmentTokenVerifier,
  HermesServiceTokenVerifier,
} from "../src/authentication.js";
import { StaticTokenProvider } from "../src/hermes.js";

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
  assert.ok(context?.capabilities.includes("approval:decide"));
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

test("authenticates Hermes as a narrow service principal without member identity", async () => {
  const verifier = new HermesServiceTokenVerifier(
    new StaticTokenProvider("service-secret"),
    "00000000-0000-4000-8000-000000000001",
    "hermes-supervisor",
  );
  assert.equal(await verifier.verify("wrong-secret"), undefined);
  const context = await verifier.verify("service-secret");
  assert.deepEqual(context, {
    organizationId: "00000000-0000-4000-8000-000000000001",
    principalId: "hermes-supervisor",
    principalType: "service",
    projectIds: [],
    capabilities: ["system:identity:read", "mission:dispatch", "approval:decide"],
    expiresAt: context!.expiresAt,
  });
});

test("keeps user and Hermes service credentials as separate authentication paths", async () => {
  const verifier = new CompositeTokenVerifier([
    new DevelopmentTokenVerifier("user-secret"),
    new HermesServiceTokenVerifier(
      new StaticTokenProvider("service-secret"),
      "00000000-0000-4000-8000-000000000001",
      "hermes-supervisor",
    ),
  ]);
  assert.equal((await verifier.verify("user-secret"))?.principalType, "user");
  assert.equal((await verifier.verify("service-secret"))?.principalType, "service");
  assert.equal(await verifier.verify("unknown"), undefined);
});

test("builds paired development user and Hermes authentication from explicit configuration", async () => {
  const verifier = createTokenVerifier({
    VENTNEUF_DEV_TOKEN: "user-secret",
    VENTNEUF_ORGANIZATION_ID: "00000000-0000-4000-8000-000000000001",
    HERMES_MCP_SERVICE_ID: "hermes-supervisor",
    HERMES_MCP_SERVICE_TOKEN: "service-secret",
    HERMES_MCP_DELEGATION_SECRET: "d".repeat(32),
  });
  assert.equal((await verifier.verify("user-secret"))?.principalType, "user");
  assert.equal((await verifier.verify("service-secret"))?.principalId, "hermes-supervisor");
});

test("requires complete Cognito configuration in production", () => {
  assert.throws(
    () => createTokenVerifier({ NODE_ENV: "production" }),
    /COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID, and VENTNEUF_ORGANIZATION_ID/,
  );
});

test("rejects partial or raw production Hermes MCP secret configuration", () => {
  assert.throws(() => createTokenVerifier({
    VENTNEUF_DEV_TOKEN: "user",
    HERMES_MCP_SERVICE_TOKEN: "service",
  }), /configured together/);
  assert.throws(() => createTokenVerifier({
    VENTNEUF_DEV_TOKEN: "user",
    HERMES_MCP_SERVICE_ID: "hermes-supervisor",
    HERMES_MCP_SERVICE_TOKEN: "service",
    HERMES_MCP_DELEGATION_SECRET: "d".repeat(32),
  }), /VENTNEUF_ORGANIZATION_ID/);
  assert.throws(() => createTokenVerifier({
    NODE_ENV: "production",
    HERMES_MCP_SERVICE_TOKEN: "service",
    HERMES_MCP_DELEGATION_SECRET: "delegation",
  }), /cannot be configured in production/);
});
