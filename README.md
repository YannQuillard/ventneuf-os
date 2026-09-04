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
- a separately deployable control plane that communicates with Hermes over A2A;
- authenticated remote and local MCP boundaries for agent tools;
- identity, device, mission, and capability authorization primitives;
- a messaging-oriented interface with project channels and private agent conversations.

The current interface can send a request to Hermes, persist it before execution, queue the corresponding mission, follow its live tool activity, stop it, and display the durable response. The control plane can securely enroll a device and authenticate its outbound heartbeat. Mission execution on device runners, live terminal sessions, project channels, and production connectors remain under development.

The production infrastructure and private operational documentation are intentionally maintained outside this public repository.

## Repository

```text
apps/web                 Web and PWA product experience
apps/control-plane       Remote MCP and agent control-plane service
packages/domain          Shared identity and authorization rules
packages/database        PostgreSQL schema and tenant-scoped repositories
packages/mcp-server      Local MCP and runner-bridge foundations
```

## Architecture

The web application is a browser-facing backend-for-frontend. It owns the login session but does not execute agent work. Authenticated requests are forwarded to the control plane, which enforces capabilities, persists conversations, dispatches durable missions, and communicates with Hermes. Long-running missions execute outside web request handlers.

MCP is the tool boundary for coding agents and future device runners. A2A is currently the service-to-service boundary between the control plane and Hermes. Human, device, runner, and mission identities remain distinct throughout the system.

## Roadmap

The next product milestones are:

1. mission status, retries, latency telemetry, and operational hardening;
2. configurable workspaces, project channels, private conversations, and memberships;
3. authorized knowledge tools over MCP;
4. a local device runner with repository discovery, secure enrollment, and outbound-only connectivity;
5. live terminal events, browser evidence, and approval controls;
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

Production migrations use the compiled `apps/control-plane/dist/migrate.js` entrypoint from an isolated one-shot workload. The web runtime must retain a separate database identity without schema ownership or DDL privileges.

## Security

Do not commit credentials, private vault content, infrastructure state, personal paths, conversation exports, or production configuration. See [SECURITY.md](SECURITY.md) to report a vulnerability.

## License

No open-source license has been selected yet. All rights are reserved until a license file is added.
