---
title: 'deck-sync'
---

Sync deck card lists between local files and Archidekt.

The same sync runs from the admin site's [Sync Decks](/admin/sync-decks/) page and from the MCP
`sync_decks` tool — all three share one engine, so the rules below apply everywhere.

## Usage

```bash
./ritual deck-sync pull [decks...]
./ritual deck-sync push [decks...]
```

## Arguments

| Argument      | Description                                                                                                           | Required |
| ------------- | --------------------------------------------------------------------------------------------------------------------- | -------- |
| `<direction>` | `pull` (Archidekt → local) or `push` (local → Archidekt). Any other value exits with code 2.                          | Yes      |
| `[decks...]`  | Deck names to sync (matched case- and accent-insensitively, no `.md`). If omitted, syncs all Archidekt-sourced decks. | No       |

Each name is matched case- and accent-insensitively with a unique-substring fallback, within decks only. An ambiguous or unknown name is reported as a **failed** deck (not `skipped`) and the run exits 1; since resolution is already deck-scoped, the error asks you to type more of the name rather than suggesting type flags this command does not have. See [List Resolution](/commands/list-resolution/).

## Options

| Option              | Description                                                               | Default     |
| ------------------- | ------------------------------------------------------------------------- | ----------- |
| `-n, --dry-run`     | Report what would sync without writing files or pushing changes           | `false`     |
| `-y, --yes`         | Sync decks with unreadable lines without asking (those lines are removed) | `false`     |
| `--only <changes>`  | Apply only `additions` or `removals` (relative to the sync destination)   | all changes |
| `--output <format>` | Output format: `text`, `json`, or `ndjson`                                | `text`      |
| `--quiet`           | Suppress non-essential output                                             | `false`     |

Under `--dry-run`, both directions still fetch the remote deck state (the diff
needs it), but a pull writes no files and records no changelog entries, and a
push sends nothing to Archidekt and does not update `lastSynced`.

## Change Filter

`--only` narrows a run to one side of each deck's diff. The vocabulary is
**destination-relative** — the destination is whatever the run writes to, so it
is your deck files on a `pull` and Archidekt on a `push`:

| Value       | Applies                                                        | Skips                   |
| ----------- | -------------------------------------------------------------- | ----------------------- |
| `additions` | Cards missing from the destination, and quantity **increases** | Removals and decreases  |
| `removals`  | Cards gone from the source, and quantity **decreases**         | Additions and increases |

Anything other than `additions` or `removals` exits with code 2. Skipped changes
are still counted and reported, once per deck:

```
Syncing "Winota Stax" (pull)...
  Skipped 3 removals (applying additions only).
  Changes: +2 added, -0 removed, ~1 quantity changed
```

The filter applies to cards only — a pull still adopts the deck's Archidekt
format, and a deck whose only change is a format change still saves.

The admin site's Sync Decks page offers the same choice as an
_All changes / Additions only / Removals only_ control, and the MCP `sync_decks`
tool takes it as an `only` field.

## Scripted Output

With `--output json` (or `ndjson`), progress logging is suppressed and a single
report is emitted on stdout:

```json
{
  "direction": "pull",
  "decks": [
    { "name": "Winota Stax", "status": "synced" },
    { "name": "Oops All Soldiers", "status": "synced", "reason": "no changes" },
    {
      "name": "Borrowed Deck",
      "status": "skipped",
      "reason": "you do not own Archidekt deck 12345"
    },
    { "name": "Gone", "status": "failed", "reason": "Failed to fetch Archidekt deck 999: 404" }
  ],
  "failedCount": 1,
  "unreadable": []
}
```

