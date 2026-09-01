import {
  check,
  index,
  jsonb,
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
    uniqueIndex("members_organization_subject_unique").on(table.organizationId, table.externalSubject),
    uniqueIndex("members_organization_handle_unique").on(table.organizationId, table.handle),
  ],
);

export const devices = pgTable(
  "devices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    memberId: uuid("member_id").notNull().references(() => members.id),
    name: text("name").notNull(),
    platform: text("platform").notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("devices_member_idx").on(table.memberId)],
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
  (table) => [uniqueIndex("channels_organization_slug_unique").on(table.organizationId, table.slug)],
);

export const channelMembers = pgTable(
  "channel_members",
  {
    channelId: uuid("channel_id").notNull().references(() => channels.id),
    memberId: uuid("member_id").notNull().references(() => members.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.channelId, table.memberId] })],
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    channelId: uuid("channel_id").references(() => channels.id),
    ownerMemberId: uuid("owner_member_id").references(() => members.id),
    hermesContextId: text("hermes_context_id"),
    title: text("title"),
    ...timestamps,
  },
  (table) => [
    check(
      "conversations_destination_check",
      sql`(${table.channelId} is not null) <> (${table.ownerMemberId} is not null)`,
    ),
    index("conversations_channel_idx").on(table.channelId),
    index("conversations_owner_idx").on(table.ownerMemberId),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id").notNull().references(() => conversations.id),
    memberId: uuid("member_id").references(() => members.id),
    role: messageRole("role").notNull(),
    content: text("content").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("messages_conversation_created_idx").on(table.conversationId, table.createdAt)],
);

export const missions = pgTable(
  "missions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    conversationId: uuid("conversation_id").notNull().references(() => conversations.id),
    requestedByMemberId: uuid("requested_by_member_id").notNull().references(() => members.id),
    assignedDeviceId: uuid("assigned_device_id").references(() => devices.id),
    status: missionStatus("status").default("queued").notNull(),
    goal: text("goal").notNull(),
    context: jsonb("context").$type<Record<string, unknown>>().default({}).notNull(),
    ...timestamps,
  },
  (table) => [index("missions_status_idx").on(table.organizationId, table.status)],
);
