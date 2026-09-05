---
title: 'CLI Commands'
description: Every command in the Ritual CLI, grouped by what it works on.
---

Every Ritual command, grouped by what it works on. Each page opens with usage and options, then covers behavior, examples, and exit codes. The conventions shared by all of them, such as global options, scripting output, and exit codes, are on [CLI Conventions](/cli-conventions/).

- **Lists** — [lists](/commands/lists/), [new](/commands/new/), [rename](/commands/rename/), [delete](/commands/delete/), [edit](/commands/edit/), [metadata](/commands/metadata/), [categories](/commands/categories/), [set-list-image](/commands/set-list-image/), [history](/commands/history/), [diff](/commands/diff/), [get-primer](/commands/get-primer/)
- **Cards** — [add-card](/commands/add-card/), [remove-card](/commands/remove-card/), [set-card](/commands/set-card/), [note](/commands/note/), [move](/commands/move/)
- **Import & Export** — [import](/commands/import/), [import-account](/commands/import-account/), [import-changes](/commands/import-changes/), [export](/commands/export/)
- **Lookup & Pricing** — [card](/commands/card/), [scry](/commands/scry/), [price](/commands/price/), [sell](/commands/sell/)
- **Site** — [build-site](/commands/build-site/), [serve](/commands/serve/), [init-site](/commands/init-site/), [admin](/commands/admin/)
- **Integrations** — [login](/commands/login/), [deck-sync](/commands/deck-sync/), [collection-sync](/commands/collection-sync/), [mcp](/commands/mcp/), [skills](/commands/skills/)
- **Utilities** — [cache](/commands/cache/), [cleanup](/commands/cleanup/), [detect-changes](/commands/detect-changes/), [list-all-cards](/commands/list-all-cards/), [config](/commands/config/), [locale](/commands/locale/), [license](/commands/license/), [dep-license](/commands/dep-license/)

Most commands take a list by name. How that name is matched, and how to disambiguate one that exists as both a deck and a collection, is on [List Names](/list-resolution/).
