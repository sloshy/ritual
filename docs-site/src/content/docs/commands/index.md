---
title: 'CLI Commands'
description: Every command in the Ritual CLI, grouped by what it works on.
---

Every Ritual command, grouped the way `ritual help --all` groups them. Each page opens with usage and options, then covers behavior, examples, and exit codes. Global options, scripting output, and exit codes shared by all commands are on [CLI Conventions](/cli-conventions/).

## Help in the terminal

`ritual --help` is short on purpose. It describes the core commands a newcomer needs (the first three groups below) and names the rest in one line. `ritual help --all` (or `ritual --help --all`) describes every command, including the **Advanced** group of CI and maintenance commands. `ritual help <command>` (or `ritual <command> --help`) shows one command's arguments and options. Every command runs the same whichever list shows it.

## Core commands

- **Get started**: [new](/commands/new/), [import](/commands/import/), [add-card](/commands/add-card/), [edit](/commands/edit/), [admin](/commands/admin/)
- **Look up and price**: [lists](/commands/lists/), [card](/commands/card/), [scry](/commands/scry/), [price](/commands/price/)
- **Publish**: [build-site](/commands/build-site/), [serve](/commands/serve/)

## More commands

- **Lists**: [rename](/commands/rename/), [delete](/commands/delete/), [metadata](/commands/metadata/), [categories](/commands/categories/), [set-list-image](/commands/set-list-image/), [history](/commands/history/), [diff](/commands/diff/), [get-primer](/commands/get-primer/)
- **Cards**: [remove-card](/commands/remove-card/), [set-card](/commands/set-card/), [note](/commands/note/), [move](/commands/move/)
- **Import & Export**: [import-account](/commands/import-account/), [import-changes](/commands/import-changes/), [export](/commands/export/)
- **Lookup & Pricing**: [sell](/commands/sell/)
- **Site**: [init-site](/commands/init-site/)
- **Integrations**: [login](/commands/login/), [deck-sync](/commands/deck-sync/), [collection-sync](/commands/collection-sync/), [mcp](/commands/mcp/), [skills](/commands/skills/)
- **Cache**: [cache](/commands/cache/)
- **Utilities**: [cleanup](/commands/cleanup/), [self-update](/commands/self-update/), [config](/commands/config/), [doctor](/commands/doctor/), [locale](/commands/locale/), [license](/commands/license/)

## Advanced

Shown only by `ritual help --all`. These are mostly run by CI or by Ritual's own prompts:

- [migrate](/commands/migrate/), [detect-changes](/commands/detect-changes/), [list-all-cards](/commands/list-all-cards/), [dep-license](/commands/dep-license/)

Most commands take a list by name. How that name is matched, and how to disambiguate one that exists as both a deck and a collection, is on [List Names](/list-resolution/).
