---
title: 'deck-sync'
---

Sync deck card lists between local files and Archidekt.

The same sync runs from the admin site's [Sync Decks](/admin/sync-decks/) page and from the MCP
`sync_decks` tool — all three share one engine, so the rules below apply everywhere.

## Usage

```bash
./ritual deck-sync pull [decks...] [--sync-printings]
./ritual deck-sync push [decks...] [--force] [--sync-printings]
./ritual deck-sync link <deck> <url>
./ritual deck-sync status
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

| Argument     | Description                                                                                                           | Required |
| ------------ | --------------------------------------------------------------------------------------------------------------------- | -------- |
| `[decks...]` | Deck names to sync (matched case- and accent-insensitively, no `.md`). If omitted, syncs all Archidekt-sourced decks. | No       |

Each name is matched case- and accent-insensitively with a unique-substring fallback, within decks only. An ambiguous or unknown name is reported as a **failed** deck (not `skipped`) and the run exits 1; since resolution is already deck-scoped, the error asks you to type more of the name rather than suggesting type flags this command does not have. See [List Resolution](/commands/list-resolution/).

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

A pull never writes to Archidekt, so it has no remote changes to overwrite and registers no
`--force` at all (passing it there is a usage error).

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
anything other than a clean sync. Under
[`--sync-printings`](#printing-sync---sync-printings) each deck also carries
`printingsChanged` (printing differences found — applied, or previewed on a dry
run); without the flag, a deck whose printings disagree between the two sides
carries `printingsUnaligned` (those card names). Either way a scripted run sees
the printing pass without parsing log lines. Decks that could not be resolved or are not
sourced from Archidekt appear as `failed` entries. A deck with an Archidekt
`sourceUrl` but no `sourceId` is `skipped` when it is swept up by an all-decks
run, and `failed` when you name it explicitly. Top-level failures (for example,
not being signed in) are emitted as a structured error on stderr.

## Run Summary

A text-mode run closes with a one-line tally, the counterpart of the report emitted under
`--output json`:

```
Synced 4 decks (2 with changes), 1 skipped, 1 failed.
```

"with changes" separates decks that actually moved cards from decks that were already in sync. A
dry run says `[dry-run] Would sync …` instead. A run that covered no decks prints only the engine's
`No Archidekt decks found to sync.`

## Divergence Guard (push)

A push makes Archidekt match your local file: a card added on archidekt.com since your last sync
reads as "gone from the source" and is set to quantity 0. To stop that from being silent, a push
compares the remote deck's `updatedAt` against the `sourceUpdatedAt` in the deck's front matter —
the remote `updatedAt` your last sync observed. If the remote changed since then, that deck
**fails** and nothing is pushed for it:

```
Syncing "Winota Stax" (push)...
  Remote deck changed since last sync (remote: 2026-08-02T12:00:00.000Z, last synced against: 2026-08-01T00:00:00.000Z) — pull first, or pass --force to overwrite remote changes.
```

Two ways forward: `deck-sync pull` the deck first (adopting the remote edits, after which the push
has nothing to revert), or `deck-sync push --force <deck>` to overwrite them deliberately.

**Both sides of that comparison are Archidekt's clock**, which is why it is `sourceUpdatedAt` and
not `lastSynced`: `lastSynced` is your machine's wall clock, and a computer running even a little
behind the server would otherwise diverge against the very push it had just made, with no way back
except `--force`.

A pull always records the baseline — including a pull that found **no card changes at all**. Remote
edits that touch no card (a rename, a category shuffle, another machine's push) still move
Archidekt's `updatedAt`, so "pull first" has to clear the refusal in that case too. Such a pull
rewrites only the deck's front matter; the card lines and prose below it are untouched.

`--dry-run` reports the divergence the same way and does not need `--force` to preview it — a
preview should say what the real run would do. A dry-run pull records nothing.

Two cases cannot diverge, and are pushed normally:

- A deck with no `sourceUpdatedAt` — it has never synced through Ritual, so there is no moment to
  compare against.
- A remote response carrying no usable `updatedAt`. The guard cannot run, so the push proceeds, but
  the run log says so: `Archidekt reported no update timestamp for this deck — pushing without the
