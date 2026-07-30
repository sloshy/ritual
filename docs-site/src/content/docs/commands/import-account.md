---
title: 'import-account'
---

Import all public decks from an Archidekt user account.

## Usage

```bash
./ritual import-account [username] [options]
```

## Arguments

| Argument     | Description                                                  | Required |
| ------------ | ------------------------------------------------------------ | -------- |
| `[username]` | Archidekt username to fetch decks for (or omit if logged in) | No       |

## Options

| Option            | Description                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| `-a, --all`       | Import all decks without interactive selection                                                        |
| `-o, --overwrite` | Overwrite existing decks without prompting                                                            |
| `-y, --yes`       | Automatically answer yes to the overwrite confirmation when an import conflicts with an existing deck |
| `-n, --dry-run`   | Preview imports without writing deck files                                                            |

## Scripting Without Prompts

The global `--no-input` flag (or `RITUAL_NO_INPUT`) disables all prompts. Deck selection is
a prompt, so a headless run must pass `--all` explicitly — omitting it whenever
[prompts are unavailable](/#when-prompts-are-unavailable) (including a plain piped run) is a
usage error (exit code `2`) before anything is fetched. A per-deck name conflict in such a run
reports the same `--overwrite`/`--yes` guidance [import](/commands/import/) gives, and the run
exits `2`. `-y, --yes` only answers the
overwrite confirmation on conflicts — for that purpose it is equivalent to `--overwrite`,
matching [import](/commands/import/) — and it does not imply `--all`.

## Examples

Import decks interactively (select which ones to import):

```bash
./ritual import-account johndoe
```

Import all public decks from a user:

```bash
./ritual import-account johndoe --all
```

Plan an import in CI without prompts:

```bash
./ritual import-account johndoe --all --no-input --dry-run
```

## Notes

- If you are logged in to your account, you can import your private or unlisted decks
- Interactive mode allows you to select which decks to import using a checkbox interface
- All selected decks are imported sequentially
