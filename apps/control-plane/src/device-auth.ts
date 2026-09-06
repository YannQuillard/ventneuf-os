import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

export const postgresUuidSchema = z.string().regex(
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
);
const tokenSecret = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export function hashDeviceToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createEnrollmentToken(organizationId: string) {
  const token = `vnoe.${postgresUuidSchema.parse(organizationId)}.${randomBytes(32).toString("base64url")}`;
  return { token, tokenHash: hashDeviceToken(token) };
}

export function parseEnrollmentToken(token: string) {
  const [prefix, organizationId, secret, extra] = token.split(".");
  if (prefix !== "vnoe" || extra !== undefined) return undefined;
  const parsed = z.object({ organizationId: postgresUuidSchema, secret: tokenSecret }).safeParse({ organizationId, secret });
  return parsed.success ? { organizationId: parsed.data.organizationId } : undefined;
}

export function createDeviceCredential(organizationId: string, deviceId: string) {
  const token = [
    "vnod",
    postgresUuidSchema.parse(organizationId),
    postgresUuidSchema.parse(deviceId),
    randomBytes(32).toString("base64url"),
  ].join(".");
  return { token, tokenHash: hashDeviceToken(token) };
}

export function parseDeviceCredential(token: string) {
  const [prefix, organizationId, deviceId, secret, extra] = token.split(".");
  if (prefix !== "vnod" || extra !== undefined) return undefined;
  const parsed = z.object({ organizationId: postgresUuidSchema, deviceId: postgresUuidSchema, secret: tokenSecret }).safeParse({
    organizationId,
    deviceId,
    secret,
  });
  return parsed.success
    ? { organizationId: parsed.data.organizationId, deviceId: parsed.data.deviceId }
    : undefined;
}
