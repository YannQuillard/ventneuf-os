# ventneuf.os

ventneuf.os is an open agentic workspace for conversations, knowledge, missions, devices, terminals, and connectors.

The product provides one interface where a team can talk to an orchestrator, delegate work to coding agents, follow live execution, review artifacts, and preserve durable project knowledge.

## Status

The repository is under active development. Current foundations include:

- a Next.js workspace and conversation interface;
- a separately runnable control-plane service;
- an authenticated MCP Streamable HTTP boundary;
- a local stdio MCP and runner-bridge prototype;
- identity, device, mission, and capability authorization primitives.

The production infrastructure and private operational documentation are intentionally maintained outside this public repository.

## Repository

```text
apps/web                 Web and PWA product experience
apps/control-plane       Remote MCP and agent control-plane service
packages/domain          Shared identity and authorization rules
packages/mcp-server      Local MCP and future runner bridge
```

## Development

Requirements:

- Node.js 22 or newer;
- npm 11 or newer.

```bash
npm install
npm run typecheck
npm test
npm run build
npm run dev
```

The control plane fails closed in production until a production OAuth verifier is configured. Local development requires an explicit `VENTNEUF_DEV_TOKEN` and must never reuse production credentials.

## Security

Do not commit credentials, private vault content, infrastructure state, personal paths, conversation exports, or production configuration. See [SECURITY.md](SECURITY.md) to report a vulnerability.

## License

No open-source license has been selected yet. All rights are reserved until a license file is added.
