# Contributing

ventneuf.os is currently in its foundation phase. Small, focused changes with tests and explicit security boundaries are preferred.

## Requirements

- Use English for code, comments, tests, commit messages, and public documentation.
- Keep personal names, local paths, credentials, vault contents, and private infrastructure details out of the repository.
- Treat all user, web, connector, and agent output as untrusted input.
- Enforce authorization at the server boundary; UI visibility is not authorization.
- Keep human, device, runner, and mission identities separate.
- Never add a production fallback to development authentication.

## Validation

Run the complete validation suite before opening a pull request:

```bash
npm run typecheck
npm test
npm run build
```

Every behavior change should include a test proportional to its risk.
