import { and, eq, gt, isNull } from "drizzle-orm";
import type { Database } from "./client.js";
import { deviceCredentials, deviceEnrollments, devices, members } from "./schema.js";

export class DeviceRuntimeRepository {
  constructor(private readonly database: Database) {}

  createEnrollment(input: {
    organizationId: string;
    externalSubject: string;
    tokenHash: string;
    expiresAt: Date;
  }) {
    return this.database.withOrganization(input.organizationId, async (transaction) => {
      let [member] = await transaction
        .select()
        .from(members)
        .where(and(
          eq(members.organizationId, input.organizationId),
          eq(members.externalSubject, input.externalSubject),
        ))
        .limit(1);
      if (!member) {
        [member] = await transaction
          .insert(members)
          .values({
            organizationId: input.organizationId,
            externalSubject: input.externalSubject,
            handle: input.externalSubject,
            displayName: "Member",
          })
          .onConflictDoNothing()
          .returning();
      }
      if (!member) {
        [member] = await transaction
          .select()
          .from(members)
          .where(and(
            eq(members.organizationId, input.organizationId),
            eq(members.externalSubject, input.externalSubject),
          ))
          .limit(1);
      }
      if (!member) throw new Error("Failed to resolve the authenticated member.");

      const [enrollment] = await transaction.insert(deviceEnrollments).values({
        organizationId: input.organizationId,
        memberId: member.id,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
      }).returning();
      if (!enrollment) throw new Error("Failed to create the device enrollment.");
      return enrollment;
    });
  }

  consumeEnrollment(input: {
    organizationId: string;
    tokenHash: string;
    credentialHash: string;
    deviceId: string;
    name: string;
    platform: string;
    now: Date;
  }) {
    return this.database.withOrganization(input.organizationId, async (transaction) => {
      const [enrollment] = await transaction
        .update(deviceEnrollments)
        .set({ consumedAt: input.now })
        .where(and(
          eq(deviceEnrollments.organizationId, input.organizationId),
          eq(deviceEnrollments.tokenHash, input.tokenHash),
          gt(deviceEnrollments.expiresAt, input.now),
          isNull(deviceEnrollments.consumedAt),
        ))
        .returning();
      if (!enrollment) return undefined;

      const [device] = await transaction.insert(devices).values({
        id: input.deviceId,
        organizationId: input.organizationId,
        memberId: enrollment.memberId,
        name: input.name,
        platform: input.platform,
        lastSeenAt: input.now,
      }).returning();
      if (!device) throw new Error("Failed to create the device.");
      await transaction.insert(deviceCredentials).values({
        organizationId: input.organizationId,
        deviceId: device.id,
        tokenHash: input.credentialHash,
        lastUsedAt: input.now,
      });
      return device;
    });
  }

  heartbeat(input: {
    organizationId: string;
    deviceId: string;
    credentialHash: string;
    now: Date;
  }) {
    return this.database.withOrganization(input.organizationId, async (transaction) => {
      const [authenticated] = await transaction
        .select({ deviceId: deviceCredentials.deviceId })
        .from(deviceCredentials)
        .innerJoin(devices, and(
          eq(devices.organizationId, deviceCredentials.organizationId),
          eq(devices.id, deviceCredentials.deviceId),
        ))
        .where(and(
          eq(deviceCredentials.organizationId, input.organizationId),
          eq(deviceCredentials.deviceId, input.deviceId),
          eq(deviceCredentials.tokenHash, input.credentialHash),
          isNull(deviceCredentials.revokedAt),
          isNull(devices.revokedAt),
        ))
        .limit(1);
      if (!authenticated) return undefined;

      const [device] = await transaction
        .update(devices)
        .set({ lastSeenAt: input.now, updatedAt: input.now })
        .where(and(
          eq(devices.organizationId, input.organizationId),
          eq(devices.id, input.deviceId),
          isNull(devices.revokedAt),
        ))
        .returning();
      if (!device) return undefined;

      await transaction
        .update(deviceCredentials)
        .set({ lastUsedAt: input.now })
        .where(and(
          eq(deviceCredentials.organizationId, input.organizationId),
          eq(deviceCredentials.deviceId, input.deviceId),
          eq(deviceCredentials.tokenHash, input.credentialHash),
          isNull(deviceCredentials.revokedAt),
        ));
      return device;
    });
  }
}
