import assert from "node:assert/strict";
import test from "node:test";
import { accessTokenNeedsRefresh, refreshAccessToken } from "../lib/auth/token";

function token(exp: number): string {
  return `header.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.signature`;
}

const config = {
  clientId: "client-id",
  issuerBaseUrl: "https://auth.example.com",
  logoutUri: "https://app.example.com",
  redirectUri: "https://app.example.com/auth/callback",
  sessionMaxAgeSeconds: 2_592_000,
  sessionSecret: "a-secret-that-is-at-least-32-characters",
};

test("refreshes missing, invalid, and nearly expired access tokens", () => {
  const now = 2_000_000_000_000;
  assert.equal(accessTokenNeedsRefresh(undefined, now), true);
  assert.equal(accessTokenNeedsRefresh("invalid", now), true);
  assert.equal(accessTokenNeedsRefresh(token(now / 1000 + 30), now), true);
  assert.equal(accessTokenNeedsRefresh(token(now / 1000 + 120), now), false);
});

test("exchanges a refresh token without exposing it in the URL", async () => {
  const originalFetch = globalThis.fetch;
  let request: { body: string; url: string } | undefined;
  globalThis.fetch = async (input, init) => {
    request = { body: String(init?.body), url: String(input) };
    return Response.json({ access_token: "new-access-token", expires_in: 3600 });
  };

  try {
    assert.deepEqual(await refreshAccessToken("private-refresh-token", config), {
      accessToken: "new-access-token",
      expiresIn: 3600,
    });
    assert.equal(request?.url, "https://auth.example.com/oauth2/token");
    assert.equal(request?.body.includes("refresh_token=private-refresh-token"), true);
    assert.equal(request?.url.includes("private-refresh-token"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fails closed when Cognito rejects a refresh token", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: "invalid_grant" }, { status: 400 });

  try {
    assert.equal(await refreshAccessToken("expired-refresh-token", config), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