`unreadable` lists any deck whose file holds lines the parser could not read, with those lines — see
[Unreadable Lines](#unreadable-lines).

Each deck's `status` is `synced`, `failed`, or `skipped`; `reason` explains
anything other than a clean sync. Decks that could not be resolved or are not
sourced from Archidekt appear as `failed` entries. A deck with an Archidekt
`sourceUrl` but no `sourceId` is `skipped` when it is swept up by an all-decks
run, and `failed` when you name it explicitly. Top-level failures (for example,
not being signed in) are emitted as a structured error on stderr.

## Unreadable Lines

Both directions rewrite the deck file, so a line the parser cannot read — a stray comment, a
malformed card line — would be **deleted** by the save. Rather than let that happen silently, a sync
lists every affected deck and the exact lines at stake, then asks:

```
1 deck contains lines Ritual cannot read.
Syncing rewrites the deck file, so these lines would be removed:
  winota-stax.md ("Winota Stax"):
    Skipped malformed line: // buy this one later
? Sync 1 deck anyway, removing the lines above? › (y/N)
```

Answering no (the default) fails those decks; the rest of the run continues. Pass `-y, --yes` to
answer yes up front.

Without a terminal to ask — `--no-input`, a piped stdin, or `--output json`/`ndjson`, which owns
stdout — the run does not prompt: the affected decks fail with
`N unreadable lines would be dropped by a sync`, and the command exits 1. Pass `--yes` to sync them
anyway, or fix the lines first. The listing above is written to stderr in every mode, so a scripted
run still records what it refused; every report also carries an `unreadable` array with the same
decks and lines.

`--dry-run` is exempt: a preview writes nothing, so there is nothing to confirm. The lines are
listed and the deck is previewed like any other.

## Failure Behavior

Per-deck failures (a failed Archidekt fetch or push, cards that could not be
translated into upload entries, or a deck name that did not resolve) are reported
as they happen, and the sync continues with the remaining decks. If any deck
failed, a summary such as `2 of 5 decks failed` is printed to stderr and the
command exits with code 1; it exits 0 only when every deck synced cleanly.

## Rate Limiting

Requests to Archidekt are spaced at least 500 ms apart. When Archidekt answers
`429 Too Many Requests`, the request is retried up to 5 times — waiting out the
server's `Retry-After` when it names one, otherwise backing off exponentially
(1s, 2s, 4s, … capped at 30s) — with each wait reported as a warning. A 429 that
outlives the retry budget fails that deck's operation like any other HTTP error.
The spacing can be tuned with the `RITUAL_ARCHIDEKT_MIN_INTERVAL_MS` environment
variable (`0` disables it); the 429 handling is always on.

## How It Works

### Prerequisites

You must be signed into Archidekt before syncing:

```bash
./ritual login archidekt
```

Decks must have been imported from Archidekt (i.e., they have `sourceUrl` and `sourceId` in their YAML front matter).

### Pull (`deck-sync pull`)

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
5. Adopts the deck's Archidekt format, mapped onto Ritual's format keys (Archidekt's
   "Commander / EDH" becomes `commander`, "Dual Commander" becomes `duel-commander`,
   and so on). A format Ritual does not model — Custom, Frontier, Future Standard —
   leaves the local format untouched. A format change alone is enough to make the
   deck sync; it is not recorded in the changelog, which tracks cards only
6. Sets `lastSynced` timestamp in front matter

### Push (`deck-sync push`)

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

Sync compares **card names** and **quantities**. Pulls additionally respect the
**board** a card lives in (Main, Commander, Sideboard, Maybeboard), so cards land in
the right section locally.

Pulls also adopt the deck's format from Archidekt. Pushes do not send the local
format back.

The following are intentionally ignored at this time:

- Specific printings (set code, collector number)
- Card finish (foil, etched)
- Labels and categories (beyond mapping to a board)
- Card condition

> **Note on pushes:** pushes ignore board placement. The Archidekt batch API path
> used here cannot yet target a specific remote board/category, so moving a card
> between boards locally is not pushed (it would otherwise re-add the card to the
> default mainboard on Archidekt). Board-aware behavior currently applies to
> `pull` only.

### Front Matter

After a successful sync, a `lastSynced` field is added or updated in the deck's YAML front matter:

```yaml
---
name: 'My Deck'
format: commander
sourceId: '12345'
sourceUrl: 'https://archidekt.com/decks/12345'
lastSynced: '2026-04-02T12:00:00.000Z'
---
```

`format` is written on every save, whether it came from Archidekt or was inferred
from the deck's sections. See [new](/commands/new/#deck-format).

## Exit Codes

| Code | Meaning                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `0`  | Every deck synced cleanly (or there was nothing to sync)                                                                             |
| `1`  | At least one deck failed — including a deck refused for [unreadable lines](#unreadable-lines) — or you are not signed into Archidekt |
| `2`  | Missing or invalid `<direction>` or `--only` (anything other than push / pull, additions / removals)                                 |

## Examples

Pull changes for a specific deck:

```bash
./ritual deck-sync pull black-panther
```

Push changes for multiple decks:

```bash
./ritual deck-sync push black-panther oops-all-soldiers
```

Pull for all Archidekt decks:

```bash
./ritual deck-sync pull
```

Preview a push without sending anything:

```bash
./ritual deck-sync push --dry-run
```

Pull new cards without letting a pull delete anything locally:

```bash
./ritual deck-sync pull --only additions
```

Sync in a script, accepting the loss of any lines Ritual cannot read:

```bash
./ritual deck-sync pull --yes --no-input
```

Script a pull and inspect per-deck results:

```bash
./ritual deck-sync pull --output json
```
