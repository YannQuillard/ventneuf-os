# ventneuf.os

ventneuf.os is an open agentic workspace for conversations, knowledge, missions, devices, terminals, and connectors.

The product provides one interface where a team can talk to an orchestrator, delegate work to coding agents, follow live execution, review artifacts, and preserve durable project knowledge.

## Status

The repository is under active development. Current foundations include:

- an invite-only Next.js workspace authenticated through OpenID Connect;
- private, durable Hermes conversations backed by PostgreSQL;
- idempotent asynchronous mission dispatch and background processing;
- persisted Hermes lifecycle and tool events with authenticated live delivery;
- one-time, tenant-scoped device enrollment and revocable runner credentials;
- a macOS runner bridge with loopback-only onboarding, Keychain storage, and outbound heartbeats;
- device-assigned read-only repository checks with fenced leases, bounded recovery, and durable results;
- policy-routed durable approval records with Hermes decisions, member escalation, and session resumption data;
- a separately deployable control plane that communicates with Hermes over A2A;
- authenticated remote and local MCP boundaries for agent tools;
- identity, device, mission, and capability authorization primitives;
- a messaging-oriented interface with project channels and private agent conversations.

The current interface can send a request to Hermes, persist it before execution, queue the corresponding mission, follow its live tool activity, stop it, and display the durable response. It can also discover a local runner, enroll the Mac without exposing credentials, and show its cloud heartbeat status. Registered repositories expose a Check action that queues a read-only mission for their device and returns progress and results in the private conversation. Coding-agent execution, live terminal sessions, project channels, and production connectors remain under development.

The production infrastructure and private operational documentation are intentionally maintained outside this public repository.

## Repository

```text
apps/web                 Web and PWA product experience
apps/control-plane       Remote MCP and agent control-plane service
apps/runner              Local runner, loopback onboarding, and device heartbeat
packages/domain          Shared identity and authorization rules
packages/database        PostgreSQL schema and tenant-scoped repositories
packages/mcp-server      Local MCP and runner-bridge foundations
```

## Architecture

The web application is a browser-facing backend-for-frontend. It owns the login session but does not execute agent work. Authenticated requests are forwarded to the control plane, which enforces capabilities, persists conversations, dispatches durable missions, and communicates with Hermes. Long-running missions execute outside web request handlers.

MCP is the tool boundary for coding agents and future device runners. A2A is currently the service-to-service boundary between the control plane and Hermes. Human, device, runner, and mission identities remain distinct throughout the system.

### Remote Hermes MCP contract

The authenticated remote `hermes.ask` tool queues a durable message in the caller's private conversation. It returns `missionId`, `conversationId`, and `status` immediately; the eventual reply appears in the conversation through the existing message and event APIs. It does not return an inline Hermes answer. An optional `contextId` must match that member's existing Hermes context; unknown or foreign contexts are rejected. Device and mission principals cannot use this private user tool. The worker supplies the conversation-scoped upstream session key. The local MCP prototype has a separate contract.

The remote `mission.dispatch` tool accepts an explicit objective, enrolled device, registered repository, and bounded read-only adapter. A direct user call creates a durable mission only when the authenticated member owns the device and the runner has advertised the requested repository and adapter. The objective travels in the claimed mission and reaches the isolated Codex supervisor without shell interpolation.

Hermes authenticates as a distinct service principal with identity inspection, mission dispatch, and approval decision capabilities. Each service operation additionally requires a short signed delegation issued for its active parent Hermes mission. A dispatch grant fixes the organization, initiating member, private conversation, service identity, eligible device/repository/adapter tuples, and expiry. An approval grant fixes those identities and one exact approval request. The database revalidates the active parent, current device ownership, and mission authority. Stable request IDs make retries idempotent; changing an operation or decision under the same ID is rejected. Delegation metadata and parent/child events are durable, while bearer values are never persisted.

### Durable mission approvals

Migration `0005_mission_approvals.sql` adds tenant-scoped approval records for exact action categories, targets, argument digests, evidence, policy routes, decisions, expiry, and agent session references. A request must authenticate both the enrolled device and the active mission lease. The control plane then permits a pre-authorized action, starts an internal Hermes review, routes directly to the initiating member, or rejects the action according to the mission authority.

Waiting clears the execution lease and persists `waiting_for_approval`. Hermes receives a separate parent-scoped `approval.decide` delegation and may approve, reject, or escalate. Human decisions use the authenticated approval endpoint and are ownership-checked in the database; conversation text is not an approval. A final decision requeues the mission, and a fresh claim returns the exact decision plus the original Codex or Claude session reference. The runner revalidates approved grants against current policy before resumption. Cancellation, device revocation, policy changes, and expiry invalidate applicable grants, and all transitions produce mission audit events.

