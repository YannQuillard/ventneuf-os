import { NextResponse } from "next/server";
import { getAuthConfig } from "../../../lib/auth/config";
import { ACCESS_TOKEN_COOKIE, SESSION_COOKIE } from "../../../lib/auth/session";

export async function GET() {
  const config = getAuthConfig();
  const logoutUrl = new URL("/logout", config.issuerBaseUrl);
  logoutUrl.searchParams.set("client_id", config.clientId);
  logoutUrl.searchParams.set("logout_uri", config.logoutUri);

  const response = NextResponse.redirect(logoutUrl);
  response.cookies.delete(SESSION_COOKIE);
  response.cookies.delete(ACCESS_TOKEN_COOKIE);
  return response;
}
