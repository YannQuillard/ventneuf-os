import {
  check,
  foreignKey,
  index,
  jsonb,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const memberRole = pgEnum("member_role", ["owner", "member"]);
export const channelKind = pgEnum("channel_kind", ["project", "shared", "private"]);
export const messageRole = pgEnum("message_role", ["user", "assistant", "system", "tool"]);
export const missionStatus = pgEnum("mission_status", [
  "queued",
  "running",
  "waiting_for_approval",
  "completed",
  "failed",
  "cancelled",
]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  ...timestamps,
});

export const members = pgTable(
  "members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    externalSubject: text("external_subject").notNull(),
    handle: text("handle").notNull(),
    displayName: text("display_name").notNull(),
    role: memberRole("role").default("member").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("members_organization_id_unique").on(table.organizationId, table.id),
    uniqueIndex("members_organization_subject_unique").on(table.organizationId, table.externalSubject),
    uniqueIndex("members_organization_handle_unique").on(table.organizationId, table.handle),
  ],
);

export const devices = pgTable(
  "devices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    memberId: uuid("member_id").notNull(),
    name: text("name").notNull(),
    platform: text("platform").notNull(),
    repositories: jsonb("repositories").$type<Array<{ id: string; name: string; orcaReview?: boolean }>>().default([]).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("devices_organization_id_unique").on(table.organizationId, table.id),
    foreignKey({
      columns: [table.organizationId, table.memberId],
      foreignColumns: [members.organizationId, members.id],
      name: "devices_organization_member_fk",
    }),
    index("devices_member_idx").on(table.memberId),
  ],
);

export const deviceEnrollments = pgTable(
  "device_enrollments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    memberId: uuid("member_id").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.organizationId, table.memberId],
      foreignColumns: [members.organizationId, members.id],
      name: "device_enrollments_organization_member_fk",
    }),
    index("device_enrollments_expiry_idx").on(table.organizationId, table.expiresAt),
  ],
);

export const deviceCredentials = pgTable(
  "device_credentials",
  {
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    deviceId: uuid("device_id").primaryKey(),
    tokenHash: text("token_hash").notNull().unique(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.organizationId, table.deviceId],
      foreignColumns: [devices.organizationId, devices.id],
      name: "device_credentials_organization_device_fk",
    }),
  ],
);

export const channels = pgTable(
  "channels",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    kind: channelKind("kind").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("channels_organization_id_unique").on(table.organizationId, table.id),
    uniqueIndex("channels_organization_slug_unique").on(table.organizationId, table.slug),
  ],
);

export const channelMembers = pgTable(
  "channel_members",
  {
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    channelId: uuid("channel_id").notNull(),
    memberId: uuid("member_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.channelId, table.memberId] }),
    foreignKey({
      columns: [table.organizationId, table.channelId],
      foreignColumns: [channels.organizationId, channels.id],
      name: "channel_members_organization_channel_fk",
    }),
    foreignKey({
      columns: [table.organizationId, table.memberId],
      foreignColumns: [members.organizationId, members.id],
      name: "channel_members_organization_member_fk",
    }),
  ],
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    channelId: uuid("channel_id"),
    ownerMemberId: uuid("owner_member_id"),
    hermesContextId: text("hermes_context_id"),
    title: text("title"),
    ...timestamps,
  },
  (table) => [
    check(
      "conversations_destination_check",
      sql`(${table.channelId} is not null) <> (${table.ownerMemberId} is not null)`,
    ),
    uniqueIndex("conversations_organization_id_unique").on(table.organizationId, table.id),
    foreignKey({
      columns: [table.organizationId, table.channelId],
      foreignColumns: [channels.organizationId, channels.id],
      name: "conversations_organization_channel_fk",
    }),
    foreignKey({
      columns: [table.organizationId, table.ownerMemberId],
      foreignColumns: [members.organizationId, members.id],
      name: "conversations_organization_owner_fk",
    }),
    index("conversations_channel_idx").on(table.channelId),
    index("conversations_owner_idx").on(table.ownerMemberId),
  ],
);

export const messages = pgTable(
  "messages",
  {
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id").notNull(),
    memberId: uuid("member_id"),
    role: messageRole("role").notNull(),
    content: text("content").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.organizationId, table.conversationId],
      foreignColumns: [conversations.organizationId, conversations.id],
      name: "messages_organization_conversation_fk",
    }),
    foreignKey({
      columns: [table.organizationId, table.memberId],
      foreignColumns: [members.organizationId, members.id],
      name: "messages_organization_member_fk",
    }),
    index("messages_conversation_created_idx").on(table.conversationId, table.createdAt),
  ],
);

export const missions = pgTable(
  "missions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    conversationId: uuid("conversation_id").notNull(),
    requestedByMemberId: uuid("requested_by_member_id").notNull(),
    assignedDeviceId: uuid("assigned_device_id"),
    leaseOwner: uuid("lease_owner"),
    leaseTokenHash: text("lease_token_hash"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    attempts: integer("attempts").default(0).notNull(),
    status: missionStatus("status").default("queued").notNull(),
    goal: text("goal").notNull(),
    context: jsonb("context").$type<Record<string, unknown>>().default({}).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("missions_organization_id_unique").on(table.organizationId, table.id),
    foreignKey({
      columns: [table.organizationId, table.conversationId],
      foreignColumns: [conversations.organizationId, conversations.id],
      name: "missions_organization_conversation_fk",
    }),
    foreignKey({
      columns: [table.organizationId, table.requestedByMemberId],
      foreignColumns: [members.organizationId, members.id],
      name: "missions_organization_requester_fk",
    }),
    foreignKey({
      columns: [table.organizationId, table.assignedDeviceId],
      foreignColumns: [devices.organizationId, devices.id],
      name: "missions_organization_device_fk",
    }),
    index("missions_status_idx").on(table.organizationId, table.status),
    index("missions_device_claim_idx").on(table.organizationId, table.assignedDeviceId, table.status, table.createdAt),
    check("missions_attempts_check", sql`${table.attempts} >= 0`),
  ],
);

export const missionEvents = pgTable(
  "mission_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    missionId: uuid("mission_id").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().default({}).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.organizationId, table.missionId],
      foreignColumns: [missions.organizationId, missions.id],
      name: "mission_events_organization_mission_fk",
    }),
    index("mission_events_mission_created_idx").on(table.missionId, table.createdAt, table.id),
  ],
);
