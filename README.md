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

## Roadmap

The next product milestones are:

1. mission retries, latency optimization, and operational hardening;
2. configurable workspaces, project channels, private conversations, and memberships;
3. authorized knowledge tools over MCP;
4. Orca integration behind the runner adapter and mission-scoped tool credentials;
5. scoped local execution, live terminal events, browser evidence, and approval controls;
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

The control plane fails closed in production unless its token verifier is completely configured. Local development requires an explicit `VENTNEUF_DEV_TOKEN` and must never reuse production credentials.

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

Use your actual repository path locally; never commit that configuration. The runner reloads it on each poll and publishes only repository IDs and display names. A missing file registers no repositories; invalid configuration stops mission polling until corrected. The web device list offers a **Check** action for each registered repository on an online device. The result appears in the private conversation.

This first adapter checks directory accessibility, counts at most 10,000 top-level entries, and checks for Git metadata. It does not read source contents, recurse into directories, invoke a shell, or execute repository code. Removing a registration prevents execution of a queued mission for that repository.

Claims are serialized per device. Each attempt receives a 60-second lease bound to the device, runner process, and mission; only the token hash is persisted. Progress renews the lease, reports are idempotent by event ID, and a mission receives at most three attempts. Cancellation rejects further reports, and completion persists the result and assistant message in one transaction. The adapter has a cooperative 10-second timeout. Cancellation fences results immediately; an already-running check can finish its bounded metadata scan. This is not an execution sandbox for arbitrary agents. Orca integration and mission-scoped tool credentials are required before enabling coding-agent or repository write operations.

Set `TEST_DATABASE_URL` to an isolated disposable PostgreSQL database to include database and HTTP-to-runner integration tests in `npm test`.

Production migrations use the compiled `apps/control-plane/dist/migrate.js` entrypoint from an isolated one-shot workload. The web runtime must retain a separate database identity without schema ownership or DDL privileges.

## Security

Do not commit credentials, private vault content, infrastructure state, personal paths, conversation exports, or production configuration. See [SECURITY.md](SECURITY.md) to report a vulnerability.

## License

No open-source license has been selected yet. All rights are reserved until a license file is added.