## Roadmap

The next product milestones are:

1. mission retries, latency optimization, and operational hardening;
2. configurable workspaces, project channels, private conversations, and memberships;
3. authorized knowledge tools over MCP;
4. Orca integration behind the runner adapter and mission-scoped tool credentials;
5. scoped local execution, live terminal events, browser evidence, and agent-native approval capture;
6. GitHub, AWS, and project-management connectors;
7. policy-based agent and model routing with usage and cost attribution;
8. automated member and device onboarding;
9. a reusable self-hosted distribution with infrastructure documentation.

The target end-to-end workflow is to ask Hermes from a phone, dispatch work to an authorized device, follow its execution, review evidence, and receive a pull request without exposing the device directly to the Internet.

## Development

Requirements:

- Node.js 24 LTS;
- npm 11 or newer.

```bash
npm install
npm run typecheck
npm test
npm run build
npm run dev
```

The control plane fails closed in production unless its token verifier is completely configured. Local development requires an explicit `VENTNEUF_DEV_TOKEN` and must never reuse production credentials. Hermes MCP authentication is optional until its connector is deployed, but its service authentication and delegation signing must always be configured together. Production accepts `HERMES_MCP_SERVICE_SECRET_ID` plus `HERMES_MCP_DELEGATION_KMS_KEY_ID`; local development may instead use the explicit raw `HERMES_MCP_SERVICE_TOKEN` and `HERMES_MCP_DELEGATION_SECRET`. Both modes require `HERMES_MCP_SERVICE_ID` and `VENTNEUF_ORGANIZATION_ID`.

To run the macOS runner during development:

```bash
VENTNEUF_CONTROL_PLANE_URL=https://control-plane.example.com npm run dev --workspace @ventneuf/runner
```

To install the compiled runner as a persistent per-user macOS service:

```bash
VENTNEUF_CONTROL_PLANE_URL=https://control-plane.example.com npm run install-service --workspace @ventneuf/runner
```

The installer copies the compiled runner into the current user's Application Support directory and registers a `launchd` agent that starts at login and restarts after failure. The runner binds only to `127.0.0.1`, accepts configured web origins, stores its device credential in the macOS Keychain, and makes outbound-only requests to the control plane. Configure `VENTNEUF_WEB_ORIGINS` as a comma-separated allowlist when the web application is not running on `http://localhost:3000`.

### Read-only runner missions

Apply migration `0004_runner_missions.sql` before deploying the updated control plane, then rebuild and reinstall the runner service. Store local repository registrations outside the installation directory in `~/.config/ventneuf.os/repositories.json`, or set `VENTNEUF_REPOSITORIES_FILE` to an absolute configuration-file path when starting or installing the runner:

```json
[
  { "id": "sample", "name": "Sample project", "path": "/absolute/path/to/repository" }
]
```

Use your actual repository path locally; never commit that configuration. The runner reloads it on each poll and publishes repository IDs, display names, and enabled review capabilities. Paths remain local. A missing file registers no repositories; invalid configuration stops mission polling until corrected. The web device list offers a **Check** action for each registered repository on an online device. The result appears in the private conversation.

This first adapter checks directory accessibility, counts at most 10,000 top-level entries, and checks for Git metadata. It does not read source contents, recurse into directories, invoke a shell, or execute repository code. Removing a registration prevents execution of a queued mission for that repository.

Claims are serialized per device. Each attempt receives a 60-second lease bound to the device, runner process, and mission; only the token hash is persisted. Progress renews the lease, reports are idempotent by event ID, and a metadata check receives at most three attempts. Cancellation rejects further reports, and completion persists the result and assistant message in one transaction. The check adapter has a cooperative 10-second timeout. Cancellation fences results immediately; an already-running check can finish its bounded metadata scan.

### Read-only Orca reviews

The **Review** action runs Codex in an owned Orca terminal and returns its review to the private conversation. Deploy the updated control plane before installing this runner; no additional database migration is required after `0004`. Keep Orca running, register the repository in Orca, and authenticate the standalone Codex CLI as the local macOS user. Set absolute `VENTNEUF_ORCA_PATH` and `VENTNEUF_CODEX_PATH` executable paths when starting or installing the runner, and add `"orcaReview": true` to each explicitly enabled local repository registration. The action is advertised only when both executable paths and the repository opt-in are configured. The control plane independently checks repository ownership and the advertised capability.

