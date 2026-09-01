import { createHash, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import type { AuthorizationContext, Capability } from "@ventneuf/domain";

export interface TokenVerifier {
  verify(token: string): Promise<AuthorizationContext | undefined>;
}

function secureEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

export class DevelopmentTokenVerifier implements TokenVerifier {
  constructor(private readonly expectedToken: string) {}

  async verify(token: string): Promise<AuthorizationContext | undefined> {
    if (!secureEqual(token, this.expectedToken)) return undefined;
    const capabilities: Capability[] = [
      "system:identity:read",
      "knowledge:shared:read",
      "knowledge:personal:read",
      "mission:read",
      "mission:progress:write",
      "hermes:ask",
    ];
    return {
      organizationId: "ventneuf",
      principalId: "development-user",
      principalType: "user",
      memberId: "development-user",
      projectIds: [],
      capabilities,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };
  }
}

export function bearerToken(request: Pick<Request, "headers">): string | undefined {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return undefined;
  const token = authorization.slice("Bearer ".length).trim();
  return token || undefined;
}

export function createTokenVerifier(env: NodeJS.ProcessEnv = process.env): TokenVerifier {
  if (env.NODE_ENV === "production") {
    throw new Error("A production OAuth token verifier has not been configured yet.");
  }
  if (!env.VENTNEUF_DEV_TOKEN) {
    throw new Error("VENTNEUF_DEV_TOKEN is required outside production.");
  }
  return new DevelopmentTokenVerifier(env.VENTNEUF_DEV_TOKEN);
}
