CREATE TABLE "github_connections" (
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "member_id" uuid NOT NULL,
  "github_user_id" text NOT NULL,
  "login" text NOT NULL,
  "credential_ciphertext" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "github_connections_organization_id_member_id_pk" PRIMARY KEY("organization_id", "member_id"),
  CONSTRAINT "github_connections_organization_member_fk" FOREIGN KEY ("organization_id", "member_id") REFERENCES "members"("organization_id", "id")
);--> statement-breakpoint
CREATE UNIQUE INDEX "github_connections_organization_user_unique" ON "github_connections" ("organization_id", "github_user_id");--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "github_connections" TO ventneuf_runtime;--> statement-breakpoint
ALTER TABLE "github_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "github_connections_tenant_policy" ON "github_connections" TO ventneuf_runtime USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);
