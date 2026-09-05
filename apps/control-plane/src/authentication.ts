import { createHash, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import type { AuthorizationContext, Capability } from "@ventneuf/domain";
import { SecretsManagerTokenProvider, StaticTokenProvider, type TokenProvider } from "./hermes.js";

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

export class HermesServiceTokenVerifier implements TokenVerifier {
  constructor(
    private readonly tokens: TokenProvider,
    private readonly organizationId: string,
    private readonly serviceId: string,
  ) {}

  async verify(token: string): Promise<AuthorizationContext | undefined> {
    if (!secureEqual(token, await this.tokens.getToken())) return undefined;
    return {
      organizationId: this.organizationId,
      principalId: this.serviceId,
      principalType: "service",
      projectIds: [],
      capabilities: ["system:identity:read", "mission:dispatch"],
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    };
  }
}

export class CompositeTokenVerifier implements TokenVerifier {
  constructor(private readonly verifiers: TokenVerifier[]) {}

  async verify(token: string): Promise<AuthorizationContext | undefined> {
    for (const verifier of this.verifiers) {
      const context = await verifier.verify(token);
      if (context) return context;
    }
    return undefined;
  }
}

export function bearerToken(request: Pick<Request, "headers">): string | undefined {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return undefined;
  const token = authorization.slice("Bearer ".length).trim();
  return token || undefined;
}

export function createTokenVerifier(env: NodeJS.ProcessEnv = process.env): TokenVerifier {
  const serviceSecretId = env.HERMES_MCP_SERVICE_SECRET_ID;
  const delegationSecretId = env.HERMES_MCP_DELEGATION_SECRET_ID;
  const serviceToken = env.HERMES_MCP_SERVICE_TOKEN;
  const delegationSecret = env.HERMES_MCP_DELEGATION_SECRET;
  if (env.NODE_ENV === "production" && (serviceToken || delegationSecret)) {
    throw new Error("Raw Hermes MCP secrets cannot be configured in production.");
  }
  if (Boolean(serviceSecretId) !== Boolean(delegationSecretId)
    || Boolean(serviceToken) !== Boolean(delegationSecret)) {
    throw new Error("Hermes MCP service and delegation secrets must be configured together.");
  }
  if ((serviceSecretId || serviceToken)
    && (!env.HERMES_MCP_SERVICE_ID || !env.VENTNEUF_ORGANIZATION_ID)) {
    throw new Error(
      "HERMES_MCP_SERVICE_ID and VENTNEUF_ORGANIZATION_ID are required when Hermes MCP authentication is configured.",
    );
  }
  if ((serviceSecretId || serviceToken)
    && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(env.HERMES_MCP_SERVICE_ID!)) {
    throw new Error("HERMES_MCP_SERVICE_ID is invalid.");
  }

  let userVerifier: TokenVerifier;
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
    userVerifier = new CognitoTokenVerifier(verifier, organizationId);
  } else {
    if (!env.VENTNEUF_DEV_TOKEN) {
      throw new Error("VENTNEUF_DEV_TOKEN is required outside production.");
    }
    userVerifier = new DevelopmentTokenVerifier(env.VENTNEUF_DEV_TOKEN);
  }

  const serviceTokens = serviceSecretId
    ? new SecretsManagerTokenProvider(
      new SecretsManagerClient({ region: env.AWS_REGION ?? "eu-west-1" }),
      serviceSecretId,
    )
    : serviceToken ? new StaticTokenProvider(serviceToken) : undefined;
  return serviceTokens
    ? new CompositeTokenVerifier([
      userVerifier,
      new HermesServiceTokenVerifier(
        serviceTokens,
        env.VENTNEUF_ORGANIZATION_ID!,
        env.HERMES_MCP_SERVICE_ID!,
      ),
    ])
    : userVerifier;
}
