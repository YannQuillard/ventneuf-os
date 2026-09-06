import assert from "node:assert/strict";
import test from "node:test";
import { getAuthConfig } from "../lib/auth/config";

const baseEnvironment = {
  AUTH_LOGOUT_URI: "https://app.example.com",
  AUTH_REDIRECT_URI: "https://app.example.com/auth/callback",
  COGNITO_CLIENT_ID: "client-id",
  COGNITO_DOMAIN: "https://auth.example.com",
  NODE_ENV: "production",
};

test("reads the session secret from the Amplify environment secret payload", () => {
  const config = getAuthConfig({
    ...baseEnvironment,
    secrets: JSON.stringify({
      AUTH_SESSION_SECRET: "an-amplify-secret-that-is-at-least-32-characters",
    }),
  });

  assert.equal(config.sessionSecret, "an-amplify-secret-that-is-at-least-32-characters");
  assert.equal(config.redirectUri, "https://app.example.com/auth/callback");
});

test("prefers an explicit environment value over the Amplify secret payload", () => {
  const config = getAuthConfig({
    ...baseEnvironment,
    AUTH_SESSION_SECRET: "an-explicit-secret-that-is-at-least-32-characters",
    secrets: JSON.stringify({
      AUTH_SESSION_SECRET: "an-amplify-secret-that-is-at-least-32-characters",
    }),
  });

  assert.equal(config.sessionSecret, "an-explicit-secret-that-is-at-least-32-characters");
});

test("fails closed when the Amplify secret payload is invalid or incomplete", () => {
  assert.throws(
    () => getAuthConfig({ ...baseEnvironment, secrets: "not-json" }),
    /AUTH_SESSION_SECRET is required/,
  );
  assert.throws(
    () => getAuthConfig({ ...baseEnvironment, secrets: JSON.stringify({ AUTH_SESSION_SECRET: 42 }) }),
    /AUTH_SESSION_SECRET is required/,
  );
});
