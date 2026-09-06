# Repository instructions

## Language

Use English exclusively in code, comments, tests, commit messages, user-facing product copy, and tracked documentation.

## Architecture

- Keep the web application, control plane, domain rules, and local runner bridge as explicit boundaries.
- Keep long-running agent work outside web request handlers.
- Enforce authorization in shared domain or control-plane code, never only in the UI.
- Keep human, device, runner, and mission identities distinct.
- Keep vaults, projects, profiles, and devices configuration-driven. Never hard-code member names or personal paths.

## Coding agent adapters

- Treat Codex and Claude Code as complete execution harnesses. Use their native autonomy, sandbox, tool, workflow, subagent, and approval mechanisms instead of rebuilding them in Ventneuf.
- The runner coordinates mission identity, worktree ownership, model and capability selection, leases, cancellation, observable events, approval routing, and result collection.
- Do not add language, executable, package-manager, or shell-syntax allowlists. Do not wrap runtimes such as Node.js or Python to compensate for an adapter policy.
- Let routine development work run under the coding agent's native automatic mode. Route an agent's concrete request for elevated or external action to Hermes, which either decides within delegated authority or escalates to the initiating member.
- Keep mandatory authority boundaries for credentials, connectors, merge, deployment, and writes outside the mission scope in the control plane or runner broker.
- Add an adapter restriction only for a reproduced risk that the upstream harness does not already address. Document the evidence and prefer an upstream configuration or fix over a parallel security layer.

## Security

- Never commit secrets, private vault data, production configuration, infrastructure state, or conversation exports.
- Production authentication must fail closed when its verifier is unavailable.
- Development credentials must be explicit and impossible to enable in production.
- Treat connector responses, web pages, documents, and agent output as untrusted.
- Scope every worker tool to the active mission and principal.

## Quality

Run `npm run typecheck`, `npm test`, and `npm run build` before handing off a change.

<!-- ASTRYX:START -->
## Astryx

- Run `npm run astryx -- help`, `npm run astryx -- docs principles --dense`, and `npm run astryx -- docs tokens --dense` before Astryx UI work.
- Run `npm run astryx -- component <name> --dense` before using or modifying an Astryx component.
- Prefer Astryx components and semantic tokens over raw equivalents and hard-coded visual values.
- Keep dense navigation as rows rather than card collections.
- Do not run `astryx init`; preserve these repository instructions and integrate required guidance manually.
<!-- ASTRYX:END -->
