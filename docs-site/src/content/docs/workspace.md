---
title: 'Workspace'
description: 'The folder Ritual works in, what each file and folder in it is for, and which ones to commit.'
---

A **workspace** is the folder Ritual works in. It holds your decks, collections and wanted lists as markdown files, plus a few small files Ritual keeps beside them. Ritual uses the current directory, or the folder you name with [`--base-dir`](/cli-conventions/#--base-dir) (or `RITUAL_BASE_DIR`).

A workspace needs no setup. Any folder with a `decks/`, `collections/` or `wanted/` folder is one, and [`ritual new`](/commands/new/) or [`ritual import`](/commands/import/) creates those folders the first time you add a list. Most people keep a workspace in a git repository, so every change has a history and the site can be [published from it](/guides/publish-site/).

## What is in it

```
my-mtg/
├── decks/
│   ├── Winota Stax.md                    # the deck
│   ├── Winota Stax.changes.md            # its change history
│   ├── Winota Stax.md.sha256             # hash of the file as Ritual last wrote it
│   ├── Winota Stax.categories.json       # card categories (optional)
│   ├── Winota Stax.categories.json.sha256
│   └── Winota Stax.art.json              # custom card art (optional)
├── collections/                          # the same files, for collections
├── wanted/                               # the same files, for wanted lists
├── art/                                  # your own card images (optional)
├── ritual.config.json                    # settings (optional)
├── .gitignore                            # written by `ritual init-site`
└── .github/workflows/deploy-site.yml     # written by `ritual init-site` (GitHub Pages)
```

- **The list file** (`<name>.md`) is the list itself. Its format is on [List Files](/list-format/).
- **The changelog** (`<name>.changes.md`) records every change Ritual made to the list. [`ritual history`](/commands/history/) and the sites read it. See [The `.changes.md` changelog](/list-format/#the-changesmd-changelog).
- **The `.sha256` files** let Ritual tell its own edits from yours. See [The `.sha256` files](/list-format/#the-sha256-files).
- **Categories** (`<name>.categories.json`) and **custom art** (`<name>.art.json`) exist only when you use those features. See [Categories](/list-format/#categories-namecategoriesjson) and [Custom Card Art](/custom-art/).

The folder names are settings: `decksDir`, `collectionsDir`, `wantedDir` and `artDir` in [`ritual.config.json`](/configuration/#directory-options).

## The config file

`ritual.config.json` holds your settings: price stores, the default language, site options and more. It is optional; a missing file means every setting has its default. Ritual creates it only when something writes a setting, such as [`ritual config set`](/commands/config/). Every key is on [Configuration](/configuration/).

Ritual also keeps a little bookkeeping in it, under the `managed` key: which release last updated the workspace and which [migrations](/reference/upgrading/#migrations) have run. Leave that key alone.

## Files Ritual manages

[`ritual init-site`](/commands/init-site/) writes a few files for you, and [`ritual migrate`](/commands/migrate/#generated-files) keeps them current after an upgrade:

- the deploy workflow (`.github/workflows/deploy-site.yml`, for GitHub Pages),
- the Ritual entries in `.gitignore`,
- the [agent skills](/commands/skills/) you installed (in `.claude/skills/`).

These are **managed files**. Ritual overwrites them when it updates them, so do not edit them by hand.

## What to commit

Commit everything that is yours:

- every list file, with its `.changes.md`, `.sha256`, `.categories.json` and `.art.json` files (commit the `.sha256` files, or every list looks hand-edited on the next run),
- the `art/` folder, if you use one,
- `ritual.config.json`, `.gitignore`, and the managed files above.

Keep the rest out of git. `ritual init-site` writes a `.gitignore` that does this for you; without it, add these yourself:

| Path                                                      | What it is                                                                                                                                                                                                                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.logins/`                                                | Your admin account and Archidekt sign-in. **Never commit it.** Ritual keeps a `.gitignore` inside it that ignores the whole folder, so it stays out even without `init-site`. See [Security and Privacy](/reference/security/#what-ritual-stores-on-your-computer). |
| `dist/`                                                   | The built site ([`ritual build-site`](/commands/build-site/)). Rebuilt from your lists. A [local-build deploy](/commands/init-site/) commits it instead.                                                                                                            |
| `cache/`                                                  | A [card cache](/card-cache/) kept in the workspace (`cacheDir: "cache"`, or the deploy workflow's `RITUAL_CACHE_DIR=cache`).                                                                                                                                        |
| `.trash/`                                                 | Lists you [deleted](/commands/delete/#restoring-a-deleted-list), kept so you can restore them.                                                                                                                                                                      |
| `.backups/`                                               | Copies [`ritual migrate`](/commands/migrate/#numbered-migrations) takes before it changes files.                                                                                                                                                                    |
| `exports/`, `all-cards.md`                                | Files [`ritual export`](/commands/export/) and [`list-all-cards`](/commands/list-all-cards/) write.                                                                                                                                                                 |
| `.admin-dist/`, `.dist-build-*`, `.dist-old-*`, `/ritual` | Build leftovers, and the Ritual binary the deploy workflow downloads.                                                                                                                                                                                               |

The card cache itself does not live in the workspace. It is one folder per user, shared by all your workspaces; see [Card Cache](/card-cache/).

## More than one workspace

You can have as many workspaces as you like, for example one per playgroup. Each keeps its own lists, settings and logins. They share the card cache, so the big card download happens once.
