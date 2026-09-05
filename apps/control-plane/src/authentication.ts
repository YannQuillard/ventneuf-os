import { createHash, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import type { AuthorizationContext, Capability } from "@ventneuf/domain";

export interface TokenVerifier {
  verify(token: string): Promise<AuthorizationContext | undefined>;
}

interface CognitoAccessClaims {
  sub: string;
  exp: number;
}

export interface CognitoClaimsVerifier {
  verify(token: string): Promise<CognitoAccessClaims>;
}

const authenticatedCapabilities: Capability[] = [
  "system:identity:read",
  "knowledge:shared:read",
  "knowledge:personal:read",
  "mission:create",
  "mission:read",
  "mission:progress:write",
  "device:manage",
  "hermes:ask",
];

function secureEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

export class DevelopmentTokenVerifier implements TokenVerifier {
  constructor(private readonly expectedToken: string) {}

  async verify(token: string): Promise<AuthorizationContext | undefined> {
    if (!secureEqual(token, this.expectedToken)) return undefined;
    return {
      organizationId: "00000000-0000-4000-8000-000000000001",
      principalId: "development-user",
      principalType: "user",
      memberId: "development-user",
      projectIds: [],
      capabilities: authenticatedCapabilities,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };
  }
}

export class CognitoTokenVerifier implements TokenVerifier {
  constructor(
    private readonly verifier: CognitoClaimsVerifier,
    private readonly organizationId: string,
  ) {}

  async verify(token: string): Promise<AuthorizationContext | undefined> {
    try {
      const claims = await this.verifier.verify(token);
      return {
        organizationId: this.organizationId,
        principalId: claims.sub,
        principalType: "user",
        memberId: claims.sub,
        projectIds: [],
        capabilities: authenticatedCapabilities,
        expiresAt: new Date(claims.exp * 1000).toISOString(),
      };
    } catch {
      return undefined;
    }
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
    const userPoolId = env.COGNITO_USER_POOL_ID;
    const clientId = env.COGNITO_CLIENT_ID;
    const organizationId = env.VENTNEUF_ORGANIZATION_ID;
    if (!userPoolId || !clientId || !organizationId) {
      throw new Error(
        "COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID, and VENTNEUF_ORGANIZATION_ID are required in production.",
      );
    }
    const verifier = CognitoJwtVerifier.create({
      userPoolId,
      clientId,
      tokenUse: "access",
      graceSeconds: 0,
    });
    return new CognitoTokenVerifier(verifier, organizationId);
  }
  if (!env.VENTNEUF_DEV_TOKEN) {
    throw new Error("VENTNEUF_DEV_TOKEN is required outside production.");
  }
  return new DevelopmentTokenVerifier(env.VENTNEUF_DEV_TOKEN);
}
