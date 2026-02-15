---
description: Scan repository for undocumented features and update the Docusaurus documentation site.
agent: agent
---

# Update Documentation Site

Scan the codebase for features not yet covered in the Docusaurus docs and add or update documentation as needed.

## Steps

1. Inventory existing docs pages in `docs-site/docs/`.
2. Scan `src/commands/` to identify commands, arguments, options, and subcommands.
3. Compare `README.md` content with docs-site content to find coverage gaps.
4. Search for option and argument definitions in command files (for example `.option` and `.argument`) and compare against docs.
5. Create a missing-items checklist:
   - Commands missing docs pages
   - Arguments/options not documented
   - New modes/subcommands not documented
6. Apply docs updates:
   - New command: create `docs-site/docs/commands/<command-name>.md` and update `docs-site/sidebars.ts`
   - Existing command updates: add missing options/arguments and examples
   - New complex workflow: add a dedicated section or separate guide page
7. Build docs with `cd docs-site && npm run build` and resolve build/link issues.
8. Review for style consistency, formatting correctness, and implementation accuracy.
