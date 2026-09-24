---
title: 'deck-sync'
---

Sync deck card lists between local files and Archidekt.

The same sync runs from the admin site's [Sync Decks](/admin/sync-decks/) page and from the MCP `sync_decks` tool. All three share one engine, so the rules below apply everywhere.

## Usage

```bash
ritual deck-sync pull [decks...] [--sync-printings]
ritual deck-sync push [decks...] [--force] [--sync-printings]
ritual deck-sync link <deck> <url>
ritual deck-sync status
```

## Subcommands

| Subcommand | Description                                                         |
| ---------- | ------------------------------------------------------------------- |
| `pull`     | Apply Archidekt deck changes to the local deck files                |
| `push`     | Send local deck changes to the decks you own on Archidekt           |
| `link`     | Link a local deck to a deck that already exists on Archidekt        |
| `status`   | Show which decks are linked to Archidekt, and when each last synced |

Anything else is a usage error (exit code `2`).

## Arguments

| Argument     | Description                                                                  | Required |
| ------------ | ---------------------------------------------------------------------------- | -------- |
| `[decks...]` | Deck names to sync (no `.md`). If omitted, syncs all Archidekt-sourced decks | No       |

Names resolve within decks only, following the usual [list name rules](/list-resolution/). An ambiguous or unknown name is reported as a **failed** deck (not `skipped`) and the run exits 1.

## Options

| Option              | Description                                                                      | Default     |
| ------------------- | -------------------------------------------------------------------------------- | ----------- |
| `-n, --dry-run`     | Report what would sync without writing files or pushing changes                  | `false`     |
| `-y, --yes`         | Sync decks with unreadable lines without asking (those lines are removed)        | `false`     |
| `--only <changes>`  | Apply only `additions` or `removals` (relative to the sync destination)          | all changes |
| `--force`           | **push only** — overwrite a remote deck that changed since its last sync         | `false`     |
| `--sync-printings`  | Also sync each card's exact printing (set, collector number, foil/etched finish) | `false`     |
| `--output <format>` | Output format: `text`, `json`, or `ndjson`                                       | `text`      |
| `--quiet`           | Suppress non-essential output                                                    | `false`     |

`--force` exists on `push` only. A pull never writes to Archidekt, so passing `--force` to it is a usage error.

Under `--dry-run`, both directions still fetch the remote deck state, since the diff needs it. A pull writes no files and records no changelog entries. A push sends nothing to Archidekt and does not update `lastSynced`.

## Change Filter

`--only` narrows a run to one side of each deck's diff. Its values are relative to the **destination**: your deck files on a `pull`, Archidekt on a `push`.

| Value       | Applies                                                        | Skips                   |
| ----------- | -------------------------------------------------------------- | ----------------------- |
| `additions` | Cards missing from the destination, and quantity **increases** | Removals and decreases  |
| `removals`  | Cards gone from the source, and quantity **decreases**         | Additions and increases |

Any other value exits with code 2. Skipped changes are still counted and reported, once per deck:

```
Syncing "Winota Stax" (pull)...
  Skipped 3 removals (applying additions only).
  Changes: +2 added, -0 removed, ~1 quantity changed
```

The filter applies to cards only. A pull still adopts the deck's Archidekt format, and a deck whose only change is a format change still saves.

The admin Sync Decks page offers the same choice as an _All changes / Additions only / Removals only_ control, and the MCP `sync_decks` tool takes it as an `only` field.

## Scripted Output

