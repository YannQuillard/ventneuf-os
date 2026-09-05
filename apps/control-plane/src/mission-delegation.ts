import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { z } from "zod";
import { SecretsManagerTokenProvider, StaticTokenProvider, type TokenProvider } from "./hermes.js";

const adapterSchema = z.enum(["repository-check", "orca-review"]);
const repositoryIdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/);
const targetSchema = z.object({
  deviceId: z.string().uuid(),
  repositoryId: repositoryIdSchema,
  adapters: z.array(adapterSchema).min(1).max(2),
}).strict();

const claimsSchema = z.object({
  version: z.literal(1),
  issuer: z.literal("ventneuf-control-plane"),
  audience: z.literal("ventneuf-mcp"),
  delegationId: z.string().uuid(),
  serviceId: z.string().min(1).max(100),
  organizationId: z.string().uuid(),
  parentMissionId: z.string().uuid(),
  conversationId: z.string().uuid(),
  memberId: z.string().uuid(),
  capabilities: z.tuple([z.literal("mission:dispatch")]),
  targets: z.array(targetSchema).max(50),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
}).strict();

export type MissionDispatchTarget = z.infer<typeof targetSchema>;
export type MissionDelegationClaims = z.infer<typeof claimsSchema>;

export interface MissionDelegationGrant {
  token: string;
  claims: MissionDelegationClaims;
}

export interface MissionDelegationVerifier {
  verify(token: string, now?: Date): Promise<MissionDelegationClaims>;
}

export interface MissionDelegationIssuer extends MissionDelegationVerifier {
  issue(input: {
    serviceId: string;
    organizationId: string;
    parentMissionId: string;
    conversationId: string;
    memberId: string;
    targets: MissionDispatchTarget[];
  }, now?: Date): Promise<MissionDelegationGrant>;
}

export class InvalidMissionDelegationError extends Error {
  constructor() {
    super("The mission delegation is invalid or expired.");
    this.name = "InvalidMissionDelegationError";
  }
}

export class MissionDelegation implements MissionDelegationIssuer {
  constructor(
    private readonly secrets: TokenProvider,
    private readonly lifetimeMs = 15 * 60_000,
  ) {
    if (lifetimeMs <= 0 || lifetimeMs > 20 * 60_000) {
      throw new Error("Mission delegation lifetime must be between 1 ms and 20 minutes.");
    }
  }

  async issue(input: {
    serviceId: string;
    organizationId: string;
    parentMissionId: string;
    conversationId: string;
    memberId: string;
    targets: MissionDispatchTarget[];
  }, now = new Date()): Promise<MissionDelegationGrant> {
    const claims = claimsSchema.parse({
      version: 1,
      issuer: "ventneuf-control-plane",
      audience: "ventneuf-mcp",
      delegationId: randomUUID(),
      serviceId: input.serviceId,
      organizationId: input.organizationId,
      parentMissionId: input.parentMissionId,
      conversationId: input.conversationId,
      memberId: input.memberId,
      capabilities: ["mission:dispatch"],
      targets: [...input.targets].sort((left, right) =>
        `${left.deviceId}:${left.repositoryId}`.localeCompare(`${right.deviceId}:${right.repositoryId}`)),
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.lifetimeMs).toISOString(),
    });
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    return { claims, token: `vnd1.${payload}.${await this.signature(payload)}` };
  }

  async verify(token: string, now = new Date()): Promise<MissionDelegationClaims> {
    try {
      const parts = token.split(".");
      if (parts.length !== 3 || parts[0] !== "vnd1" || !parts[1] || !parts[2]) {
        throw new InvalidMissionDelegationError();
      }
      const expected = Buffer.from(await this.signature(parts[1]), "base64url");
      const received = Buffer.from(parts[2], "base64url");
      if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
        throw new InvalidMissionDelegationError();
      }
      const claims = claimsSchema.parse(JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")));
      const issuedAt = Date.parse(claims.issuedAt);
      const expiresAt = Date.parse(claims.expiresAt);
      if (issuedAt > now.getTime() + 30_000 || expiresAt <= now.getTime()
        || expiresAt - issuedAt <= 0 || expiresAt - issuedAt > 20 * 60_000) {
        throw new InvalidMissionDelegationError();
      }
      return claims;
    } catch (error) {
      if (error instanceof InvalidMissionDelegationError) throw error;
      throw new InvalidMissionDelegationError();
    }
  }

  private async signature(payload: string): Promise<string> {
    const secret = await this.secrets.getToken();
    if (Buffer.byteLength(secret) < 32) throw new Error("The mission delegation secret must contain at least 32 bytes.");
    return createHmac("sha256", secret).update(payload).digest("base64url");
  }
}

export function createMissionDelegation(
  env: NodeJS.ProcessEnv = process.env,
): MissionDelegation | undefined {
  if (env.HERMES_MCP_DELEGATION_SECRET_ID) {
    return new MissionDelegation(new SecretsManagerTokenProvider(
      new SecretsManagerClient({ region: env.AWS_REGION ?? "eu-west-1" }),
      env.HERMES_MCP_DELEGATION_SECRET_ID,
    ));
  }
  if (env.NODE_ENV !== "production" && env.HERMES_MCP_DELEGATION_SECRET) {
    if (Buffer.byteLength(env.HERMES_MCP_DELEGATION_SECRET) < 32) {
      throw new Error("The mission delegation secret must contain at least 32 bytes.");
    }
    return new MissionDelegation(new StaticTokenProvider(env.HERMES_MCP_DELEGATION_SECRET));
  }
  return undefined;
}
