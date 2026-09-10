# Mission history and workspace

The reviewable UI is at `/prototype/mission-lab`. It uses anonymized, paraphrased incidents from the initial performance mission; it is not a transcript export or a live control surface. Its merge request illustrates the human-decision state. The current production workspace also gains compact non-actionable approvals and a paginated History tab.

The preview keeps the Hermes conversation and composer alongside the execution view. On narrow screens, the conversation and activity switch views while the composer stays available. Preview messages remain in component state and never reach a live mission. The UI does not synthesize a mission plan: a plan may only be shown when an explicit native plan or task-list event provides it. The absence of recent activity is an unknown state, not evidence of a blocked or finishing mission.

## Saved activity

The native supervisor projects observable Claude and Codex activity before the recent snapshot evicts items. Messages, tool starts/results, plans, changes, hooks and available subagent relationships become immutable records. Running text/output receives coalesced checkpoints every ten seconds and on orderly shutdown. Provider reasoning and configuration are excluded. This is a normalized observable journal, not a lossless native protocol archive.

The runner writes private atomic JSON batches under the mission's `history-pending` directory. The bridge combines them into requests of at most 50 events and 90,000 bytes. It removes files only after explicit acknowledgement of their stable event IDs. Lost responses retry the same IDs. Cleanup retains any mission with pending files or a local persistence-error marker. Maintenance retries one mission batch per tick, including after completion, without restarting agent work. Native runtime session files remain owned by the upstream harness.

The database stores records in a separate `mission_history` table. The 80-item recent snapshot and existing lifecycle/approval events remain independent. A mission lock serializes insertion; identical retries are acknowledged and conflicting rewrites fail. The database cursor defines upload order, while each event carries its observation timestamp, provider, session, item ID and optional parent ID. Repeated item IDs are lifecycle updates or checkpoints, not duplicate transport records.

Each saved event retains up to 32,000 UTF-8 bytes of displayed text, with explicit truncation. The journal currently has no age-based expiry; it persists for the mission lifetime and is inaccessible after conversation soft deletion. Physical mission deletion cascades to the journal. Large artifact/object storage, archive expiry policies, indexed text search and native-session backfill are follow-up work. This change does not recover entries already evicted from old snapshots. Provider events not exposed by the native stream cannot be reconstructed.

## Authority

Ingestion requires the enrolled device credential, assignment to the named mission, a previously started execution, the matching harness, a non-deleted conversation and current workspace authority. This telemetry-only operation intentionally does not require a live execution lease: terminal missions must be able to finish uploading after a network outage. It cannot execute tools, renew authority or change mission status. Revoked devices and withdrawn project access fail closed; unuploaded local files are retained for diagnosis.

Reads require the authenticated member's current conversation access and a mission belonging to that exact conversation. Tenant row-level security applies to the table. Requests page forward from a validated cursor, with 50 records per page; the ordinary SSE snapshot never embeds the complete journal. Reads are available through the control plane and the web proxy at `/api/workspace/conversations/:conversationId/missions/:missionId/history?after=0`.

Known credential patterns, credential-bearing connection URLs, private keys and local private paths are scrubbed before persistence. Redaction is best-effort and does not make arbitrary agent output public-safe. History retains the mission's access controls.

## Rollout

1. Run migration `0011_mission_history.sql` with the migrator identity.
2. Deploy the control plane and web application.
3. Update the installed runner after active native work has finished.
4. Validate a mission with a simulated upload outage, approval resumption and completion; confirm history remains readable and pending files drain before cleanup.

An older runner continues publishing recent snapshots. A new runner against an older control plane retains pending history locally; recent snapshot publication still proceeds. No production migration, deployment, runner restart or historical import is performed by this patch.

## Verification

The tests exercise snapshot eviction, long output, redaction, interrupted-stream checkpoints, duplicate retries, immutable records, pagination, member isolation, deletion and invalid credentials. The interactive preview is checked at desktop and mobile widths, including incident filtering and distinct Hermes/human decision states.
