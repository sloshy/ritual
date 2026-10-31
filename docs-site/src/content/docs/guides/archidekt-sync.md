---
title: 'Sync with Archidekt'
description: 'Sign in, import your Archidekt decks, and keep decks and your collection in step in both directions, previewing every run first.'
sidebar:
  order: 2
---

This guide connects a Ritual workspace to an Archidekt account: sign in, bring your decks in, then keep decks and your collection in step in both directions. Each step links to the full reference.

Two commands do the syncing:

- [`deck-sync`](/commands/deck-sync/) works per deck. Each local deck is linked to one Archidekt deck.
- [`collection-sync`](/commands/collection-sync/) treats **all** your collection lists as one Archidekt collection, since an Archidekt account has only one.

## Before You Start: Preview Everything

A sync writes to one side to make it match the other. A pull rewrites your local files; a push changes your Archidekt account. Both commands take `-n, --dry-run`, which fetches the remote side and reports what would change without writing anything. Add `-v, --verbose` to see every card:

```bash
ritual deck-sync push --dry-run --verbose
ritual collection-sync push --dry-run --verbose
```

Make a dry run your habit before every real run, and keep your workspace in git so a bad pull is one `git checkout` away.

:::caution[A sync mirrors one side onto the other, removals included]

A sync is not a merge. `collection-sync push` makes your **whole** Archidekt collection match your local collection lists: a card on Archidekt that no local list holds is deleted, including cards you added on archidekt.com since your last sync. A pull does the same in the other direction: it makes your local lists match Archidekt by name and quantity, so local cards you added or changed and never pushed are removed. Neither direction asks first. Preview with a dry run, and use `--only additions` when both sides have changed or you only want to send new cards.

The one thing a sync refuses outright is removing **everything**: when the side it copies from holds no cards and the other side holds some (an empty Archidekt collection or deck, or empty local files), the run, or that deck, stops before writing anything. Pass `--allow-remove-all` only when emptying one side is what you want.

:::

## 1. Sign In

```bash
ritual login archidekt
```

Ritual asks for your username (or email) and password and stores the session tokens in `.logins/` in your workspace. Ritual keeps a `.gitignore` inside that folder, so it stays out of git with or without [`init-site`](/commands/init-site/). Check the session at any time, offline:

```bash
ritual login status
```

An expired session is refreshed on its own until its refresh token also expires; then `login status` says to sign in again. For scripts, pipe the password in with `--username <name> --password-stdin`. See [`login`](/commands/login/).

## 2. Bring Your Decks In

Import every deck on an account and pick which ones from a list:

```bash
ritual import-account
```

With no username, it uses the account you are signed in to, so private and unlisted decks are included. Pass a username to import someone's public decks, and `--all` to skip the picker. To import one deck, give [`import`](/commands/import/) its URL:

```bash
ritual import https://archidekt.com/decks/123456
```

Both ask once whether to keep the exact printings Archidekt lists (set, collector number, finish). The default is yes. Archidekt categories become the deck's [categories](/commands/categories/), except the ones that stand for boards (Commander, Sideboard, Maybeboard, and so on), which decide the card's section.

An imported deck's front matter records `sourceUrl` and `sourceId`. That is the link `deck-sync` uses.

### A deck you built in Ritual

Archidekt has no way for Ritual to create a deck. Create an empty deck on archidekt.com, then link it and push:

```bash
ritual deck-sync link "Alpha Deck" https://archidekt.com/decks/123456
ritual deck-sync push "Alpha Deck" --dry-run
ritual deck-sync push "Alpha Deck"
```

`link` writes only the two front-matter fields and touches no card lines.

## 3. Keep Decks in Step

See what is linked and when each deck last synced. This makes no requests:

```bash
ritual deck-sync status
```

**Pull** applies Archidekt's changes to your deck files:

```bash
ritual deck-sync pull                  # every linked deck
ritual deck-sync pull "Winota Stax"    # one deck
```

Added, removed and changed cards land on the matching board (Main, Commander, Sideboard, Maybeboard). Every change is written to the deck's `.changes.md`, and the pull adopts the deck's Archidekt format.

**Push** sends your local changes to decks you own on Archidekt:

```bash
ritual deck-sync push "Winota Stax" --dry-run
ritual deck-sync push "Winota Stax"
```

