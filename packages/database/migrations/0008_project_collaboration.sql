ALTER TABLE "conversations" ADD COLUMN "is_project_general" boolean NOT NULL DEFAULT false;--> statement-breakpoint
WITH created AS (
  INSERT INTO "conversations" ("organization_id", "owner_member_id", "project_id", "kind", "is_project_general", "title")
  SELECT "organization_id", "owner_member_id", "id", 'topic', true, 'General'
  FROM "projects"
  RETURNING "organization_id", "id", "project_id", "owner_member_id"
)
INSERT INTO "conversation_grants" ("organization_id", "conversation_id", "member_id")
SELECT created."organization_id", created."id", project_members."member_id"
FROM created
JOIN "project_members" ON project_members."organization_id" = created."organization_id"
  AND project_members."project_id" = created."project_id";--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_project_general_unique" ON "conversations" ("organization_id", "project_id") WHERE "is_project_general";--> statement-breakpoint
CREATE UNIQUE INDEX "messages_organization_id_unique" ON "messages" ("organization_id", "id");--> statement-breakpoint
CREATE TABLE "member_notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "public"."organizations"("id"),
  "member_id" uuid NOT NULL,
  "actor_member_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "conversation_id" uuid NOT NULL,
  "message_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "summary" text NOT NULL,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "member_notifications_member_fk" FOREIGN KEY ("organization_id", "member_id") REFERENCES "members"("organization_id", "id"),
  CONSTRAINT "member_notifications_actor_fk" FOREIGN KEY ("organization_id", "actor_member_id") REFERENCES "members"("organization_id", "id"),
  CONSTRAINT "member_notifications_project_fk" FOREIGN KEY ("organization_id", "project_id") REFERENCES "projects"("organization_id", "id"),
  CONSTRAINT "member_notifications_conversation_fk" FOREIGN KEY ("organization_id", "conversation_id") REFERENCES "conversations"("organization_id", "id"),
  CONSTRAINT "member_notifications_message_fk" FOREIGN KEY ("organization_id", "message_id") REFERENCES "messages"("organization_id", "id")
);--> statement-breakpoint
CREATE UNIQUE INDEX "member_notifications_message_member_unique" ON "member_notifications" ("message_id", "member_id");--> statement-breakpoint
CREATE INDEX "member_notifications_inbox_idx" ON "member_notifications" ("organization_id", "member_id", "created_at");--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "member_notifications" TO ventneuf_runtime;--> statement-breakpoint
ALTER TABLE "member_notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "member_notifications_tenant_policy" ON "member_notifications" TO ventneuf_runtime USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);
