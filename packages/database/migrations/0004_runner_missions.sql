ALTER TABLE devices ADD COLUMN repositories jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE missions
  ADD COLUMN lease_owner uuid,
  ADD COLUMN lease_token_hash text,
  ADD COLUMN lease_expires_at timestamp with time zone,
  ADD COLUMN attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0);
--> statement-breakpoint
CREATE INDEX missions_device_claim_idx ON missions (organization_id, assigned_device_id, status, created_at);