Decks you do not own are skipped. If the Archidekt deck changed since your last sync, the push **refuses** that deck rather than undo those edits. You can pull it first, but a pull makes the local deck match Archidekt, so local changes you have not pushed yet are removed. Run `ritual deck-sync pull "Winota Stax" --dry-run --verbose` to see what it would drop, then decide; or pass `--force` to overwrite the remote changes on purpose. See [Divergence Guard](/commands/deck-sync/#divergence-guard-push).

### What a deck sync compares

By default, card names and quantities per board. A card that sits on a different board on each side is moved, in both directions; there is no flag for that, and `--only` never skips a move. See [Board moves](/commands/deck-sync/#board-moves).

Two opt-in flags widen the sync, on `pull` and `push` alike:

| Flag                | Also syncs                                                    |
| ------------------- | ------------------------------------------------------------- |
| `--sync-printings`  | Each card's set, collector number, and foil or etched finish  |
| `--sync-categories` | Each card's categories (its role in the deck, such as `Ramp`) |

Without `--sync-printings`, a run never adds or removes copies to fix a printing; it reports the card and moves on. Labels, tags, condition and language are never synced for decks.

A first category push from a deck with no categories leaves Archidekt's alone. Pull with `--sync-categories` first to bring them down:

```bash
ritual deck-sync pull "Winota Stax" --sync-categories
```

### Lines Ritual cannot read

A sync rewrites the deck file, so a line the parser cannot read would be deleted. The run lists those lines and asks before it touches the deck. Fix the lines by hand to keep them, or answer yes (`-y, --yes`) to drop them. See [Unreadable Lines](/commands/deck-sync/#unreadable-lines).

## 4. Sync Your Collection

An Archidekt account has one collection, while a Ritual workspace can have many collection lists (a binder, a long box, an inbox). A run compares the combined contents of your collection lists with the whole Archidekt collection. Cards are matched by printing, finish, condition and language, so a `[ja]` line and an English line of the same printing are different records.

### Pull

:::caution[The first pull can thin out your lists]

A pull removes every local copy that Archidekt does not hold. If your Archidekt collection is only partly filled, a first pull removes most of your local collection, without asking. For a collection that has never been synced, preview first and pull with `--only additions`.

A pull against an Archidekt collection with **no** cards (a new account, or one emptied elsewhere) is refused rather than emptying your lists; pass `--allow-remove-all` only if you really mean to remove everything. See [Empty-side guard](/commands/collection-sync/#empty-side-guard).

:::

```bash
ritual collection-sync pull --dry-run --verbose
ritual collection-sync pull
```

New cards on Archidekt all land in one list, because only you know which binder they belong in. That list is, in order: `--into <list>` for this run, the [`collectionSync.pullTarget`](/configuration/#collection-sync) setting, or `Inbox`. It is created the first time it is needed. Move the cards to their real binders afterwards with [`move`](/commands/move/) or an editor.

To change the default once:

```bash
ritual config set collectionSync.pullTarget "New Arrivals"
```

**Ambiguous removals.** When Archidekt has fewer copies of a printing than you do, the pull removes the difference. If every copy is going, or the copies all sit in one list, that is clear. If only some copies are going and they live in several lists, Ritual cannot know which binder lost them, and **the run writes nothing** until you decide. In a terminal it offers to walk through them one copy at a time. Anywhere else, name the lists that may give up copies, in order:

```bash
ritual collection-sync pull --removal-priority "Long Box" --removal-priority "Blue Binder"
```

Or skip removals for this run with `--only additions`. See [Ambiguous removals](/commands/collection-sync/#ambiguous-removals).

### Push

Read the caution at the top of this page first. Then preview:

```bash
ritual collection-sync push --dry-run --verbose
```

Check the removals in that preview. If any of them are cards you still own, push with `--only additions`. Pulling first is only safe when you have no unpushed local changes, because a pull removes them; check with `ritual collection-sync pull --dry-run --verbose`.

```bash
ritual collection-sync push --only additions
```

A push never writes to your list files. More than 25 new printings go to Archidekt as one CSV import rather than one request each; in a terminal you are asked how to send them, and `--csv` answers up front. That path keys every row by the Scryfall ID in your local card cache, so refresh the cache first if it is old (`ritual cache preload-all`). See [CSV import for new cards](/commands/collection-sync/#csv-import-for-new-cards).

### Syncing only some lists

You can name lists, but the Archidekt side is still the whole collection. Cards in the lists you left out read as missing: a push would delete them from Archidekt and a pull would add them again. Pair a named-list run with `--only`:

```bash
ritual collection-sync push "Blue Binder" --only additions
ritual collection-sync pull "Blue Binder" --only removals
```

## 5. Use the Admin Site Instead

[`ritual admin`](/commands/admin/) has the same syncs in the browser, run by the same engine:

- [Sync Decks](/admin/sync-decks/) (`#/sync/decks`): direction, change filter, deck checklist, and checkboxes for a preview-only run, syncing printings and syncing categories. It shows every card change, like `--verbose`. It has no `--force`; pull a refused deck first.
- [Sync Collection](/admin/sync-collection/) (`#/sync/collection`): scope, change filter, target list, and an ordered **Removal priority** picker. The browser cannot prompt mid-run, so an ambiguous removal with no priority fails the run without writing anything.

Both pages sign you in inline when needed, sharing the login with the CLI.

## Rate Limits

Archidekt allows about 80 requests per minute. Ritual spaces its requests 1.5 seconds apart and retries when Archidekt answers `429 Too Many Requests`, so a large sync is slow but steady. A run that fails part way is safe to repeat: only the remaining differences are sent. See [Rate Limiting](/commands/collection-sync/#rate-limiting).

## Scripting a Sync

For cron jobs and CI, disable prompts and read the JSON report:

```bash
ritual deck-sync pull --no-input --output json
ritual collection-sync pull --no-input --removal-priority "Inbox" --output json
```

Without a terminal, anything that would prompt fails instead of guessing: unreadable lines (pass `--yes` to drop them), ambiguous removals, and large collection pushes (pass `--csv`). Exit code `1` means at least one deck or list failed. The reference pages describe each report's fields.
