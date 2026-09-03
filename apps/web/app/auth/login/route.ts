import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getAuthConfig } from "../../../lib/auth/config";
import { authCookieOptions } from "../../../lib/auth/session";

const OAUTH_STATE_COOKIE = "ventneuf_oauth_state";
const PKCE_VERIFIER_COOKIE = "ventneuf_pkce_verifier";

export async function GET() {
  const config = getAuthConfig();
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(64).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authorizeUrl = new URL("/oauth2/authorize", config.issuerBaseUrl);

  authorizeUrl.searchParams.set("client_id", config.clientId);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("redirect_uri", config.redirectUri);
  authorizeUrl.searchParams.set("scope", "openid email profile");
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("code_challenge", challenge);

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(OAUTH_STATE_COOKIE, state, authCookieOptions(600));
  response.cookies.set(PKCE_VERIFIER_COOKIE, verifier, authCookieOptions(600));
  return response;
}

export { OAUTH_STATE_COOKIE, PKCE_VERIFIER_COOKIE };
