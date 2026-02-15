---
description: Organization rules for CLI command placement and documentation updates.
applyTo: '**/*'
---

# Organization

New CLI commands should be added to `src/commands/` rather than directly in `index.ts`.

Any new command, flag, option, or feature added to the CLI must be reflected in `README.md`.

Any new command or command adjustment must also be reflected in the Docusaurus docs under `docs-site/`.
