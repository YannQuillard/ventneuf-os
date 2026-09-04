CREATE TABLE "device_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"token_hash" text NOT NULL UNIQUE,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_enrollments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id"),
	CONSTRAINT "device_enrollments_organization_member_fk" FOREIGN KEY ("organization_id","member_id") REFERENCES "public"."members"("organization_id","id")
);
--> statement-breakpoint
CREATE INDEX "device_enrollments_expiry_idx" ON "device_enrollments" USING btree ("organization_id","expires_at");
--> statement-breakpoint
CREATE TABLE "device_credentials" (
	"organization_id" uuid NOT NULL,
	"device_id" uuid PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL UNIQUE,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_credentials_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id"),
	CONSTRAINT "device_credentials_organization_device_fk" FOREIGN KEY ("organization_id","device_id") REFERENCES "public"."devices"("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "device_enrollments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "device_enrollments_tenant_policy" ON "device_enrollments" TO ventneuf_runtime USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "device_credentials" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "device_credentials_tenant_policy" ON "device_credentials" TO ventneuf_runtime USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);
