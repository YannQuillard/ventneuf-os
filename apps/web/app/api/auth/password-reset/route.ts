import { NextResponse } from "next/server";
import {
  confirmPasswordReset,
  publicCognitoError,
  requestPasswordReset,
} from "../../../../lib/auth/cognito";
import { getAuthConfig } from "../../../../lib/auth/config";
import { isSameOriginMutation } from "../../../../lib/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
    return json({ code: "forbidden", message: "Request origin is not allowed." }, { status: 403 });
  }

  const input = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const email = emailValue(input?.email);
  if (!email || !["request", "confirm"].includes(String(input?.action))) {
    return json({ code: "invalid_input", message: "Enter a valid email address." }, { status: 400 });
  }

  try {
    const config = await getAuthConfig();
    if (input?.action === "request") {
      await requestPasswordReset(config, email);
      return json({ step: "code" });
    }

    const code = typeof input?.code === "string" ? input.code.replace(/\s/g, "") : "";
    const password = typeof input?.password === "string" ? input.password : "";
    if (!/^\d{6}$/.test(code) || password.length < 12 || password.length > 256) {
      return json(
        { code: "invalid_input", message: "Enter the six-digit code and a valid new password." },
        { status: 400 },
      );
    }

    await confirmPasswordReset(config, email, code, password);
    return json({ step: "complete" });
  } catch (error) {
    const failure = publicCognitoError(error);
    return json({ code: failure.code, message: failure.message }, { status: failure.status });
  }
}
