import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { AUTH_CHALLENGE_COOKIE } from "../../../lib/auth/challenge";
import { revokeAccess } from "../../../lib/auth/cognito";
import { getAuthConfig } from "../../../lib/auth/config";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  SESSION_COOKIE,
} from "../../../lib/auth/session";

export async function GET(request: NextRequest) {
  const accessToken = (await cookies()).get(ACCESS_TOKEN_COOKIE)?.value;
  if (accessToken) await revokeAccess(await getAuthConfig(), accessToken);

  const response = NextResponse.redirect(new URL("/login", request.url));
  response.cookies.delete(SESSION_COOKIE);
  response.cookies.delete(ACCESS_TOKEN_COOKIE);
  response.cookies.delete(REFRESH_TOKEN_COOKIE);
  response.cookies.delete(AUTH_CHALLENGE_COOKIE);
  return response;
}
