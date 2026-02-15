---
sidebar_position: 3
---

# import-account

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

| Option              | Description                                              |
| ------------------- | -------------------------------------------------------- |
| `-a, --all`         | Import all decks without interactive selection           |
| `-o, --overwrite`   | Overwrite existing decks without prompting               |
| `--non-interactive` | Disable interactive prompts; requires `--all` or `--yes` |
| `-y, --yes`         | Automatically answer yes to prompts                      |
| `--dry-run`         | Preview imports without writing deck files               |

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
./ritual import-account johndoe --all --non-interactive --dry-run
```

## Notes

- If you are logged in to your account, you can import your private or unlisted decks
- Interactive mode allows you to select which decks to import using a checkbox interface
- All selected decks are imported sequentially
