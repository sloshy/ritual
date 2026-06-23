---
title: 'deck-sync'
---

Sync deck card lists between local files and Archidekt.

## Usage

```bash
./ritual deck-sync [decks...] --download-changes
./ritual deck-sync [decks...] --upload-changes
```

## Arguments

| Argument     | Description                                                                                                           | Required |
| ------------ | --------------------------------------------------------------------------------------------------------------------- | -------- |
| `[decks...]` | Deck names to sync (matched case- and accent-insensitively, no `.md`). If omitted, syncs all Archidekt-sourced decks. | No       |

Each name is matched case- and accent-insensitively with a unique-substring fallback; an ambiguous name is reported and skipped. See [List Resolution](/commands/list-resolution/).

## Options

| Option               | Description                                              |
| -------------------- | -------------------------------------------------------- |
| `--download-changes` | Pull remote changes from Archidekt into local deck files |
| `--upload-changes`   | Push local changes to Archidekt                          |

One of `--download-changes` or `--upload-changes` is required. They cannot be used together.

## How It Works

### Prerequisites

You must be signed into Archidekt before syncing:

```bash
./ritual login archidekt
```

Decks must have been imported from Archidekt (i.e., they have `sourceUrl` and `sourceId` in their YAML front matter).

### Download Changes (`--download-changes`)

1. Fetches the current deck state from Archidekt
2. Compares cards and quantities against the local deck file, **per board** (Main,
   Commander, Sideboard, Maybeboard) and by card name
3. Applies any differences to the local file, respecting each card's board:
   - New cards are added to the section matching their remote board (e.g. a card in
     the Archidekt maybeboard is added to the local `## Maybeboard` section, creating
     that section if it does not exist). A newly created section is inserted in
     canonical board order (Commander, Main, Sideboard, Maybeboard) without
     reordering your existing sections
   - Removed cards are deleted from the board they were removed from
   - Quantity changes are applied in-place within the matching board
   - A card that moved between boards on Archidekt is removed from its old board and
     added to the new one
4. Records all changes in the deck's `.changes.md` changelog. Card names are written
   quoted, and changes that target a non-main board are annotated with the
   destination, e.g. `Added "Cavern-Hoard Dragon" to Maybeboard` or
   `Removed "Lightning Bolt" from Sideboard`
5. Sets `lastSynced` timestamp in front matter

### Upload Changes (`--upload-changes`)

1. Verifies you own the Archidekt deck (skips non-owned decks with a warning)
2. Fetches the current Archidekt deck state
3. Compares local cards and quantities against the remote state (by card name only,
   across all boards — see note below)
4. Pushes differences to Archidekt via their batch API:
   - New cards are resolved by name and added
   - Removed cards are set to quantity 0
   - Quantity changes are set to the new absolute value
5. Sets `lastSynced` timestamp in front matter

### What Is Compared

Sync compares **card names** and **quantities**. Downloads additionally respect the
**board** a card lives in (Main, Commander, Sideboard, Maybeboard), so cards land in
the right section locally.

The following are intentionally ignored at this time:

- Specific printings (set code, collector number)
- Card finish (foil, etched)
- Labels and categories (beyond mapping to a board)
- Card condition

> **Note on uploads:** uploads ignore board placement. The Archidekt batch API path
> used here cannot yet target a specific remote board/category, so moving a card
> between boards locally is not pushed (it would otherwise re-add the card to the
> default mainboard on Archidekt). Board-aware behavior currently applies to
> `--download-changes` only.

### Front Matter

After a successful sync, a `lastSynced` field is added or updated in the deck's YAML front matter:

```yaml
---
name: 'My Deck'
sourceId: '12345'
sourceUrl: 'https://archidekt.com/decks/12345'
lastSynced: '2026-04-02T12:00:00.000Z'
---
```

## Examples

Download changes for a specific deck:

```bash
./ritual deck-sync black-panther --download-changes
```

Upload changes for multiple decks:

```bash
./ritual deck-sync black-panther oops-all-soldiers --upload-changes
```

Sync all Archidekt decks (download):

```bash
./ritual deck-sync --download-changes
```
