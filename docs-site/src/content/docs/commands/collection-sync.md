---
title: 'collection-sync'
---

Sync your collection lists with the Archidekt collection of the account you are signed into.

The same sync runs from the admin site's [Sync Collection](/admin/sync-collection/) page and from
the MCP `sync_collection` tool — all three share one engine, so the rules below apply everywhere.

This is the collection counterpart to [deck-sync](/commands/deck-sync/), and the shape of the
problem differs in one important way: an Archidekt account has **one** collection, while Ritual
has **many** collection lists (Blue Binder, Long Box, …). A run therefore compares the union of
the collection lists in scope against the whole remote collection. There is no per-file link —
the connection is the logged-in account.

## Usage

```bash
./ritual collection-sync pull [lists...]
./ritual collection-sync push [lists...]
```

## Arguments

| Argument      | Description                                                                                                     | Required |
| ------------- | --------------------------------------------------------------------------------------------------------------- | -------- |
| `<direction>` | `pull` (Archidekt → local) or `push` (local → Archidekt). Any other value exits with code 2.                    | Yes      |
| `[lists...]`  | Collection lists to sync (matched case- and accent-insensitively, no `.md`). If omitted, every collection list. | No       |

Each name is matched case- and accent-insensitively with a unique-substring fallback, within
collection lists only. An ambiguous or unknown name is reported as a **failed** list (not
`skipped`) and the run exits 1; since resolution is already collection-scoped, the error asks you
to type more of the name rather than suggesting type flags this command does not have. See
[List Resolution](/commands/list-resolution/).

## Options

