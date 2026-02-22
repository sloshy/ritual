---
description: Organization rules for CLI command placement and documentation updates.
applyTo: '**/*'
---

# Organization

New CLI commands should be added to `src/commands/` rather than directly in `index.ts`.

Any new command, flag, option, or feature adjusted or added must also be reflected in the Docusaurus docs under `docs-site/`.
