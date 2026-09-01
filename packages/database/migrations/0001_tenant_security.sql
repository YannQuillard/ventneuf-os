DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ventneuf_runtime') THEN
    CREATE ROLE ventneuf_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "channel_members" ADD COLUMN "organization_id" uuid NOT NULL REFERENCES "organizations"("id");--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "organization_id" uuid NOT NULL REFERENCES "organizations"("id");--> statement-breakpoint
CREATE UNIQUE INDEX "members_organization_id_unique" ON "members" ("organization_id", "id");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_organization_id_unique" ON "devices" ("organization_id", "id");--> statement-breakpoint
CREATE UNIQUE INDEX "channels_organization_id_unique" ON "channels" ("organization_id", "id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_organization_id_unique" ON "conversations" ("organization_id", "id");--> statement-breakpoint
ALTER TABLE "channel_members" DROP CONSTRAINT "channel_members_channel_id_channels_id_fk";--> statement-breakpoint
ALTER TABLE "channel_members" DROP CONSTRAINT "channel_members_member_id_members_id_fk";--> statement-breakpoint
ALTER TABLE "devices" DROP CONSTRAINT "devices_member_id_members_id_fk";--> statement-breakpoint
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_channel_id_channels_id_fk";--> statement-breakpoint
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_owner_member_id_members_id_fk";--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_conversation_id_conversations_id_fk";--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_member_id_members_id_fk";--> statement-breakpoint
ALTER TABLE "missions" DROP CONSTRAINT "missions_conversation_id_conversations_id_fk";--> statement-breakpoint
ALTER TABLE "missions" DROP CONSTRAINT "missions_requested_by_member_id_members_id_fk";--> statement-breakpoint
ALTER TABLE "missions" DROP CONSTRAINT "missions_assigned_device_id_devices_id_fk";--> statement-breakpoint
ALTER TABLE "channel_members" ADD CONSTRAINT "channel_members_organization_channel_fk" FOREIGN KEY ("organization_id", "channel_id") REFERENCES "channels"("organization_id", "id");--> statement-breakpoint
ALTER TABLE "channel_members" ADD CONSTRAINT "channel_members_organization_member_fk" FOREIGN KEY ("organization_id", "member_id") REFERENCES "members"("organization_id", "id");--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_organization_member_fk" FOREIGN KEY ("organization_id", "member_id") REFERENCES "members"("organization_id", "id");--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organization_channel_fk" FOREIGN KEY ("organization_id", "channel_id") REFERENCES "channels"("organization_id", "id");--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organization_owner_fk" FOREIGN KEY ("organization_id", "owner_member_id") REFERENCES "members"("organization_id", "id");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_organization_conversation_fk" FOREIGN KEY ("organization_id", "conversation_id") REFERENCES "conversations"("organization_id", "id");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_organization_member_fk" FOREIGN KEY ("organization_id", "member_id") REFERENCES "members"("organization_id", "id");--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_organization_conversation_fk" FOREIGN KEY ("organization_id", "conversation_id") REFERENCES "conversations"("organization_id", "id");--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_organization_requester_fk" FOREIGN KEY ("organization_id", "requested_by_member_id") REFERENCES "members"("organization_id", "id");--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_organization_device_fk" FOREIGN KEY ("organization_id", "assigned_device_id") REFERENCES "devices"("organization_id", "id");--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO ventneuf_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ventneuf_runtime;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ventneuf_runtime;--> statement-breakpoint
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "organizations_tenant_policy" ON "organizations" TO ventneuf_runtime USING ("id" = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK ("id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "members_tenant_policy" ON "members" TO ventneuf_runtime USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "devices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "devices_tenant_policy" ON "devices" TO ventneuf_runtime USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "channels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "channels_tenant_policy" ON "channels" TO ventneuf_runtime USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "channel_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "channel_members_tenant_policy" ON "channel_members" TO ventneuf_runtime USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "conversations_tenant_policy" ON "conversations" TO ventneuf_runtime USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "messages_tenant_policy" ON "messages" TO ventneuf_runtime USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "missions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "missions_tenant_policy" ON "missions" TO ventneuf_runtime USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);
