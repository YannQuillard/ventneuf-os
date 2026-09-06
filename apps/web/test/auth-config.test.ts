import assert from "node:assert/strict";
import test from "node:test";
import { getAuthConfig } from "../lib/auth/config";

const baseEnvironment = {
  AUTH_LOGOUT_URI: "https://app.example.com",
  AUTH_REDIRECT_URI: "https://app.example.com/auth/callback",
  COGNITO_CLIENT_ID: "client-id",
  COGNITO_DOMAIN: "https://auth.example.com",
  COGNITO_REGION: "eu-west-1",
  NODE_ENV: "production",
};

test("reads the session secret from the Amplify environment secret payload", async () => {
  const config = await getAuthConfig({
    ...baseEnvironment,
    secrets: JSON.stringify({
      AUTH_SESSION_SECRET: "an-amplify-secret-that-is-at-least-32-characters",
    }),
  });

  assert.equal(config.sessionSecret, "an-amplify-secret-that-is-at-least-32-characters");
  assert.equal(config.redirectUri, "https://app.example.com/auth/callback");
});

test("prefers an explicit environment value over the Amplify secret payload", async () => {
  const config = await getAuthConfig({
    ...baseEnvironment,
    AUTH_SESSION_SECRET: "an-explicit-secret-that-is-at-least-32-characters",
    secrets: JSON.stringify({
      AUTH_SESSION_SECRET: "an-amplify-secret-that-is-at-least-32-characters",
    }),
  });

  assert.equal(config.sessionSecret, "an-explicit-secret-that-is-at-least-32-characters");
});

test("reads the session secret from the configured SSM parameter", async () => {
  let requestedParameter: string | undefined;
  const config = await getAuthConfig(
    {
      ...baseEnvironment,
      AUTH_SESSION_SECRET_PARAMETER: "/amplify/app/main/AUTH_SESSION_SECRET",
    },
    async (parameterName) => {
      requestedParameter = parameterName;
      return "an-ssm-secret-that-is-at-least-32-characters";
    },
  );

  assert.equal(requestedParameter, "/amplify/app/main/AUTH_SESSION_SECRET");
  assert.equal(config.sessionSecret, "an-ssm-secret-that-is-at-least-32-characters");
});

test("fails closed when no valid session secret is available", async () => {
  await assert.rejects(
    getAuthConfig({ ...baseEnvironment, secrets: "not-json" }),
    /AUTH_SESSION_SECRET is required/,
  );
  await assert.rejects(
    getAuthConfig({ ...baseEnvironment, secrets: JSON.stringify({ AUTH_SESSION_SECRET: 42 }) }),
    /AUTH_SESSION_SECRET is required/,
  );
});

test("infers the Cognito region from the standard hosted domain", async () => {
  const config = await getAuthConfig({
    ...baseEnvironment,
    AUTH_SESSION_SECRET: "an-explicit-secret-that-is-at-least-32-characters",
    COGNITO_DOMAIN: "https://workspace.auth.eu-central-1.amazoncognito.com",
    COGNITO_REGION: undefined,
  });

  assert.equal(config.region, "eu-central-1");
});

test("fails closed when the Cognito region cannot be resolved", async () => {
  await assert.rejects(
    getAuthConfig({
      ...baseEnvironment,
      AUTH_SESSION_SECRET: "an-explicit-secret-that-is-at-least-32-characters",
      COGNITO_REGION: undefined,
    }),
    /COGNITO_REGION is required/,
  );
});
