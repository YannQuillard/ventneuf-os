CREATE UNIQUE INDEX "missions_organization_id_unique" ON "missions" ("organization_id", "id");
--> statement-breakpoint
CREATE TABLE "mission_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"mission_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mission_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id"),
	CONSTRAINT "mission_events_organization_mission_fk" FOREIGN KEY ("organization_id","mission_id") REFERENCES "public"."missions"("organization_id","id")
);
--> statement-breakpoint
CREATE INDEX "mission_events_mission_created_idx" ON "mission_events" USING btree ("mission_id","created_at","id");
--> statement-breakpoint
ALTER TABLE "mission_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "mission_events_tenant_policy" ON "mission_events" TO ventneuf_runtime USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);