With `--output json` (or `ndjson`), progress logging is suppressed and a single report is emitted on stdout:

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
  "unreadable": [],
  "cancelled": false
}
```

- Each deck's `status` is `synced`, `failed`, or `skipped`; `reason` explains anything other than a clean sync.
- Decks that could not be resolved, or that are not sourced from Archidekt, appear as `failed`. A deck with an Archidekt `sourceUrl` but no `sourceId` is `skipped` in an all-decks run and `failed` when you name it explicitly.
- Under [`--sync-printings`](#printing-sync---sync-printings) each deck also carries `printingsChanged` (printing differences applied, or previewed on a dry run). Without the flag, a deck whose printings disagree between the two sides carries `printingsUnaligned` (those card names).
- `unreadable` lists any deck whose file holds lines the parser could not read, with those lines. See [Unreadable Lines](#unreadable-lines).
- `cancelled` is always `false` on the CLI. The [admin API](/admin/api/#sync-decks) and the MCP `sync_decks` tool set it when a client cancels between decks.

Top-level failures (for example, not being signed in) are emitted as a structured error on stderr.

## Run Summary

A text-mode run closes with a one-line tally:

```
Synced 4 decks (2 with changes), 1 skipped, 1 failed.
```

"with changes" counts decks that actually moved cards, as opposed to decks already in sync. A dry run says `[dry-run] Would sync …` instead. A run that covered no decks prints only `No Archidekt decks found to sync.`

## Divergence Guard (push)

A push makes Archidekt match your local file, so a card added on archidekt.com since your last sync would be set to quantity 0. To catch that, a push compares the remote deck's `updatedAt` against the `sourceUpdatedAt` in the deck's front matter (the remote `updatedAt` your last sync saw). If the remote changed since then, that deck **fails** and nothing is pushed for it:

```
Syncing "Winota Stax" (push)...
  Remote deck changed since last sync (remote: 2026-08-02T12:00:00.000Z, last synced against: 2026-08-01T00:00:00.000Z) — pull first, or pass --force to overwrite remote changes.
```

Two ways forward:

- `deck-sync pull` the deck first. This adopts the remote edits, after which the push has nothing to revert.
- `deck-sync push --force <deck>` to overwrite them deliberately.

Both sides of the comparison are Archidekt's clock, which is why the guard uses `sourceUpdatedAt` rather than `lastSynced` (your machine's clock).

A pull always records the baseline, even when it finds **no card changes**. Remote edits that touch no card (a rename, a category shuffle, another machine's push) still move Archidekt's `updatedAt`, so "pull first" clears the refusal in that case too. Such a pull rewrites only the deck's front matter; card lines and prose are untouched.

`--dry-run` reports the divergence the same way and does not need `--force` to preview it. A dry-run pull records nothing.

Three cases skip the check and are pushed normally. The run log names the reason, followed by `— pushing without the divergence check.`:

- A deck with no `sourceUpdatedAt`. It has never synced through Ritual, so there is nothing to compare against.
- A `sourceUpdatedAt` that is not a readable timestamp (for example, hand-edited).
- A remote response with no usable `updatedAt` (`Archidekt reported no update timestamp for this deck — pushing without the divergence check.`).

The admin Sync Decks page and the MCP `sync_decks` tool enforce the same guard. The tool takes `force: true` for the override; the admin page has no override, so pull first there.

## Linking a Deck (`deck-sync link`)

`push` only operates on decks whose front matter carries `sourceUrl` + `sourceId`, which `import`/`import-account` write. `link` writes those two fields for a deck that already exists on Archidekt:

```bash
ritual deck-sync link "Winota Stax" https://archidekt.com/decks/123456
# Linked "Winota Stax" to https://archidekt.com/decks/123456 (deck 123456).
```

- The URL must be an Archidekt **deck** URL. A scheme-less `archidekt.com/decks/123456` is accepted. A trailing deck slug and any query string are dropped, so the stored `sourceUrl` is always `https://archidekt.com/decks/<id>`, the same spelling `import` writes. Anything else is a usage error (exit code `2`).
- Only the front matter is written. Card lines (`&N` ids included), prose, and fenced blocks are preserved byte for byte.
- Re-linking a deck reports what it was linked to before.
- `-n, --dry-run` reports the link without writing. `--output json` emits the result, and `--quiet` drops the text confirmation.

This is the same write the admin API's `PUT /api/metadata/deck/:slug`, the MCP `set_list_metadata` tool, and [`ritual metadata`](/commands/metadata/) perform.

:::note[Creating a deck on Archidekt is not supported]

Linking requires the deck to **already exist** on Archidekt. Archidekt exposes no deck-creation endpoint Ritual can call, so there is no way to upload a brand-new local deck. Create it on archidekt.com first (an empty deck is enough), then `link` it and `push`.

:::

## Sync Status (`deck-sync status`)

A read-only, offline view: which decks are linked, when each last synced, and when the account's collection last synced. It needs no Archidekt session and makes no requests.

```bash
ritual deck-sync status
# 2 decks linked to Archidekt:
#   Winota Stax — https://archidekt.com/decks/123456
#     last synced: 2026-08-01T00:00:00.000Z
#   Oops All Soldiers — https://archidekt.com/decks/222
#     last synced: never
# Collection: last synced 2026-07-30T00:00:00.000Z (Archidekt user myuser).
```