Enabling Review permits the selected committed source to be sent to the user's configured Codex service. The runner copies up to 200 regular text source files, 128 KB per file and 2 MB total, from the current Git commit. Hidden paths, agent instructions, conventional secret/credential names, symlinks, binary files, and uncommitted files are excluded. This is a bounded review, not a complete audit or a secret scanner. Results identify the commit and selected file count.

Orca creates a separate mission worktree with setup hooks skipped. Codex tools can read the snapshot and their required runtime files; the custom permissions profile denies repository writes, shared temporary-directory access, and command network access. Before every review, an actual sandbox probe verifies snapshot readability and rejects outside reads, writes, and loopback network access. A failed probe prevents model execution. User configuration, host skills, plugins, apps, browser/computer tools, and agent delegation are disabled. Model requests use the existing local Codex login; device credentials and cloud lease tokens are never passed to Codex or Orca. The existing checkout is not modified. The initial integration was validated with Orca 1.4.188 and standalone Codex CLI 0.153.4 on macOS.

Reviews have a five-minute limit and renew the authenticated cloud lease every fifteen seconds. Renewal failure aborts local execution; a supervisor in the owned terminal independently kills its Codex process group when confirmed lease updates stop. Cancellation fences cloud results immediately and reaches the local process on the next renewal. Reviews receive one attempt: a lost or ambiguous launch is never automatically repeated. After expiry, polling marks the mission failed, and a user can explicitly request a new review.

Mission records and bounded failure diagnostics remain in the user's Application Support `ventneuf.os/reviews` directory. Completed snapshots are removed; interrupted snapshots and Orca worktrees remain available for local diagnosis and manual cleanup. Read-only objectives are supported.

### Autonomous Codex development missions

Add `"codexDevelopment": true` only to repositories where Hermes may dispatch writable Codex work. The runner advertises this separately from `orcaReview`; the control plane checks the repository owner and capability again before queuing the mission. Development authority lasts at most two hours and is created by the control plane, never by the agent or runner.

The runner creates an isolated Orca worktree with setup hooks skipped and starts Codex through its App Server protocol in a visible owned terminal. A mission-specific permission profile permits source writes plus only the Git objects, mission-branch reference, journals, and locks required for commits. Other shared Git metadata stays read-only and repository hooks are disabled. Normal sandboxed development commands remain available, while command network access and shared temporary paths are denied. A real sandbox probe checks these Git and source write boundaries, outside-file denial, and loopback-network denial before every Codex turn. Repository instructions remain active.

Development missions include live hosted web search, installed skill discovery and search, repository image inspection, image generation, and bounded subagent delegation. These research and composition capabilities are pre-authorized inside the mission; web results remain untrusted, and search queries must not contain secrets or private repository content. Subagents inherit the same worktree and permission boundary. Host apps, plugins, browser/computer control, memories, hooks, shell snapshots, automatic skill dependency installation, and workspace dependency automation remain disabled until the runner can bind them to child-mission credentials and route their side effects through the durable approval system.

Codex works through a clean pushed branch and pull request. Native command and file approval requests are converted into exact durable operations with a SHA-256 argument digest and a persisted Codex session reference. Worktree file changes are pre-authorized. Network access, pull-request creation, and commands requesting broader permissions go to Hermes; pull-request merges and deployment applies require the initiating member. Paths outside the mission worktree are declined locally. Review evidence contains only a bounded operation label and validated network destination; command arguments stay local while the digest remains bound to the original request.

Waiting for approval releases the cloud lease while the owned App Server request remains suspended. A final decision requeues the mission, and a fresh claim injects that decision into the same local Codex session. The runner reconciles retained local state with the authenticated cloud mission status, stops cancelled work, closes completed or cancelled terminals, and removes only clean worktrees. Dirty worktrees are retained to avoid deleting undeclared changes. Failed clean worktrees are retained for a 24-hour diagnostic period before automatic cleanup.

Set `TEST_DATABASE_URL` to an isolated disposable PostgreSQL database to include database and HTTP-to-runner integration tests in `npm test`.

Production migrations use the compiled `apps/control-plane/dist/migrate.js` entrypoint from an isolated one-shot workload. The web runtime must retain a separate database identity without schema ownership or DDL privileges.

## Security

Do not commit credentials, private vault content, infrastructure state, personal paths, conversation exports, or production configuration. See [SECURITY.md](SECURITY.md) to report a vulnerability.

## License

No open-source license has been selected yet. All rights are reserved until a license file is added.
