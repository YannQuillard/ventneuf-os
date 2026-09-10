CREATE TABLE mission_history (
  cursor bigserial PRIMARY KEY,
  organization_id uuid NOT NULL,
  mission_id uuid NOT NULL,
  event_id uuid NOT NULL,
  entry jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, mission_id) REFERENCES missions(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT mission_history_entry_size CHECK (octet_length(entry::text) <= 90000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX mission_history_event_unique ON mission_history(organization_id, mission_id, event_id);
--> statement-breakpoint
CREATE INDEX mission_history_cursor_idx ON mission_history(organization_id, mission_id, cursor);
--> statement-breakpoint
ALTER TABLE mission_history ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY mission_history_tenant_policy ON mission_history TO ventneuf_runtime
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON mission_history TO ventneuf_runtime;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE mission_history_cursor_seq TO ventneuf_runtime;
--> statement-breakpoint
REVOKE UPDATE ON mission_history FROM ventneuf_runtime;