divergence check.`

The admin site's Sync Decks page and the MCP `sync_decks` tool enforce the same guard; the tool
takes `force: true` for the override, and the admin page has no override — pull first there.

## Linking a Deck (`deck-sync link`)

`push` only operates on decks whose front matter carries `sourceUrl` + `sourceId`, which normally
only `import`/`import-account` produce. `link` writes those two fields for a deck that already
exists on Archidekt:

```bash
./ritual deck-sync link "Winota Stax" https://archidekt.com/decks/123456
# Linked "Winota Stax" to https://archidekt.com/decks/123456 (deck 123456).
```

- The URL must be an Archidekt **deck** URL. A trailing deck slug and any query string are dropped —
  the stored `sourceUrl` is always canonical (`https://archidekt.com/decks/<id>`), which is the
  spelling `import` writes. A scheme-less `archidekt.com/decks/123456` is accepted. Anything else is
  a usage error (exit code `2`).
- Only the front matter is written: the deck's card lines (`&N` ids included), prose, and fenced
  blocks are preserved byte for byte.
- Re-linking a deck reports what it was linked to before.
- `-n, --dry-run` reports the link without writing; `--output json` emits the result, and `--quiet`
  drops the text confirmation.

This is the same write the admin API's `PUT /api/metadata/deck/:slug`, the MCP `set_list_metadata`
tool, and [`ritual metadata`](/commands/metadata/) perform — all four go through one front-matter
writer, so linking behaves identically wherever you do it.

:::note[Creating a deck on Archidekt is not supported]

Linking requires the deck to **already exist** on Archidekt. Archidekt exposes no deck-creation
endpoint Ritual can call, so there is no way to upload a brand-new local deck; create it on
archidekt.com first (an empty deck is enough), then `link` it and `push`.

:::

## Sync Status (`deck-sync status`)

A read-only, offline view of the sync surface — which decks are linked, when each last synced, and
when the account's collection last synced. It requires no Archidekt session and makes no requests.

```bash
./ritual deck-sync status
# 2 decks linked to Archidekt:
#   Winota Stax — https://archidekt.com/decks/123456
#     last synced: 2026-08-01T00:00:00.000Z
#   Oops All Soldiers — https://archidekt.com/decks/222
#     last synced: never
# Collection: last synced 2026-07-30T00:00:00.000Z (Archidekt user myuser).
```

`--output json` emits `{ "decks": [...], "collection": {...} | null, "collectionStateError": string | null }`;
`--output ndjson` emits one tagged row per deck (`{"kind":"deck",...}`) plus one for the collection
when it has synced.

If the recorded collection state exists but cannot be read, that is reported as such rather than as
`never synced` — a corrupt record of a sync is not the same claim as no sync:

```
Collection: sync state unreadable (the file is not valid JSON).
```

