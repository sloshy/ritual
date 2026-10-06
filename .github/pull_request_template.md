## Summary

<!-- What does this change and why? Link the issue it addresses, if any. -->

## Checklist

<!-- Tick what applies and strike through (~~like this~~) what doesn't. See CONTRIBUTING.md. -->

- [ ] Tests added or updated for the change
- [ ] `bun run test` passes, plus `bun run test:it` / `bun run test:e2e` where the change reaches them
- [ ] `bun run format` run
- [ ] Docs under `docs-site/` updated for any new or changed command, flag, option or behavior
- [ ] MCP tools (`src/mcp/`) and skills (`src/skills/`) updated when a command, flag or admin route changed
- [ ] New or reworded user-facing strings are message catalog keys with a `.meta.ts` description
- [ ] `CHANGELOG.md` entry under `## [Unreleased]` for anything a user would notice
- [ ] A `ritual migrate` migration for any change to what Ritual reads from or writes to a workspace
