---
sidebar_position: 24
---

# deck-sync

Sync deck card lists between local files and Archidekt.

## Usage

```bash
./ritual deck-sync [decks...] --download-changes
./ritual deck-sync [decks...] --upload-changes
```

## Arguments

| Argument     | Description                                                                                            | Required |
| ------------ | ------------------------------------------------------------------------------------------------------ | -------- |
| `[decks...]` | Deck names to sync (slugified filenames without `.md`). If omitted, syncs all Archidekt-sourced decks. | No       |

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
2. Compares cards and quantities against the local deck file (by card name only)
3. Applies any differences to the local file:
   - New cards are added to the Main section (or Commander section for commanders)
   - Removed cards are deleted from all sections
   - Quantity changes are applied in-place
4. Records all changes in the deck's `.changes.md` changelog
5. Sets `lastSynced` timestamp in front matter

### Upload Changes (`--upload-changes`)

1. Verifies you own the Archidekt deck (skips non-owned decks with a warning)
2. Fetches the current Archidekt deck state
3. Compares local cards and quantities against the remote state (by card name only)
4. Pushes differences to Archidekt via their batch API:
   - New cards are resolved by name and added
   - Removed cards are set to quantity 0
   - Quantity changes are set to the new absolute value
5. Sets `lastSynced` timestamp in front matter

### What Is Compared

Currently, sync only compares **card names** and **quantities**. The following are intentionally ignored at this time:

- Specific printings (set code, collector number)
- Card finish (foil, etched)
- Labels and categories
- Card condition

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
