CREATE TYPE "public"."workspace_conversation_kind" AS ENUM('private', 'topic', 'mission');--> statement-breakpoint
CREATE TABLE "projects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "public"."organizations"("id"),
  "owner_member_id" uuid NOT NULL,
  "name" text NOT NULL,
  "context" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "projects_organization_owner_fk" FOREIGN KEY ("organization_id", "owner_member_id") REFERENCES "public"."members"("organization_id", "id")
);--> statement-breakpoint
CREATE UNIQUE INDEX "projects_organization_id_unique" ON "projects" ("organization_id", "id");--> statement-breakpoint
CREATE INDEX "projects_owner_created_idx" ON "projects" ("organization_id", "owner_member_id", "created_at");--> statement-breakpoint
CREATE TABLE "project_members" (
  "organization_id" uuid NOT NULL REFERENCES "public"."organizations"("id"),
  "project_id" uuid NOT NULL,
  "member_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "project_members_project_id_member_id_pk" PRIMARY KEY("project_id", "member_id"),
  CONSTRAINT "project_members_organization_project_fk" FOREIGN KEY ("organization_id", "project_id") REFERENCES "projects"("organization_id", "id"),
  CONSTRAINT "project_members_organization_member_fk" FOREIGN KEY ("organization_id", "member_id") REFERENCES "members"("organization_id", "id")
);--> statement-breakpoint
CREATE INDEX "project_members_member_idx" ON "project_members" ("organization_id", "member_id", "project_id");--> statement-breakpoint
CREATE TABLE "project_repositories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "public"."organizations"("id"),
  "project_id" uuid NOT NULL,
  "device_id" uuid NOT NULL,
  "repository_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "project_repositories_organization_project_fk" FOREIGN KEY ("organization_id", "project_id") REFERENCES "projects"("organization_id", "id"),
  CONSTRAINT "project_repositories_organization_device_fk" FOREIGN KEY ("organization_id", "device_id") REFERENCES "devices"("organization_id", "id")
);--> statement-breakpoint
CREATE UNIQUE INDEX "project_repositories_project_device_repository_unique" ON "project_repositories" ("project_id", "device_id", "repository_id");--> statement-breakpoint
CREATE INDEX "project_repositories_project_idx" ON "project_repositories" ("organization_id", "project_id");--> statement-breakpoint
ALTER TABLE "conversations"
  ADD COLUMN "project_id" uuid,
  ADD COLUMN "parent_conversation_id" uuid,
  ADD COLUMN "mission_id" uuid,
  ADD COLUMN "kind" "workspace_conversation_kind" NOT NULL DEFAULT 'private',
  ADD COLUMN "is_primary" boolean NOT NULL DEFAULT false,
  ADD COLUMN "memory_epoch" uuid NOT NULL DEFAULT gen_random_uuid();--> statement-breakpoint
WITH ranked AS (
  SELECT "id", row_number() OVER (
    PARTITION BY "organization_id", "owner_member_id" ORDER BY "created_at", "id"
  ) AS position
  FROM "conversations"
  WHERE "owner_member_id" IS NOT NULL
)
UPDATE "conversations" AS conversation
SET "is_primary" = true
FROM ranked
WHERE conversation."id" = ranked."id" AND ranked.position = 1;--> statement-breakpoint
ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_organization_project_fk" FOREIGN KEY ("organization_id", "project_id") REFERENCES "projects"("organization_id", "id"),
  ADD CONSTRAINT "conversations_organization_parent_fk" FOREIGN KEY ("organization_id", "parent_conversation_id") REFERENCES "conversations"("organization_id", "id"),
  ADD CONSTRAINT "conversations_organization_mission_fk" FOREIGN KEY ("organization_id", "mission_id") REFERENCES "missions"("organization_id", "id");--> statement-breakpoint
CREATE INDEX "conversations_project_idx" ON "conversations" ("organization_id", "project_id", "created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_primary_owner_unique" ON "conversations" ("organization_id", "owner_member_id") WHERE "is_primary" AND "owner_member_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_mission_unique" ON "conversations" ("organization_id", "mission_id") WHERE "mission_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE "conversation_grants" (
  "organization_id" uuid NOT NULL REFERENCES "public"."organizations"("id"),
  "conversation_id" uuid NOT NULL,
  "member_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "conversation_grants_conversation_id_member_id_pk" PRIMARY KEY("conversation_id", "member_id"),
  CONSTRAINT "conversation_grants_organization_conversation_fk" FOREIGN KEY ("organization_id", "conversation_id") REFERENCES "conversations"("organization_id", "id"),
  CONSTRAINT "conversation_grants_organization_member_fk" FOREIGN KEY ("organization_id", "member_id") REFERENCES "members"("organization_id", "id")
);--> statement-breakpoint
CREATE INDEX "conversation_grants_member_idx" ON "conversation_grants" ("organization_id", "member_id", "conversation_id");--> statement-breakpoint
ALTER TABLE "missions" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_organization_project_fk" FOREIGN KEY ("organization_id", "project_id") REFERENCES "projects"("organization_id", "id");--> statement-breakpoint
CREATE INDEX "missions_project_created_idx" ON "missions" ("organization_id", "project_id", "created_at");--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "projects", "project_members", "project_repositories", "conversation_grants" TO ventneuf_runtime;--> statement-breakpoint
ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "projects_tenant_policy" ON "projects" TO ventneuf_runtime USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "project_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "project_members_tenant_policy" ON "project_members" TO ventneuf_runtime USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "project_repositories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "project_repositories_tenant_policy" ON "project_repositories" TO ventneuf_runtime USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "conversation_grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "conversation_grants_tenant_policy" ON "conversation_grants" TO ventneuf_runtime USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);
