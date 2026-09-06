import QRCode from "qrcode";
import { NextRequest, NextResponse } from "next/server";
import {
  AUTH_CHALLENGE_COOKIE,
  authChallengeCookieOptions,
  decodeAuthChallenge,
  encodeAuthChallenge,
  type AuthChallengeState,
} from "../../../../lib/auth/challenge";
import {
  authenticatedIdentity,
  beginNativeSignIn,
  completeNativeChallenge,
  publicCognitoError,
  type NativeAuthOutcome,
} from "../../../../lib/auth/cognito";
import { getAuthConfig, type AuthConfig } from "../../../../lib/auth/config";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  SESSION_COOKIE,
  authCookieOptions,
  encodeSession,
} from "../../../../lib/auth/session";
import { isSameOriginMutation } from "../../../../lib/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SignInAction = "credentials" | "new-password" | "setup-totp" | "verify-totp";

function json(body: object, init?: ResponseInit): NextResponse {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "no-store");
  return response;
}

function emailValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function stringValue(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength ? value : null;
}

function verificationCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.replace(/\s/g, "");
  return /^\d{6}$/.test(code) ? code : null;
}

function challengeMatches(action: SignInAction, state: AuthChallengeState): boolean {
  return (
    (action === "verify-totp" && state.challenge === "SOFTWARE_TOKEN_MFA") ||
    (action === "new-password" && state.challenge === "NEW_PASSWORD_REQUIRED") ||
    (action === "setup-totp" && state.challenge === "MFA_SETUP")
  );
}

async function outcomeResponse(config: AuthConfig, outcome: NativeAuthOutcome): Promise<NextResponse> {
  if (outcome.kind === "authenticated") {
    const identity = await authenticatedIdentity(config, outcome.tokens.accessToken);
    const expiresAt = Math.floor(Date.now() / 1000) + config.sessionMaxAgeSeconds;
    const response = json({ step: "authenticated" });
    response.cookies.set(
      SESSION_COOKIE,
      encodeSession({ ...identity, expiresAt }, config.sessionSecret),
      authCookieOptions(config.sessionMaxAgeSeconds),
    );
    response.cookies.set(
      ACCESS_TOKEN_COOKIE,
      outcome.tokens.accessToken,
      authCookieOptions(outcome.tokens.expiresIn),
    );
    response.cookies.set(
      REFRESH_TOKEN_COOKIE,
      outcome.tokens.refreshToken,
      authCookieOptions(config.sessionMaxAgeSeconds),
    );
    response.cookies.delete(AUTH_CHALLENGE_COOKIE);
    return response;
  }

  const responseBody: Record<string, string> = { step: outcome.step };
  if (outcome.step === "setup-totp") {
    const label = encodeURIComponent(`ventneuf.os:${outcome.state.username}`);
    const issuer = encodeURIComponent("ventneuf.os");
    const uri = `otpauth://totp/${label}?secret=${encodeURIComponent(outcome.secretCode)}&issuer=${issuer}`;
    responseBody.qrCode = await QRCode.toDataURL(uri, { margin: 1, width: 192 });
    responseBody.secretCode = outcome.secretCode;
  }

  const response = json(responseBody);
  response.cookies.set(
    AUTH_CHALLENGE_COOKIE,
    encodeAuthChallenge(outcome.state, config.sessionSecret),
    authChallengeCookieOptions(),
  );
  return response;
}

export async function POST(request: NextRequest) {
  if (!isSameOriginMutation(request)) {
    return json({ code: "forbidden", message: "Request origin is not allowed." }, { status: 403 });
  }

  const input = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = input?.action;
  if (!["credentials", "new-password", "setup-totp", "verify-totp"].includes(String(action))) {
    return json({ code: "invalid_input", message: "The sign-in request is invalid." }, { status: 400 });
  }

  try {
    const config = await getAuthConfig();
    if (action === "credentials") {
      const email = emailValue(input?.email);
      const password = stringValue(input?.password, 256);
      if (!email || !password) {
        return json({ code: "invalid_input", message: "Enter a valid email and password." }, { status: 400 });
      }
      return await outcomeResponse(config, await beginNativeSignIn(config, email, password));
    }

    const encodedState = request.cookies.get(AUTH_CHALLENGE_COOKIE)?.value;
    const state = encodedState ? decodeAuthChallenge(encodedState, config.sessionSecret) : null;
    if (!state || !challengeMatches(action as SignInAction, state)) {
      const response = json(
        { code: "expired_challenge", message: "This sign-in step expired. Start again." },
        { status: 409 },
      );
      response.cookies.delete(AUTH_CHALLENGE_COOKIE);
      return response;
    }

    const answer =
      action === "new-password"
        ? stringValue(input?.password, 256)
        : verificationCode(input?.code);
    if (!answer || (action === "new-password" && answer.length < 12)) {
      return json(
        {
          code: "invalid_input",
          message:
            action === "new-password"
              ? "Use a password with at least 12 characters."
              : "Enter the six-digit verification code.",
        },
        { status: 400 },
      );
    }

    return await outcomeResponse(config, await completeNativeChallenge(config, state, answer));
  } catch (error) {
    const failure = publicCognitoError(error);
    return json({ code: failure.code, message: failure.message }, { status: failure.status });
  }
}