`--output json` emits `{ "decks": [...], "collection": {...} | null, "collectionStateError": string | null }`. `--output ndjson` emits one tagged row per deck (`{"kind":"deck",...}`) plus one for the collection when it has synced.

A recorded collection state that exists but cannot be read is reported as such, not as `never synced`:

```
Collection: sync state unreadable (the file is not valid JSON).
```

The reason lands in `collectionStateError` under `--output json`, and as a `{"kind":"collection-state-error","reason":...}` row under `--output ndjson`. The listing is the whole payload, so `status` has no `--quiet` ([shared convention](/cli-conventions/#scripting)).

The same data backs the admin Sync Decks page and the MCP `get_sync_status` tool.

## Unreadable Lines

Both directions rewrite the deck file, so a line the parser cannot read (a stray comment, a malformed card line) would be **deleted** by the save. A [fenced code block](/list-format/#fenced-code-blocks) counts too, since the canonical writer cannot re-emit it. A sync lists every affected deck and the exact lines at stake, then asks:

```
1 deck contains lines Ritual cannot read.
Syncing rewrites the deck file, so these lines would be removed:
  winota-stax.md ("Winota Stax"):
    Skipped malformed line: buy this one later
? Sync 1 deck anyway, removing the lines above? › (y/N)
```

Answering no (the default) fails those decks; the rest of the run continues. Pass `-y, --yes` to answer yes up front.

Without a terminal to ask (`--no-input`, a piped stdin, or `--output json`/`ndjson`), the affected decks fail with `N unreadable lines would be dropped by a sync`, and the command exits 1. Pass `--yes` to sync them anyway, or fix the lines first. The listing is written to stderr in every mode, and every report carries an `unreadable` array with the same decks and lines.

`--dry-run` is exempt: a preview writes nothing, so there is nothing to confirm. The lines are listed and the deck is previewed like any other.

## Failure Behavior

Per-deck failures (a failed Archidekt fetch or push, cards that could not be turned into upload entries, a deck name that did not resolve) are reported as they happen, and the sync continues with the remaining decks. If any deck failed, a summary such as `2 of 5 decks failed` is printed to stderr and the command exits 1. It exits 0 only when every deck synced cleanly.

## Rate Limiting

Archidekt allows about 80 requests per minute per IP. Ritual spaces requests at least 1.5 s apart (40 per minute). The budget is shared process-wide, so two syncs in the same server pace against each other.

When Archidekt answers `429 Too Many Requests`, the request is retried up to 5 times. Each retry waits out the server's `Retry-After` (capped at 60s) when given, otherwise backs off exponentially (2s, 4s, 8s, 16s, 32s). Each wait is reported as a warning. A 429 that outlives the retries fails that deck's operation like any other HTTP error.

Tune the spacing with the `RITUAL_ARCHIDEKT_MIN_INTERVAL_MS` environment variable (`0` disables it). The 429 handling is always on.

## How It Works

### Prerequisites

Sign in to Archidekt first:

```bash
ritual login archidekt
```

Decks must be linked to Archidekt: their YAML front matter carries `sourceUrl` and `sourceId`. `import`/`import-account` write those when they fetch a deck. For a deck you built locally, create it on archidekt.com and then [`deck-sync link`](#linking-a-deck-deck-sync-link) it.

### Pull (`deck-sync pull`)

1. Fetches the current deck state from Archidekt.
2. Compares cards and quantities against the local deck file, **per board** (Main, Commander, Sideboard, Maybeboard) and by card name.
3. Applies the differences to the local file, respecting each card's board:
   - New cards are added to the section matching their remote board, creating that section if needed. A new section is inserted in canonical board order (Commander, Main, Sideboard, Maybeboard) without reordering existing sections.
   - Removed cards are deleted from the board they were removed from.
   - Quantity changes are applied in place within the matching board.
   - A card that moved between boards on Archidekt is removed from its old board and added to the new one.
   - An extras section (`## Maybeboard`, `## Tokens`) left with no cards is removed along with them. Empty `## Main` and `## Sideboard` headers are kept.
4. Records all changes in the deck's `.changes.md` changelog. Card names are quoted, and changes to a non-main board name the board, such as `Added "Cavern-Hoard Dragon" to Maybeboard` or `Removed "Lightning Bolt" from Sideboard`.
5. Adopts the deck's Archidekt format, mapped onto Ritual's format keys ("Commander / EDH" becomes `commander`, "Dual Commander" becomes `duel-commander`, and so on). A format Ritual does not model (Custom, Frontier, Future Standard) leaves the local format untouched. A format change alone is enough to make the deck sync, but it is not recorded in the changelog, which tracks cards only.
6. Sets `lastSynced` and `sourceUpdatedAt` in front matter, including on a pull that found no changes (which rewrites the front matter only).

### Push (`deck-sync push`)

1. Verifies you own the Archidekt deck (skips non-owned decks with a warning).
2. Fetches the current Archidekt deck state.
3. Refuses the deck when the remote changed since its `sourceUpdatedAt`, unless `--force` was given. See [Divergence Guard](#divergence-guard-push). A refused deck is never diffed.
4. Compares local cards and quantities against the remote state, by card name only, across all boards (see the note below).
5. Pushes differences to Archidekt via their batch API:
   - New cards are resolved by name (with the local line's set as a search hint) and added.
   - Removed cards are set to quantity 0.
   - Quantity changes are set to the new absolute value.
6. Sets `lastSynced` and `sourceUpdatedAt` in front matter, **only for decks that pushed cleanly**. A deck whose cards could not all be turned into upload entries is reported `failed` and keeps its old stamps. `sourceUpdatedAt` is re-read from Archidekt after the push, since the push itself moved it.

### What Is Compared

Sync compares **card names** and **quantities**. Pulls also respect the **board** a card lives in (Main, Commander, Sideboard, Maybeboard), so cards land in the right section locally.

Pulls adopt the deck's format from Archidekt. Pushes do not send the local format back.

Not written by default:

- Specific printings (set code, collector number): synced with [`--sync-printings`](#printing-sync---sync-printings)
- Card finish (foil, etched): synced with [`--sync-printings`](#printing-sync---sync-printings)
- Labels and categories (beyond mapping to a board)
- Card condition and language

Printings are still _read_ without the flag: enough to land a quantity change on the line that holds that printing, and to report a difference the run will not act on. See [Without the flag](#without-the-flag).

> **Note on pushes:** pushes ignore board placement. The Archidekt batch API cannot target a specific remote board/category, so moving a card between boards locally is not pushed (it would otherwise re-add the card to the default mainboard on Archidekt). Board-aware behavior applies to `pull` only.

### Front Matter

After a successful sync, two fields are added or updated in the deck's YAML front matter:

```yaml
---
format: commander
sourceId: '12345'
sourceUrl: 'https://archidekt.com/decks/12345'
lastSynced: '2026-04-02T12:00:00.000Z'
sourceUpdatedAt: '2026-04-02T11:59:58.000Z'
---
```

`lastSynced` is your machine's clock at the moment of the sync; `deck-sync status` shows it. `sourceUpdatedAt` is Archidekt's own `updatedAt` for that deck as of the sync, and is the only value the [divergence guard](#divergence-guard-push) compares. Neither is hand-authored.

`format` is written on every save, whether it came from Archidekt or was inferred from the deck's sections. See [new](/commands/new/#deck-format).

## Printing Sync (`--sync-printings`)

By default the diff does not sync which printing a card line names. `--sync-printings` (valid on `pull` and `push`) also syncs each card's **set code, collector number, and finish**:

- **Pull**: a local card whose printing differs from Archidekt's is rewritten to the remote printing (`1 Sol Ring (C21:263) &5` becomes `1 Sol Ring (LTC:284) [foil] &5`), keeping its `&N` id, condition, language, and note. Each rewrite is recorded in the changelog as a `Set "<card>" printing to SET:CN …` entry. Newly added cards also carry their remote printing instead of arriving as bare names.
- **Push**: a remote entry whose printing differs from the local line is moved to the local printing. The target edition is resolved through Archidekt's printing search by set and collector number, and the entry's finish is set from the local `[foil]`/`[etched]` token. Newly added cards are placed at their exact printing rather than resolved by name and set alone.

Printing changes get their own clause on each deck's summary line: `Changes: +0 added, -0 removed, ~0 quantity changed, 3 printings changed` on a pull, `…, 3 printings to change` on a push. A deck whose only difference is a printing still syncs.

### Cards held at several printings

A card name can be held at more than one printing at once: `2 Lightning Bolt (LEA:161)` beside `1 Lightning Bolt (2XM:157)` locally, or several Archidekt entries of the same card, one per edition and finish. With `--sync-printings` these are reconciled **printing by printing** rather than by name, so both sides end up holding the same printings in the same quantities:

- Copies at a printing both sides hold have their **quantity** adjusted.
- A printing only the source holds is **added** as a new line (or a new Archidekt entry).
- A printing only the destination holds is **removed**.
- When a printing on each side is left over, the destination's copies are **re-pointed** to the source's printing in place. The local line keeps its `&N`, and the Archidekt entry keeps its categories and relation.

So a local deck holding `2 Lightning Bolt (LEA:161)` and `1 Lightning Bolt (2XM:157)` pushed against a remote holding `3 Lightning Bolt (LEA:161)` sets the existing entry to 2 and adds a new 2XM entry for the third copy.

The rules:

- **A line that names no printing pushes nothing.** A bare `1 Sol Ring` states no preference, so a push leaves the remote edition alone. A pull stamps the remote printing onto it, since Archidekt entries always name an edition.
- **A stated finish must exist.** Pushing `[etched]` for a printing that has no etched finish on Archidekt fails that deck instead of silently substituting another finish. The rest of the deck's changes still push, but its `lastSynced` is withheld. An _unstated_ finish falls back to the printing's default, so a bare line on a foil-only printing does not fail.
- **`--only` does not filter printing updates.** Changing a printing neither adds nor removes cards.
- **Condition and language are never synced.** Archidekt deck entries carry neither.

### Without the flag

A sync that is _not_ syncing printings never adds or removes a card to reconcile a printing. A card's new total is spread over the lines (or Archidekt entries) it already occupies: a surplus lands on the first, a shortfall drains from the last backwards, so a card split across printings keeps its split. When the two sides hold genuinely different printings of a card, the run says so and moves on:

```
Printings not synced for "Lightning Bolt": the local file and Archidekt hold
different printings of it. Re-run with --sync-printings to reconcile them.
```

Those card names are reported as `printingsUnaligned` in the structured report (omitted when there are none). Only a printing with _no counterpart at all_ on the other side counts, since squaring that up would mean adding or removing copies. A card the two sides merely hold at different printings is not reported, and neither is a line that names no printing.

The admin [Sync Decks](/admin/sync-decks/) page offers the same behavior as a checkbox ("Also sync each card's exact printing…"), and the MCP `sync_decks` tool takes it as a `syncPrintings` field.

## Exit Codes

| Code | Meaning                                                                                                                                              |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Every deck synced cleanly (or there was nothing to sync)                                                                                             |
| `1`  | At least one deck failed — including a deck refused for [unreadable lines](#unreadable-lines) — or you are not signed into Archidekt                 |
| `2`  | Unknown subcommand, an invalid `--only` value, a `link` URL that is not an Archidekt deck URL, or a `link` deck name that matches more than one deck |
| `3`  | `link` named a deck that does not exist                                                                                                              |

## Examples

Pull changes for a specific deck:

```bash
ritual deck-sync pull black-panther
```

Push changes for multiple decks:

```bash
ritual deck-sync push black-panther oops-all-soldiers
```

Pull for all Archidekt decks:

```bash
ritual deck-sync pull
```

Preview a push without sending anything:

```bash
ritual deck-sync push --dry-run
```

Pull new cards without letting a pull delete anything locally:

```bash
ritual deck-sync pull --only additions
```

Sync in a script, accepting the loss of any lines Ritual cannot read:

```bash
ritual deck-sync pull --yes --no-input
```

Script a pull and inspect per-deck results:

```bash
ritual deck-sync pull --output json
```

Link a locally built deck to an empty deck you created on Archidekt, then push it:

```bash
ritual deck-sync link "Alpha Deck" https://archidekt.com/decks/123456
ritual deck-sync push "Alpha Deck"
```

See what is linked and when it last synced:

```bash
ritual deck-sync status --output json
```

Overwrite remote edits made since your last sync:

```bash
ritual deck-sync push "Winota Stax" --force
```

Push the exact printings and finishes you picked locally to Archidekt:

```bash
ritual deck-sync push "Winota Stax" --sync-printings
```