| Option                      | Description                                                                                                                   | Default                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `-n, --dry-run`             | Report what would sync without writing files or pushing changes                                                               | `false`                     |
| `-y, --yes`                 | Sync collection lists with unreadable lines without asking                                                                    | `false`                     |
| `--only <changes>`          | Apply only `additions` or `removals` (relative to the sync destination)                                                       | all changes                 |
| `--into <list>`             | Collection list a pull adds new cards to, created if needed                                                                   | `collectionSync.pullTarget` |
| `--removal-priority <list>` | Collection list an [ambiguous removal](#ambiguous-removals) may take copies from. Repeatable; the order given is the priority | none                        |
| `--csv`                     | Upload a push's new cards as one [CSV import](#csv-import-for-new-cards) instead of adding them one at a time                 | automatic above 25          |
| `--csv-file <path>`         | Write a push's new cards to this CSV file for a manual upload **instead of** pushing them                                     | none                        |
| `--refresh <mode>`          | Card cache refresh policy when a push's new cards take the [CSV path](#cache-freshness): `ask`, `auto`, `no-bulk`, `never`    | `ask`                       |
| `--output <format>`         | Output format: `text`, `json`, or `ndjson`                                                                                    | `text`                      |
| `--quiet`                   | Suppress non-essential output                                                                                                 | `false`                     |

Under `--dry-run`, both directions still fetch the remote collection (the diff needs it), and a
push resolves new printings on Archidekt — an unresolvable printing is exactly what a preview
should surface — unless those additions take the [CSV path](#csv-import-for-new-cards), which
resolves nothing remotely at all (not even the printings the CSV itself cannot carry: those are
named, and a real run resolves them). A pull resolves names against the local Scryfall cache
instead, so it contacts Archidekt only for the collection itself. Either way no file is written,
nothing is sent to Archidekt, and no sync timestamp is recorded.

`--into` and `--removal-priority` apply to a pull only, and `--csv` / `--csv-file` to a push only;
passing one to the other direction warns and is otherwise ignored. `--csv` and `--csv-file`
contradict each other (upload them / do not upload them), so giving both exits with code 2.

## Prerequisites

You must be signed into Archidekt, and the stored login must name your account:

```bash
./ritual login archidekt
```

The collection is read by numeric user id, which the login records alongside the token. A login
stored before that was recorded fails with a message asking you to run `ritual login archidekt`
again.

## Scope

Both directions run in one of two scopes:

- **Whole collection** (no list arguments) — the local side is the union of every collection list.
- **Selected lists** (`collection-sync pull "Blue Binder" "Long Box"`) — the local side is the
  union of only the named lists.

The remote side is **always the whole Archidekt collection**. In the selected-lists scope you are
therefore declaring "these lists are what my Archidekt collection mirrors": cards that live only in
lists you did not name read as absent, so a push would delete their records and a pull would try to
re-add them. When the named lists are not the whole story, narrow the run with `--only` (below).

## Change Filter

`--only` narrows a run to one side of the diff. The vocabulary is **destination-relative** — the
destination is whatever the run writes to, so it is your list files on a `pull` and Archidekt on a
`push`:

| Value       | Applies                                                      | Skips                   |
| ----------- | ------------------------------------------------------------ | ----------------------- |
| `additions` | Copies missing from the destination (quantity **increases**) | Removals and decreases  |
| `removals`  | Copies gone from the source (quantity **decreases**)         | Additions and increases |

Anything other than `additions` or `removals` exits with code 2. Skipped changes are still counted
and reported once per run:

```
Skipped 3 removals (applying additions only).
```

The admin site's Sync Collection page offers the same choice as an _All changes / Additions only /
Removals only_ control, and the MCP `sync_collection` tool takes it as an `only` field.

This is what makes the selected-lists scope safe with an incomplete local picture:
`collection-sync push "Blue Binder" --only additions` uploads what that binder holds without letting
the lists you did not name look like cards you no longer own. The same applies in reverse:
`collection-sync pull --only additions` adopts new Archidekt cards without deleting anything locally.

## Pull (`collection-sync pull`)

The remote collection is the truth, with one guardrail — copies live in physical binders, and only
you know which.

1. Fetches every page of the account's Paper collection.
2. Joins both sides on `(set, collector number, finish, condition)`. Remote records that differ only
   in language, tags, or purchase price are counted together.
3. **More copies remotely than locally** → the difference is added to the **target list** as new
   card lines, carrying the printing, finish, and condition.
4. **Fewer copies remotely than locally** → the difference is removed:
   - **every copy is going** (including every printing the remote does not hold at all) → each list
     holding a copy loses all of them. However many lists are involved, there is nothing to choose
     between, so this is never ambiguous.
   - **some copies are going and they all live in one list** → that list's last lines are removed.
   - **some copies are going and they span several lists** → the run cannot know which binder the
     card left. That is an [ambiguous removal](#ambiguous-removals), and it has to be resolved
     before the run writes anything.
5. Changes are applied through the same path the editors use, so `&N` card IDs, the list's
   `.changes.md` changelog, and its content hash all behave exactly as they do for a manual edit.

### Where pulled cards land

A card that appeared on Archidekt belongs in _some_ binder, and nothing in the data says which, so
every addition goes to one designated list, resolved in this order:

1. `--into <list>` for this run
2. the [`collectionSync.pullTarget`](/configuration/#collection-sync) config key
3. `Inbox`, the built-in default

The target is matched against your lists **by name only**, never by the unique-substring rule other
list arguments use: a destination that may not exist yet must not quietly resolve to whichever list
happens to contain the word (a target of `Inbox` landing in `card-inbox`). The list is therefore
**created on first use** when nothing answers to the name exactly. If two lists do answer to it, the
run fails before anything is written — only you can say which binder was meant (see
[Ambiguous removals](#ambiguous-removals)).

### Ambiguous removals

A removal is **ambiguous** when only _some_ of a printing's copies are going and those copies live
in several lists — nothing in the data says which binder the card physically left:

```
Not removing 2 × Lightning Bolt (LEA:161): ambiguous — copies live in "Blue Binder" (1) and "Long Box" (2).
```

Taking _every_ copy is never ambiguous: each list simply loses what it holds, however many lists are
involved.

An ambiguous removal is settled in one of two ways, and until every one of them is settled **the run
writes nothing at all** — not even the changes it could have made on its own, and not the account's
sync timestamp. There is no partial, one-card-at-a-time sync.

**1. A removal priority.** `--removal-priority <list>` names a list ambiguous copies may be taken
from; repeat it to give a fallback order. Copies are taken only from those lists, walking them in
the order given and removing each list's last lines first:

```bash
./ritual collection-sync pull --removal-priority "Long Box" --removal-priority "Blue Binder"
```

Names are matched **by name only** (like `--into`), never by the unique-substring rule — a priority
is a promise about which binders may lose cards. An unknown (or ambiguous) name fails the run
immediately after the local lists load and **before the remote collection is fetched**: the check is
purely local, so a typo costs milliseconds rather than a multi-minute paged fetch. `--into` is
checked at the same moment — a name two lists answer to fails the run there, since only you can say
which binder was meant (a name no list answers to is fine; a pull creates it). If the priority cannot fully cover a removal (its copies live elsewhere, or the priority
lists hold too few), the run fails and writes nothing, naming the cards it could not place. Placed
removals are logged with the list that lost them:

```
Removing 2 × Sol Ring (C21:240) from "Long Box" (removal priority).
```

The priority applies only to ambiguous removals — total and single-list removals proceed on their
own. When it is given it is the **only** strategy used: the run never prompts, even in a terminal.

**2. Resolving them one by one.** With no priority, `--output text`, a terminal, prompts enabled
(not `--no-input`), and no `--dry-run`, the run offers to walk the copies:

```
? 2 removals are ambiguous. Resolve them one by one now? › (y/N)
Lightning Bolt (LEA:161): 2 to remove — copies live in "Blue Binder" (1) and "Long Box" (2).
? Which list lost Lightning Bolt (LEA:161)? (copy 1 of 2) › Blue Binder (1 left)
                                                            Long Box (2 left)
```

Each prompt offers only the lists that still hold a copy, with the count left in each. Declining the
first question, or cancelling any prompt part way through, aborts everything: nothing is written.
`--yes` does **not** answer these prompts — it covers unreadable lines only.

**Anywhere else** — `--output json`/`ndjson`, a piped stdin, `--no-input`, or any non-CLI surface
without a removal priority — the run fails and writes nothing:

```
1 ambiguous removal needs a decision. Pass --removal-priority <list> (repeatable, in priority order) to say which lists may lose copies, or run in a terminal to resolve them one by one. Nothing was written.
```

The reason is whichever one applies — no terminal, the offer declined, or a session cancelled part
way through — and a surface that cannot resolve them at all (the admin site, the MCP tool) instead
names the cards: `Could not place 2 × Lightning Bolt (LEA:161): the removals are ambiguous and were
not resolved. Nothing was written.`

Either way the message lands in the report's `errors` (so `--output json` carries it too), the
command exits 1 after printing `Not synced: …` rather than `Synced: …`, and the report's `ambiguous`
array carries every removal with its per-list copy counts.

The other surfaces take the same priority and behave the same way — they simply cannot prompt: the
admin site's [Sync Collection](/admin/sync-collection/#removals-it-will-not-guess-at) page has an
ordered **Removal priority** picker, and the MCP `sync_collection` tool a `removalPriority` array.

`--dry-run` never prompts and never fails on an ambiguity itself: it reports each ambiguous removal,
and with a priority it also reports how that priority would place each one — or that a real run
would fail. An unknown `--removal-priority` name still fails a dry run, since that is a bad argument
rather than an unresolved removal.

Other ways out: sync fewer lists (`collection-sync pull "Blue Binder"`), or narrow the run with
`--only additions` so removals are skipped entirely.

### When a list in scope cannot be read

A list that does not make it into the comparison — a name that does not resolve, a file that cannot
be read, or one [held back for unreadable lines](#unreadable-lines) — makes the cards it holds look
like they exist only on Archidekt. The run therefore withholds exactly the changes that shortfall
would manufacture, and says so:

- a **pull** adds nothing (it would copy that whole file into the target list);
- a **push** removes nothing (it would delete those cards from your Archidekt collection).

Everything else still applies, and the report's `localIncomplete` flag records that it happened. Fix
or accept the listed lists and run again.

## Push (`collection-sync push`)

The union of the in-scope lists is the truth, and the account's records are reshaped to match it.

1. **A printing with no remote record** → the exact printing is resolved on Archidekt (by name, set,
   and collector number) and a new record is created. A printing that cannot be resolved is a
   per-card failure: the run continues and the affected lists are reported as failed. Above 25 new
   printings this changes: they go through a [CSV import](#csv-import-for-new-cards) instead, which
   needs no search at all.
2. **More copies locally** → the leading record's quantity is raised.
3. **Fewer copies locally** → records are consumed from the end (odd languages and small records
   first), trimming the one that only partly covers the difference and deleting the rest.
4. **A printing that is gone from every list** → all of its records are deleted.

Deletions batch through Archidekt's own bulk endpoint, 25 records per request — removals never go
through the CSV path. The "clear collection" endpoint is never used, and a push never writes to your
list files (the only file it can write is the CSV `--csv-file` asks for).

:::caution[A collection push is last-writer-wins]

Unlike [`deck-sync push`](/commands/deck-sync/#divergence-guard-push), a collection push has **no
divergence guard**: cards added on archidekt.com since your last sync read as "gone from every list"
and are deleted. There is no cheap check that would catch it — a collection is a set of records with
no collection-level timestamp and no tombstones, so a record that was added and one that never
existed look alike from the local side. Use `--dry-run`, or `--only additions`, when you have been
editing your collection on Archidekt as well.

:::

### CSV import for new cards

Adding a printing costs two Archidekt requests — a search to find it, then a create — and every
request is [paced 500 ms apart](#rate-limiting), so a first push of a real collection would take
hundreds of them. Above **25 new printings** a push sends its additions through Archidekt's own
collection importer instead: one CSV, one upload, no searches.

The rows come entirely from your **local Scryfall cache**, so building the file costs nothing:

```csv
Scryfall ID,Quantity,Variant,Condition
1b59533a-3e38-495d-873e-2f89fbd08494,2,Normal,NM
7d4c1a0e-1e6a-4c6f-b6a4-4c0f2e2a9f11,1,Etched,D
```

It is exactly what `ritual export --preset archidekt` writes — the same preset, so the two can never
disagree — in Archidekt's own spellings rather than Ritual's: the variant is `Normal` / `Foil` /
`Etched` (never `nonfoil`), and Damaged is **`D`**, not Ritual's `DMG`. One row is one printing, so
a printing you own three copies of is a single row with `Quantity` 3. Uploads are chunked at 2000
rows per request, as Archidekt's own importer does.

Only **additions** ride the CSV. Quantity increases stay individual updates, and removals use
Archidekt's bulk-delete API — the same one the site's own multi-select uses, 25 records per request.

#### Choosing the route

| Situation                     | What happens                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| 25 or fewer new printings     | Added one at a time, exactly as before                                                    |
| `--csv`                       | Always uploaded as one CSV import, however few — no prompt                                |
| `--csv-file <path>`           | Always written to that file **instead of** being pushed — no prompt                       |
| More than 25, in a terminal   | You are asked (below)                                                                     |
| More than 25, non-interactive | The run fails and pushes **nothing**, naming both flags                                   |
| More than 25, `--dry-run`     | Reported as `would upload N cards (M rows) as a CSV import` — nothing is searched or sent |

Whichever way the CSV path is reached, it needs a reasonably fresh card cache — see
[Cache freshness](#cache-freshness).

In a terminal (text output, prompts enabled, not `--dry-run`) the run stops and asks:

```
? 40 cards would be added — more than 25. How should they reach Archidekt? › - Use arrow-keys
❯ Upload them automatically as one CSV import (recommended)
  Save the CSV to a file for a manual upload
  Add them individually (slow; may be rate limited)
  Cancel the run
```

Saving to a file then asks where, prefilled with a dated name like
`archidekt-import-2026-07-27.csv`. Cancelling — or escaping either prompt — fails the run without
pushing anything.

Without a terminal (`--output json`/`ndjson`, a pipe, or `--no-input`) there is nobody to ask, so the
run refuses before touching Archidekt:

```
26 cards would be added — more than 25, so adding them one at a time would cost 26 printing searches. Pass --csv to upload them as one CSV import, or --csv-file <path> to write the CSV for a manual upload. Nothing was pushed.
```

The question is settled **before the first remote write**, exactly as an
[ambiguous removal](#ambiguous-removals) is settled before the first file write: a refused or
cancelled decision leaves your Archidekt collection untouched — no creates, no quantity changes, no
deletions.

The server surfaces cannot prompt either, so they carry the answer up front: the
[admin Sync Collection page](/admin/sync-collection/#new-cards-on-a-push) has an
**Upload new cards as one CSV import** toggle (on by default) and the
[`sync_collection`](/commands/mcp/#destructive) MCP tool takes `csv: true`; without it a large push
fails without pushing anything, saying so. `--csv-file` has no equivalent there — a server does not
write files a caller names, and a request carrying `csvFile` is rejected.

#### Cache freshness

Every uploaded row is keyed by the Scryfall ID your **local card cache** holds for that printing, so
a stale or empty cache means rows that quietly go missing — and the additions they carried falling
back to one paced search each, which is the whole thing the CSV path exists to avoid. Freshness is
therefore a requirement here rather than a suggestion: a run whose additions take the CSV path (over
the threshold, `--csv`, or `--csv-file`) checks the cache before it builds the file, and
`--refresh <mode>` decides what happens when it is empty or more than a day old:

| `--refresh` | Empty or day-old cache                                                      |
| ----------- | --------------------------------------------------------------------------- |
| `ask`       | Prompts (default **yes**); declining fails the run without pushing anything |
| `auto`      | Redownloads the Scryfall bulk data, then continues                          |
| `no-bulk`   | Fails the run — the cache is only ever filled by a bulk download            |
| `never`     | Fails the run                                                               |

Without a terminal, `ask` cannot prompt, so it fails the same way `never` does:

```
Archidekt CSV uploads are configured to require Scryfall IDs from the local card cache, which is empty. Run `ritual cache preload-all`, or re-run with --refresh auto. Nothing was pushed.
```

The check runs after the remote collection is read (the additions are not known before the diff) but
**before the first remote write**, so a refusal leaves your collection exactly as it was. The server
surfaces cannot prompt, so they treat freshness as `auto` and report the refresh in the run log.

#### Cards the cache cannot resolve

A row is keyed by its Scryfall ID, so a printing missing from the local cache cannot ride the CSV
even after a refresh (a card too new for the cached bulk data, say). Those additions are reported and
added the slow way instead (one search, one create each):

```
1 addition cannot ride the CSV (the printing is not in the Scryfall cache); it is added one at a time instead.
```

Under `--dry-run` they are named rather than resolved — a preview of a large push makes no per-card
request whatsoever:

```
[dry-run] Would add 1 × Card 3 (LTC:3) one at a time — the printing is not in the Scryfall cache, so it cannot ride the CSV and was not resolved here.
```

It applies to `--csv-file` too: the printings the cache knows wait in the file, and the few it does
not are still pushed one at a time (there is no row to write them into). The report's `csv.uncached`
counts them, and when the cache can key _none_ of the additions the report says so with
`csv.status: "empty"` — no file was built at all.

#### Writing the CSV instead of pushing (`--csv-file`)

`--csv-file <path>` writes the same file and pushes **no** additions the CSV could carry; quantity
changes and removals still push normally. The cards are counted as _pending_ rather than added — they
are in a file, not in your account — and the run says so:

```bash
./ritual collection-sync push --csv-file archidekt-import.csv
```

```
Wrote 40 cards (37 rows) to archidekt-import.csv; they were not pushed. Import the file at https://archidekt.com/collections/import.
Synced: +0 added, -3 removed, 40 awaiting upload.
40 cards were not pushed: upload archidekt-import.csv at https://archidekt.com/collections/import to add them.
```

Upload it on Archidekt at **Collection → Import** (`archidekt.com/collections/import`), mapping the
columns as `Scryfall ID`, `Quantity`, `Variant`, `Condition` — the header row names them exactly
that way.

#### When Archidekt rejects rows

An upload answers with one result per row. Rows it did not import are warned about with counts, the
first ten named individually, and the lists holding those cards are reported as **failed**:

```
Archidekt did not import 2 of 37 CSV rows (1 not found, 1 rejected).
  Not imported: Sol Ring (C21:240) — not found on Archidekt.
```

A whole upload that fails (a non-2xx response) fails those additions and nothing else: the run's
quantity changes and removals still apply, and the additions are **not** retried one at a time — a
partial import would otherwise be imported twice. Re-run the push once the problem is fixed; only
the remaining differences are sent.

A push refuses to run at all when there is nothing readable to push (every in-scope list failed to
load, or none were named and none exist) — the alternative is reading that as "the collection is
empty" and deleting the whole account collection.

## What Is Compared

The join key is the **printing** (set code and collector number) plus **finish** and **condition** —
Ritual's five conditions are exactly Archidekt's, so `NM`/`LP`/`MP`/`HP`/`DMG` round-trip as-is. A
line with no explicit finish is resolved against the card cache first, so an etched-only printing
compares as etched rather than as a nonfoil copy of the same number. A printing the cache does not
hold is synced as nonfoil, with a warning naming the line. That resolution is **cache-only** — a sync
never fetches cards from Scryfall one at a time, so a cold cache means many nonfoil warnings rather
than hundreds of live requests. Run [`ritual cache preload-all`](/commands/cache/) before a first
sync to get finishes resolved.

The following have no local representation and are **lossy** — they are preserved on records that
already exist, but nothing local can set them:

| Dimension      | Behavior                                                                                      |
| -------------- | --------------------------------------------------------------------------------------------- |
| Language       | Records Ritual creates are English. Other languages are read (and counted) but never written. |
| Tags           | Records Ritual creates carry no tags; existing tags survive a quantity change.                |
| Purchase price | Records Ritual creates have none; an existing price survives a quantity change.               |
| Game           | Fixed to **Paper**. MTGO and Arena collections are not synced.                                |
| Sections       | Local only. A pull adds into the target list's `Main`; a push flattens sections.              |
| Notes          | Local only, and never sent.                                                                   |

## Deck-Style Quantity Prefixes

Collections hold **one line per copy**, so there is no quantity field on a card line: everything
between `- ` and the printing is the card name. A deck-style line pasted into a collection —
`- 1 Sol Ring (C21:240)` — therefore parses as a card _named_ `1 Sol Ring`, which matches nothing in
the cache, on Scryfall, or on Archidekt.

A `collection-sync` run, a `cleanup` run, and the CLI editors each say so, once per offending line:

```
Card name starts with a quantity, so the line reads as a card named '1 Sol Ring': - 1 Sol Ring (C21:240) — collections and wanted lists hold one line per copy; remove the leading quantity.
```

This is an **advisory**, not an [unreadable line](#unreadable-lines): the line parses and a save
re-emits it verbatim, so it never blocks a sync, a save, or `cleanup` (which reports it while still
rewriting the file in canonical form) — it just tells you the name
is not the name you meant. Only a 1–3 digit leading integer triggers it, so a card genuinely named
`1996 World Champion` parses untouched. Wanted lists, which are also one line per copy, behave the
same way.

## Unreadable Lines

A list file may hold lines the parser cannot read — a stray comment, a malformed card line — or a
[fenced code block](/commands/edit/#fenced-code-blocks), which parses cleanly as prose but which the
canonical serializer cannot re-emit. Both directions refuse to sync such a list without
confirmation, because both directions would lose that content: a pull rewrites the file (deleting
it), and a push treats the file as the truth (so the cards on those lines are deleted from your
Archidekt collection).

```
1 collection list contains lines Ritual cannot read.
A pull rewrites the list file, so these lines would be removed:
  binder.md ("Blue Binder"):
    Skipped malformed line: // sort these later
? Sync 1 collection list anyway, removing the lines above? › (y/N)
```

Answering no (the default) fails those lists; the rest of the run continues. Pass `-y, --yes` to
answer yes up front.

Without a terminal to ask — `--no-input`, a piped stdin, or `--output json`/`ndjson`, which owns
stdout — the run does not prompt: the affected lists fail and the command exits 1. The listing is
written to stderr in every mode, and every report carries an `unreadable` array with the same lists
and lines.

`--dry-run` is exempt: a preview writes nothing, so there is nothing to confirm.

## Scripted Output

With `--output json` (or `ndjson`), progress logging is suppressed and a single report is emitted on
stdout:

```json
{
  "direction": "pull",
  "into": "Inbox",
  "dryRun": false,
  "lists": [
    { "name": "binder", "status": "synced", "added": 0, "removed": 1, "pending": 0 },
    {
      "name": "long-box",
      "status": "synced",
      "reason": "no changes",
      "added": 0,
      "removed": 0,
      "pending": 0
    },
    { "name": "Inbox", "status": "synced", "added": 3, "removed": 0, "pending": 0 }
  ],
  "failedCount": 0,
  "errors": [],
  "unreadable": [],
  "ambiguous": [
    {
      "key": "c21|240|nonfoil|NM",
      "parts": { "set": "c21", "collectorNumber": "240", "finish": "nonfoil", "condition": "NM" },
      "name": "Sol Ring",
      "quantity": 1,
      "lists": [
        { "list": "binder", "copies": 1 },
        { "list": "long-box", "copies": 2 }
      ]
    }
  ],
  "localIncomplete": false,
  "csv": null,
  "totals": { "added": 3, "removed": 1, "skipped": 0, "pending": 0 }
}
```

- `into` is the list a pull adds to, and `null` on a push.
- Each list's `status` is `synced`, `failed`, or `skipped`; `added`, `removed`, and `pending` count
  **copies**, not lines, and a printing held in several lists counts for each of them.
- `errors` holds failures that belong to the run rather than to one list — the collection fetch, or
  records for cards that live in no list any more. They fail the run just as a failed list does.
- `localIncomplete` is `true` when a list in scope did not make it into the comparison, which is why
  a run may report fewer changes than expected (see
  [When a list in scope cannot be read](#when-a-list-in-scope-cannot-be-read)).
- `ambiguous` holds the removals a pull could not place by itself, each with the lists holding
  copies and how many each holds. They are reported whether a
  [resolution strategy](#ambiguous-removals) placed them or not; when none could, `errors` says so
  and the run wrote nothing.
- `totals.skipped` counts the changes `--only` left out; `totals.pending` counts copies written to a
  `--csv-file` rather than pushed (they are deliberately **not** part of `added`).
- `csv` describes what the [CSV path](#csv-import-for-new-cards) did with a push's additions, and is
  `null` on any run that did not take it. Every shape carries `cards` (copies), `rows`, and
  `uncached` (additions the cache could not resolve, added one at a time instead), plus:

  | `status`   | Extra fields                                              | Meaning                                           |
  | ---------- | --------------------------------------------------------- | ------------------------------------------------- |
  | `uploaded` | `chunks`, `failures[]`                                    | Imported; `failures` names the rows dropped       |
  | `exported` | `path`                                                    | Written to `path`, awaiting a manual upload       |
  | `planned`  | `destination` (`upload`/`export`), `path` when applicable | What `--dry-run` would have done                  |
  | `failed`   | `message`                                                 | The whole CSV failed; the rest of the run applied |

  ```json
  {
    "status": "uploaded",
    "cards": 40,
    "rows": 37,
    "uncached": 1,
    "chunks": 1,
    "failures": [
      {
        "row": 12,
        "card": "Sol Ring (C21:240)",
        "ambiguous": false,
        "notFound": true,
        "errors": []
      }
    ]
  }
  ```

Top-level failures (for example, not being signed in) are emitted as a structured error on stderr.

## Failure Behavior

Per-list failures — a list that did not resolve, a file that could not be read or saved, a printing
that could not be resolved on Archidekt — are reported as they happen and the run continues with the
rest. If any list failed, a summary such as `2 of 5 collection lists failed` is printed to stderr
and the command exits 1.

An [unresolved ambiguous removal](#ambiguous-removals) is different: it stops the whole pull before
anything is written, lands in the report's `errors`, and exits 1 with every list file untouched —
including the target list a pull would otherwise have created, and the account's sync timestamp. The
closing line reads `Not synced: …` rather than `Synced: …`.

## Rate Limiting

Requests to Archidekt are spaced at least 500 ms apart, so a large first push proceeds at roughly
two requests per second. When Archidekt answers `429 Too Many Requests`, the request is retried up
to 5 times — waiting out the server's `Retry-After` when it names one, otherwise backing off
exponentially (1s, 2s, 4s, … capped at 30s) — with each wait reported as a warning like
`Rate limited by Archidekt — waiting 4s before retry 2 of 5.` A 429 that outlives the
retry budget fails that card's operation like any other HTTP error; re-running the sync later is
safe and cheap, because only the remaining differences are pushed.

The spacing can be tuned with the `RITUAL_ARCHIDEKT_MIN_INTERVAL_MS` environment variable
(`0` disables it); the 429 handling is always on.

This is why a large push does not add cards one at a time: above 25 new printings the additions
become a single [CSV import](#csv-import-for-new-cards), and a `--dry-run` of the same push makes no
per-card request at all.

## Exit Codes

| Code | Meaning                                                                                                                                                                                       |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Everything synced cleanly (or there was nothing to sync)                                                                                                                                      |
| `1`  | A list or the run itself failed (an unresolved ambiguous removal or an undecided [CSV question](#csv-import-for-new-cards) included), or you are not signed into Archidekt with an account id |
| `2`  | Missing or invalid `<direction>`, `--only`, a blank `--into` / `--removal-priority` / `--csv-file`, or `--csv` together with `--csv-file`                                                     |

## Examples

Pull the whole collection, letting new cards land in the configured target list:

```bash
./ritual collection-sync pull
```

Pull into a specific binder:

```bash
./ritual collection-sync pull --into "Blue Binder"
```

Pull unattended, letting the overflow box give up any copies the run cannot place on its own:

```bash
./ritual collection-sync pull --removal-priority "Long Box" --removal-priority "Blue Binder"
```

Push one binder's contents without letting the lists you did not name look like losses:

```bash
./ritual collection-sync push "Blue Binder" --only additions
```

Preview a whole-collection push (over 25 new printings this makes no per-card request at all):

```bash
./ritual collection-sync push --dry-run
```

Push a big first collection unattended, uploading the new cards as one CSV import:

```bash
./ritual collection-sync push --csv
```

Write the new cards to a CSV to check (or upload) yourself, pushing only the removals:

```bash
./ritual collection-sync push --csv-file archidekt-import.csv
```

Script a pull and inspect the per-list results:

```bash
./ritual collection-sync pull --output json
```
