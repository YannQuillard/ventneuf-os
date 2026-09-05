import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { GenerateMacCommand, KMSClient, VerifyMacCommand } from "@aws-sdk/client-kms";
import { z } from "zod";
import { StaticTokenProvider, type TokenProvider } from "./hermes.js";

const adapterSchema = z.enum(["repository-check", "orca-review", "codex-development", "claude-development"]);
const repositoryIdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/);
const targetSchema = z.object({
  deviceId: z.string().uuid(),
  repositoryId: repositoryIdSchema,
  adapters: z.array(adapterSchema).min(1).max(4),
}).strict();

const baseClaimsSchema = z.object({
  version: z.literal(1),
  issuer: z.literal("ventneuf-control-plane"),
  audience: z.literal("ventneuf-mcp"),
  delegationId: z.string().uuid(),
  serviceId: z.string().min(1).max(100),
  organizationId: z.string().uuid(),
  parentMissionId: z.string().uuid(),
  conversationId: z.string().uuid(),
  memberId: z.string().uuid(),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
}).strict();
const dispatchClaimsSchema = baseClaimsSchema.extend({
  capabilities: z.tuple([z.literal("mission:dispatch")]),
  targets: z.array(targetSchema).max(50),
}).strict();
const approvalClaimsSchema = baseClaimsSchema.extend({
  capabilities: z.tuple([z.literal("approval:decide")]),
  approvalId: z.string().uuid(),
}).strict();
const claimsSchema = z.union([dispatchClaimsSchema, approvalClaimsSchema]);

export type MissionDispatchTarget = z.infer<typeof targetSchema>;
export type MissionDelegationClaims = z.infer<typeof claimsSchema>;
export type MissionDispatchDelegationClaims = z.infer<typeof dispatchClaimsSchema>;
export type MissionApprovalDelegationClaims = z.infer<typeof approvalClaimsSchema>;

export interface MissionDelegationGrant {
  token: string;
  claims: MissionDispatchDelegationClaims;
}

export interface MissionApprovalDelegationGrant {
  token: string;
  claims: MissionApprovalDelegationClaims;
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
  issueApproval(input: {
    serviceId: string;
    organizationId: string;
    parentMissionId: string;
    conversationId: string;
    memberId: string;
    approvalId: string;
  }, now?: Date): Promise<MissionApprovalDelegationGrant>;
}

export class InvalidMissionDelegationError extends Error {
  constructor() {
    super("The mission delegation is invalid or expired.");
    this.name = "InvalidMissionDelegationError";
  }
}

export interface MissionDelegationMac {
  sign(message: Uint8Array): Promise<Uint8Array>;
  verify(message: Uint8Array, mac: Uint8Array): Promise<boolean>;
}

export class HmacMissionDelegationMac implements MissionDelegationMac {
  constructor(private readonly secrets: TokenProvider) {}

  async sign(message: Uint8Array): Promise<Uint8Array> {
    return createHmac("sha256", await this.secret()).update(message).digest();
  }

  async verify(message: Uint8Array, mac: Uint8Array): Promise<boolean> {
    const expected = await this.sign(message);
    return expected.length === mac.length && timingSafeEqual(expected, mac);
  }

  private async secret(): Promise<string> {
    const secret = await this.secrets.getToken();
    if (Buffer.byteLength(secret) < 32) throw new Error("The mission delegation secret must contain at least 32 bytes.");
    return secret;
  }
}

export class KmsMissionDelegationMac implements MissionDelegationMac {
  constructor(private readonly client: KMSClient, private readonly keyId: string) {}

  async sign(message: Uint8Array): Promise<Uint8Array> {
    const result = await this.client.send(new GenerateMacCommand({
      KeyId: this.keyId,
      MacAlgorithm: "HMAC_SHA_256",
      Message: message,
    }));
    if (!result.Mac) throw new Error("AWS KMS returned no mission delegation MAC.");
    return result.Mac;
  }

  async verify(message: Uint8Array, mac: Uint8Array): Promise<boolean> {
    const result = await this.client.send(new VerifyMacCommand({
      KeyId: this.keyId,
      MacAlgorithm: "HMAC_SHA_256",
      Message: message,
      Mac: mac,
    }));
    return result.MacValid === true;
  }
}

export class MissionDelegation implements MissionDelegationIssuer {
  constructor(
    private readonly macs: MissionDelegationMac,
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
    const claims = dispatchClaimsSchema.parse({
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
    return this.signClaims(claims);
  }

  async issueApproval(input: {
    serviceId: string;
    organizationId: string;
    parentMissionId: string;
    conversationId: string;
    memberId: string;
    approvalId: string;
  }, now = new Date()): Promise<MissionApprovalDelegationGrant> {
    const claims = approvalClaimsSchema.parse({
      version: 1,
      issuer: "ventneuf-control-plane",
      audience: "ventneuf-mcp",
      delegationId: randomUUID(),
      serviceId: input.serviceId,
      organizationId: input.organizationId,
      parentMissionId: input.parentMissionId,
      conversationId: input.conversationId,
      memberId: input.memberId,
      capabilities: ["approval:decide"],
      approvalId: input.approvalId,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.lifetimeMs).toISOString(),
    });
    return this.signClaims(claims);
  }

  private async signClaims<T extends MissionDelegationClaims>(claims: T): Promise<{ token: string; claims: T }> {
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const mac = await this.macs.sign(Buffer.from(payload, "utf8"));
    return { claims, token: `vnd1.${payload}.${Buffer.from(mac).toString("base64url")}` };
  }

  async verify(token: string, now = new Date()): Promise<MissionDelegationClaims> {
    try {
      const parts = token.split(".");
      if (parts.length !== 3 || parts[0] !== "vnd1" || !parts[1] || !parts[2]) {
        throw new InvalidMissionDelegationError();
      }
      const received = Buffer.from(parts[2], "base64url");
      if (!await this.macs.verify(Buffer.from(parts[1], "utf8"), received)) {
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
}

export function createMissionDelegation(
  env: NodeJS.ProcessEnv = process.env,
): MissionDelegation | undefined {
  if (env.HERMES_MCP_DELEGATION_KMS_KEY_ID) {
    return new MissionDelegation(new KmsMissionDelegationMac(
      new KMSClient({ region: env.AWS_REGION ?? "eu-west-1" }),
      env.HERMES_MCP_DELEGATION_KMS_KEY_ID,
    ));
  }
  if (env.NODE_ENV !== "production" && env.HERMES_MCP_DELEGATION_SECRET) {
    if (Buffer.byteLength(env.HERMES_MCP_DELEGATION_SECRET) < 32) {
      throw new Error("The mission delegation secret must contain at least 32 bytes.");
    }
    return new MissionDelegation(new HmacMissionDelegationMac(
      new StaticTokenProvider(env.HERMES_MCP_DELEGATION_SECRET),
    ));
  }
  return undefined;
}
