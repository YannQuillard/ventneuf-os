# Repository instructions

## Language

Use English exclusively in code, comments, tests, commit messages, user-facing product copy, and tracked documentation.

## Architecture

- Keep the web application, control plane, domain rules, and local runner bridge as explicit boundaries.
- Keep long-running agent work outside web request handlers.
- Enforce authorization in shared domain or control-plane code, never only in the UI.
- Keep human, device, runner, and mission identities distinct.
- Keep vaults, projects, profiles, and devices configuration-driven. Never hard-code member names or personal paths.

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
