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
a prompt, so a headless run must pass `--all` explicitly — `--no-input` without `--all` is a
usage error (exit code `2`) before anything is fetched. `-y, --yes` only answers the
overwrite confirmation on conflicts; it no longer implies `--all`.

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