The reason lands in `collectionStateError` under `--output json`, and as a
`{"kind":"collection-state-error","reason":...}` row under `--output ndjson`. The
listing is the whole payload, so `status` registers no `--quiet`
([shared convention](/#scripting-conventions)). Being read-only, it never triggers the card-ID
backfill.

The same data backs the admin Sync Decks page and the MCP `get_sync_status` tool.

## Unreadable Lines

Both directions rewrite the deck file, so a line the parser cannot read — a stray comment, a
malformed card line — would be **deleted** by the save. A
[fenced code block](/commands/edit/#fenced-code-blocks) counts too: it parses cleanly as prose, but
the canonical serializer cannot re-emit it, so a sync would delete it just the same. Rather than let
that happen silently, a sync lists every affected deck and the exact lines at stake, then asks:

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

Archidekt's rate limit is about 80 requests per minute per IP, and requests are
spaced at least 1.5 s apart (40 per minute) to stay comfortably under it. The
budget is shared process-wide, so two syncs running in the same server pace
against each other rather than each claiming the full rate. When
Archidekt answers `429 Too Many Requests`, the request is retried up to 5
times — waiting out the server's `Retry-After` (capped at 60s) when it names
one, otherwise backing off exponentially (2s, 4s, 8s, 16s, 32s) — with each
wait reported as a warning. The curve is sized to the limit's per-minute
window: a 429 means the window is saturated, so the retries together span a
full minute rather than burning the budget on waits too short to matter. A 429
that outlives the retry budget fails that deck's operation like any other HTTP
error.

The spacing can be tuned with the `RITUAL_ARCHIDEKT_MIN_INTERVAL_MS` environment
variable (`0` disables it); the 429 handling is always on.

## How It Works

### Prerequisites

You must be signed into Archidekt before syncing:

```bash
./ritual login archidekt
```

Decks must be linked to Archidekt — that is, they carry `sourceUrl` and `sourceId` in their YAML
front matter. `import`/`import-account` write those when they fetch a deck; for a deck you built
locally, create it on archidekt.com and then [`deck-sync link`](#linking-a-deck-deck-sync-link) it.

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
   - An extras section (`## Maybeboard`, `## Tokens`) left with no cards is removed
     along with them, rather than leaving a bare header behind. Empty `## Main` and
     `## Sideboard` headers are kept
4. Records all changes in the deck's `.changes.md` changelog. Card names are written
   quoted, and changes that target a non-main board are annotated with the
   destination, e.g. `Added "Cavern-Hoard Dragon" to Maybeboard` or
   `Removed "Lightning Bolt" from Sideboard`
5. Adopts the deck's Archidekt format, mapped onto Ritual's format keys (Archidekt's
   "Commander / EDH" becomes `commander`, "Dual Commander" becomes `duel-commander`,
   and so on). A format Ritual does not model — Custom, Frontier, Future Standard —
   leaves the local format untouched. A format change alone is enough to make the
   deck sync; it is not recorded in the changelog, which tracks cards only
6. Sets `lastSynced` and `sourceUpdatedAt` in front matter — including on a pull that found no
   changes, which rewrites the front matter only

### Push (`deck-sync push`)

1. Verifies you own the Archidekt deck (skips non-owned decks with a warning)
2. Fetches the current Archidekt deck state
3. Refuses the deck when the remote changed since its `sourceUpdatedAt`, unless `--force` was given
   — see [Divergence Guard](#divergence-guard-push). A refused deck never gets as far as a diff
4. Compares local cards and quantities against the remote state (by card name only,
   across all boards — see note below)
5. Pushes differences to Archidekt via their batch API:
   - New cards are resolved by name and added
   - Removed cards are set to quantity 0
   - Quantity changes are set to the new absolute value
6. Sets `lastSynced` and `sourceUpdatedAt` in front matter — **only for decks that pushed cleanly**.
   A deck whose cards could not all be turned into upload entries is reported `failed` and keeps its
   old stamps, so the fields never claim a sync that did not fully happen. `sourceUpdatedAt` is
   re-read from Archidekt after the push, since the push itself moved it

### What Is Compared

Sync compares **card names** and **quantities**. Pulls additionally respect the
**board** a card lives in (Main, Commander, Sideboard, Maybeboard), so cards land in
the right section locally.

Pulls also adopt the deck's format from Archidekt. Pushes do not send the local
format back.

The following are intentionally not written by default:

- Specific printings (set code, collector number) — synced with [`--sync-printings`](#printing-sync---sync-printings)
- Card finish (foil, etched) — synced with [`--sync-printings`](#printing-sync---sync-printings)
- Labels and categories (beyond mapping to a board)
- Card condition and language

Printings are still _read_ without the flag — enough to land a quantity change
on the line that holds that printing, and to report a difference the run will
not act on. See [Without the flag](#without-the-flag).

> **Note on pushes:** pushes ignore board placement. The Archidekt batch API path
> used here cannot yet target a specific remote board/category, so moving a card
> between boards locally is not pushed (it would otherwise re-add the card to the
> default mainboard on Archidekt). Board-aware behavior currently applies to
> `pull` only.

### Front Matter

After a successful sync, two fields are added or updated in the deck's YAML front matter:

```yaml
---
name: 'My Deck'
format: commander
sourceId: '12345'
sourceUrl: 'https://archidekt.com/decks/12345'
lastSynced: '2026-04-02T12:00:00.000Z'
sourceUpdatedAt: '2026-04-02T11:59:58.000Z'
---
```

`lastSynced` is your machine's clock at the moment of the sync — what `deck-sync status` shows.
`sourceUpdatedAt` is Archidekt's own `updatedAt` for that deck as of the sync, and is the only
value the [divergence guard](#divergence-guard-push) compares. Neither is hand-authored.

`format` is written on every save, whether it came from Archidekt or was inferred
from the deck's sections. See [new](/commands/new/#deck-format).

## Printing Sync (`--sync-printings`)

By default the diff does not _sync_ which printing a card line names — it compares printings only
to place a quantity change on the right line and to report a disagreement it will not act on (see
[Without the flag](#without-the-flag)). `--sync-printings`
(valid on `pull` and `push`) also syncs each card's **set code, collector
number, and finish**:

- **Pull** — a local card whose printing differs from the one Archidekt records
  is rewritten to the remote printing (e.g. `1 Sol Ring (C21:263) &5` becomes
  `1 Sol Ring (LTC:284) [foil] &5`), keeping its `&N` id, condition, language,
  and note untouched. Each rewrite is recorded in the changelog as a
  `Set "<card>" printing to SET:CN …` entry. Newly added cards also carry their
  remote printing instead of arriving as bare names.
- **Push** — a remote entry whose printing differs from the local line is moved
  to the local printing: the target edition is resolved through Archidekt's
  printing search (pinned by set and collector number), and the entry's finish
  modifier is set from the local `[foil]`/`[etched]` token. Newly added cards
  are pinned to their exact printing rather than resolved by name and set alone.

Printing changes get their own clause on each deck's summary line —
`Changes: +0 added, -0 removed, ~0 quantity changed, 3 printings changed` on a
pull, `…, 3 printings to change` on a push — and a deck whose only difference
is a printing still syncs.

### Cards held at several printings

A card name can be held at more than one printing at once — `2 Lightning Bolt
(LEA:161)` beside `1 Lightning Bolt (2XM:157)` locally, and on Archidekt as
several deck entries of the same card, one per edition and finish. With
`--sync-printings` these are reconciled **printing by printing** rather than by
name, adding and removing copies as needed so the two sides end up holding the
same printings in the same quantities:

- Copies at a printing both sides hold have their **quantity** adjusted.
- A printing only the source holds is **added** as a new line (or a new
  Archidekt entry).
- A printing only the destination holds is **removed**.
- When a printing on each side is left over, the destination's copies are
  **re-pinned** to the source's printing in place — the local line keeps its
  `&N`, and the Archidekt entry keeps its categories and relation.

So a local deck holding `2 Lightning Bolt (LEA:161)` and `1 Lightning Bolt
(2XM:157)` pushed against a remote holding `3 Lightning Bolt (LEA:161)` sets the
existing entry to 2 and adds a new 2XM entry for the third copy.

The rules that keep this predictable:

- **A line that names no printing pushes nothing.** A bare `1 Sol Ring` states
  no preference, so a push leaves the remote edition alone (a pull, by
  contrast, stamps the remote printing onto it — Archidekt entries always name
  an edition).
- **A stated finish must exist.** Pushing `[etched]` for a printing Archidekt
  offers no etched finish of that card is reported as a failure for that deck
  rather than silently substituted — the rest of the deck's changes still push,
  but its `lastSynced` is withheld. An _unstated_ finish falls back to the
  printing's default, so a bare line on a foil-only printing does not fail.
- **`--only` does not filter printing updates** — rewriting a printing neither
  adds nor removes cards.
- **Condition and language are never synced**; Archidekt deck entries carry
  neither.

### Without the flag

A sync that is _not_ syncing printings never adds or removes a card to
reconcile a printing. A card's new total is spread over the
lines (or Archidekt entries) it already occupies rather than collapsed onto one
of them — a surplus lands on the first, a shortfall drains from the last
backwards — so a card split across printings keeps its split. When the two sides hold
genuinely different printings of a card, it says so and moves on:

```
Printings not synced for "Lightning Bolt": the local file and Archidekt hold
different printings of it. Re-run with --sync-printings to reconcile them.
```

Those card names are reported as `printingsUnaligned` in the structured report
(omitted when there are none). Only a printing with _no counterpart at all_ on
the other side counts: squaring that up would mean adding or removing copies. A
card the two sides merely hold at different printings is not reported — that is
a plain re-pin, which is what the flag is for — and a line that names no
printing at all never counts either, since it states no preference.

The admin [Sync Decks](/admin/sync-decks/) page offers the same behavior as a
checkbox ("Also sync each card's exact printing…"), and the MCP `sync_decks`
tool takes it as a `syncPrintings` field.

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

Link a locally built deck to an empty deck you created on Archidekt, then push it:

```bash
./ritual deck-sync link "Alpha Deck" https://archidekt.com/decks/123456
./ritual deck-sync push "Alpha Deck"
```

See what is linked and when it last synced:

```bash
./ritual deck-sync status --output json
```

Overwrite remote edits made since your last sync:

```bash
./ritual deck-sync push "Winota Stax" --force
```

Push the exact printings and finishes you picked locally to Archidekt:

```bash
./ritual deck-sync push "Winota Stax" --sync-printings
```
