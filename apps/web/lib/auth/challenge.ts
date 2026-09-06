import { createHmac, timingSafeEqual } from "node:crypto";

export const AUTH_CHALLENGE_COOKIE = "ventneuf_auth_challenge";

const CHALLENGE_MAX_AGE_SECONDS = 10 * 60;
const SUPPORTED_CHALLENGES = new Set(["SOFTWARE_TOKEN_MFA", "NEW_PASSWORD_REQUIRED", "MFA_SETUP"]);

export interface AuthChallengeState {
  challenge: "SOFTWARE_TOKEN_MFA" | "NEW_PASSWORD_REQUIRED" | "MFA_SETUP";
  issuedAt: number;
  requiredAttributes?: string[];
  session: string;
  username: string;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function encodeAuthChallenge(state: AuthChallengeState, secret: string): string {
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function decodeAuthChallenge(
  value: string,
  secret: string,
  now = Math.floor(Date.now() / 1000),
): AuthChallengeState | null {
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra) return null;

  const expected = Buffer.from(sign(payload, secret));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<AuthChallengeState>;
    const requiredAttributes = parsed.requiredAttributes;
    if (
      typeof parsed.challenge !== "string" ||
      !SUPPORTED_CHALLENGES.has(parsed.challenge) ||
      typeof parsed.issuedAt !== "number" ||
      !Number.isInteger(parsed.issuedAt) ||
      parsed.issuedAt > now + 60 ||
      parsed.issuedAt + CHALLENGE_MAX_AGE_SECONDS < now ||
      typeof parsed.session !== "string" ||
      parsed.session.length < 20 ||
      parsed.session.length > 4096 ||
      typeof parsed.username !== "string" ||
      !parsed.username ||
      parsed.username.length > 254 ||
      (requiredAttributes !== undefined &&
        (!Array.isArray(requiredAttributes) || requiredAttributes.some((entry) => typeof entry !== "string")))
    ) {
      return null;
    }

    return parsed as AuthChallengeState;
  } catch {
    return null;
  }
}

export function authChallengeCookieOptions() {
  return {
    httpOnly: true,
    maxAge: CHALLENGE_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
}
