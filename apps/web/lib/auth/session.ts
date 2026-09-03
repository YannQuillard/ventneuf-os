import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getAuthConfig } from "./config";

export const SESSION_COOKIE = "ventneuf_session";
export const ACCESS_TOKEN_COOKIE = "ventneuf_access_token";
export const REFRESH_TOKEN_COOKIE = "ventneuf_refresh_token";

export interface UserSession {
  sub: string;
  email: string;
  expiresAt: number;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function encodeSession(session: UserSession, secret: string): string {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function decodeSession(value: string, secret: string): UserSession | null {
  const [payload, signature, extra] = value.split(".");

  if (!payload || !signature || extra) {
    return null;
  }

  const expected = Buffer.from(sign(payload, secret));
  const received = Buffer.from(signature);

  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<UserSession>;

    if (
      typeof parsed.sub !== "string" ||
      typeof parsed.email !== "string" ||
      typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    return parsed as UserSession;
  } catch {
    return null;
  }
}

export async function readSession(): Promise<UserSession | null> {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;

  if (!value) {
    return null;
  }

  return decodeSession(value, getAuthConfig().sessionSecret);
}

export function authCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    maxAge,
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
}
