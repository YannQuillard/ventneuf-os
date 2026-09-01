# Security Policy

ventneuf.os is under active development and has not reached a stable security release.

Do not disclose suspected vulnerabilities in a public issue. Contact the maintainers privately through the security reporting channel configured on the GitHub repository.

The project must not contain:

- API keys, passwords, session cookies, OAuth tokens, or private keys;
- production environment files or Terraform state;
- private conversation, terminal, or audit exports;
- Obsidian vault contents;
- machine-specific credentials or personal filesystem paths.

Production services must fail closed when authentication or authorization configuration is missing.
