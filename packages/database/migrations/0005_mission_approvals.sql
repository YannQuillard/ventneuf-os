CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled', 'expired');
--> statement-breakpoint
CREATE TYPE "public"."approval_route" AS ENUM('automatic', 'hermes', 'human');
--> statement-breakpoint
CREATE TYPE "public"."approval_decider_type" AS ENUM('system', 'service', 'user');
--> statement-breakpoint
CREATE TYPE "public"."approval_action_category" AS ENUM('repository.write', 'development.command', 'network.access', 'pull_request.create', 'pull_request.merge', 'deployment.apply', 'connector.write');
--> statement-breakpoint
CREATE TABLE "mission_approvals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "public"."organizations"("id"),
  "mission_id" uuid NOT NULL,
  "review_mission_id" uuid,
  "request_id" uuid NOT NULL,
  "action_category" "approval_action_category" NOT NULL,
  "action_target" text NOT NULL,
  "arguments_digest" text NOT NULL CHECK ("arguments_digest" ~ '^[a-f0-9]{64}$'),
  "summary" text NOT NULL,
  "expected_effect" text NOT NULL,
  "reason" text NOT NULL,
  "evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "route" "approval_route" NOT NULL,
  "status" "approval_status" NOT NULL,
  "requested_by_lease_owner" uuid NOT NULL,
  "requested_by_lease_token_hash" text NOT NULL,
  "resume_context" jsonb NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "decided_by_type" "approval_decider_type",
  "decided_by_id" text,
  "rationale" text,
  "decided_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "mission_approvals_lease_hash_check" CHECK ("requested_by_lease_token_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "mission_approvals_decision_check" CHECK (
    "status" NOT IN ('approved', 'rejected') OR (
      "decided_by_type" IS NOT NULL AND "decided_by_id" IS NOT NULL
      AND "rationale" IS NOT NULL AND "decided_at" IS NOT NULL
    )
  ),
  CONSTRAINT "mission_approvals_organization_mission_fk" FOREIGN KEY ("organization_id", "mission_id") REFERENCES "public"."missions"("organization_id", "id"),
  CONSTRAINT "mission_approvals_organization_review_mission_fk" FOREIGN KEY ("organization_id", "review_mission_id") REFERENCES "public"."missions"("organization_id", "id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "mission_approvals_organization_id_unique" ON "mission_approvals" ("organization_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX "mission_approvals_request_unique" ON "mission_approvals" ("organization_id", "mission_id", "request_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "mission_approvals_pending_mission_unique" ON "mission_approvals" ("organization_id", "mission_id") WHERE "status" = 'pending';
--> statement-breakpoint
CREATE INDEX "mission_approvals_member_queue_idx" ON "mission_approvals" ("organization_id", "route", "status", "created_at");
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "mission_approvals" TO ventneuf_runtime;
--> statement-breakpoint
ALTER TABLE "mission_approvals" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "mission_approvals_tenant_policy" ON "mission_approvals" TO ventneuf_runtime USING ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.organization_id', true), '')::uuid);
