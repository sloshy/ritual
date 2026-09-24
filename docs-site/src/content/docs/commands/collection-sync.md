---
title: 'collection-sync'
---

Sync your collection lists with the Archidekt collection of the account you are signed into.

The same sync runs from the admin site's [Sync Collection](/admin/sync-collection/) page and from the MCP `sync_collection` tool. All three share one engine, so the rules below apply everywhere.

Unlike [deck-sync](/commands/deck-sync/), there is no per-file link. An Archidekt account has **one** collection, while Ritual has **many** collection lists (Blue Binder, Long Box, …). A run compares the union of the lists in scope against the whole remote collection. The connection is the logged-in account.

## Usage

```bash
ritual collection-sync pull [lists...]
ritual collection-sync push [lists...]
```

## Arguments

| Argument      | Description                                                                                 | Required |
| ------------- | ------------------------------------------------------------------------------------------- | -------- |
| `<direction>` | `pull` (Archidekt → local) or `push` (local → Archidekt). Any other value exits with code 2 | Yes      |
| `[lists...]`  | Collection lists to sync (no `.md`). If omitted, every collection list                      | No       |

Names resolve within collection lists only, following the usual [list name rules](/list-resolution/). An ambiguous or unknown name is reported as a **failed** list (not `skipped`) and the run exits 1.

## Options

| Option                      | Description                                                                                                       | Default                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `-n, --dry-run`             | Report what would sync without writing files or pushing changes                                                   | `false`                     |
| `-y, --yes`                 | Sync collection lists with unreadable lines without asking                                                        | `false`                     |
| `--only <changes>`          | Apply only `additions` or `removals` (relative to the sync destination)                                           | all changes                 |
| `--into <list>`             | Collection list a pull adds new cards to, created if needed                                                       | `collectionSync.pullTarget` |
| `--removal-priority <list>` | Collection list an [ambiguous removal](#ambiguous-removals) may take copies from. Repeatable, in order            | none                        |
| `--csv`                     | Upload a push's new cards as one [CSV import](#csv-import-for-new-cards) instead of adding them one by one        | automatic above 25          |
| `--csv-file <path>`         | Write a push's new cards to this CSV file **instead of** pushing them                                             | none                        |
| `--refresh <mode>`          | Card cache refresh policy when new cards take the [CSV path](#cache-freshness): `ask`, `auto`, `no-bulk`, `never` | `ask`                       |
| `--output <format>`         | Output format: `text`, `json`, or `ndjson`                                                                        | `text`                      |
| `--quiet`                   | Suppress non-essential output                                                                                     | `false`                     |

`--into` and `--removal-priority` apply to a pull only; `--csv` and `--csv-file` to a push only. Passing one to the other direction warns and is otherwise ignored. Giving both `--csv` and `--csv-file` exits with code 2.

Under `--dry-run`:

- Both directions still fetch the remote collection, since the diff needs it.
- A push resolves new printings on Archidekt, so a preview surfaces any printing it cannot resolve. Additions that take the [CSV path](#csv-import-for-new-cards) resolve nothing remotely; the printings the CSV cannot carry are named instead.
- A pull resolves names against the local Scryfall cache and contacts Archidekt only for the collection itself.
- No file is written, nothing is sent to Archidekt, and no sync timestamp is recorded.

## Prerequisites

Sign in to Archidekt first:

```bash
ritual login archidekt
```

The collection is read by numeric user id, which the login records alongside the token. A login stored before that was recorded fails with a message asking you to run `ritual login archidekt` again.

## Scope

Both directions run in one of two scopes:

- **Whole collection** (no list arguments): the local side is the union of every collection list.
- **Selected lists** (`collection-sync pull "Blue Binder" "Long Box"`): the local side is the union of only the named lists.

The remote side is **always the whole Archidekt collection**. Naming lists declares "these lists are what my Archidekt collection mirrors". Cards that live only in lists you did not name read as absent: a push would delete their records and a pull would re-add them. When the named lists are not the whole story, narrow the run with `--only`.

## Change Filter

`--only` narrows a run to one side of the diff. Its values are relative to the **destination**: your list files on a `pull`, Archidekt on a `push`.

| Value       | Applies                                                      | Skips                   |
| ----------- | ------------------------------------------------------------ | ----------------------- |
| `additions` | Copies missing from the destination (quantity **increases**) | Removals and decreases  |
| `removals`  | Copies gone from the source (quantity **decreases**)         | Additions and increases |

Any other value exits with code 2. Skipped changes are still counted and reported once per run:

```
Skipped 3 removals (applying additions only).
```

This is what makes the selected-lists scope safe. `collection-sync push "Blue Binder" --only additions` uploads what that binder holds without treating the lists you did not name as cards you no longer own. In reverse, `collection-sync pull --only additions` adopts new Archidekt cards without deleting anything locally.

The admin Sync Collection page offers the same choice as an _All changes / Additions only / Removals only_ control, and the MCP `sync_collection` tool takes it as an `only` field.

## Pull (`collection-sync pull`)

The remote collection is the truth, with one guardrail: copies live in physical binders, and only you know which.

1. Fetches every page of the account's Paper collection.
2. Joins both sides on `(set, collector number, finish, condition, language)`. A `[ja]` line and a bare (English) line of the same printing are different records. Remote records that differ only in tags or purchase price are counted together.
3. **More copies remotely than locally** → the difference is added to the **target list** as new card lines, with printing, finish, condition, and language.
4. **Fewer copies remotely than locally** → the difference is removed:
   - **Every copy is going** → each list holding a copy loses all of them. This is never ambiguous, however many lists are involved.
   - **Some copies are going, all in one list** → that list's last lines are removed.
   - **Some copies are going, spread over several lists** → the run cannot know which binder the card left. This is an [ambiguous removal](#ambiguous-removals) and must be resolved before the run writes anything.
5. Applies changes through the same path the editors use. `&N` card IDs, the list's `.changes.md` changelog, its [custom art](/custom-art/#art-follows-the-card), and its content hash all behave as they do for a manual edit. A removed line takes its custom art with it.

### Where pulled cards land

Every addition goes to one designated list, resolved in this order:

1. `--into <list>` for this run
2. the [`collectionSync.pullTarget`](/configuration/#collection-sync) config key
3. `Inbox`, the built-in default

The target is matched by its **whole name** (ignoring case, accents, and `-`/`_`), never by the substring rule other list arguments use, so a target of `Inbox` cannot land in `card-inbox`. When no list has that name, it is **created on first use**. If two lists match it, the run fails before anything is written.

### Ambiguous removals

A removal is **ambiguous** when only _some_ of a printing's copies are going and those copies live in several lists:

```
Not removing 2 × Lightning Bolt (LEA:161): ambiguous — copies live in "Blue Binder" (1) and "Long Box" (2).
```

Taking _every_ copy is never ambiguous; each list loses what it holds.

Until every ambiguous removal is settled, **the run writes nothing at all**: not the changes it could have made on its own, and not the account's sync timestamp. There is no partial sync. The CLI settles them in one of two ways. (The admin API and the MCP tool have a third, an explicit per-removal `removalAssignments` decision, which is also what the MCP tool's elicitation answers become.)

**1. A removal priority.** `--removal-priority <list>` names a list ambiguous copies may be taken from. Repeat it to give a fallback order. Copies are taken only from those lists, in the order given, removing each list's last lines first:

```bash
ritual collection-sync pull --removal-priority "Long Box" --removal-priority "Blue Binder"
```

- Names are matched by **whole name** only, like `--into`.
- An unknown or ambiguous name fails the run right after the local lists load, **before the remote collection is fetched**. `--into` is checked at the same moment: a name two lists share fails there (a name no list has is fine, since a pull creates it).
- If the priority cannot fully cover a removal (copies live elsewhere, or the named lists hold too few), the run fails and writes nothing, naming the cards it could not place.
- Placed removals are logged with the list that lost them:

```
Removing 2 × Sol Ring (C21:240) from "Long Box" (removal priority).
```

The priority applies only to ambiguous removals; total and single-list removals proceed on their own. When a priority is given, the run never prompts, even in a terminal.

**2. Resolving them one by one.** With no priority, `--output text`, a terminal, prompts enabled (not `--no-input`), and no `--dry-run`, the run offers to walk the copies:

```
? 2 removals are ambiguous. Resolve them one by one now? › (y/N)
Lightning Bolt (LEA:161): 2 to remove — copies live in "Blue Binder" (1) and "Long Box" (2).
? Which list lost Lightning Bolt (LEA:161)? (copy 1 of 2) › Blue Binder (1 left)
                                                            Long Box (2 left)
```

Each prompt offers only the lists that still hold a copy, with the count left in each. Declining the first question, or cancelling part way through, aborts everything and writes nothing. `--yes` does **not** answer these prompts; it covers unreadable lines only.

**Anywhere else** (`--output json`/`ndjson`, a piped stdin, or `--no-input`), the run fails and writes nothing:

```
1 ambiguous removal needs a decision. Pass --removal-priority <list> (repeatable, in priority order) to say which lists may lose copies, or run in a terminal to resolve them one by one. Nothing was written.
```

The admin site, or an MCP client that cannot be asked, fails the same way but names the cards: `Could not place 2 × Lightning Bolt (LEA:161): the removals are ambiguous and were not resolved. Nothing was written.`

In every case (no terminal, the offer declined, a walk cancelled part way, or a surface that cannot ask), the message lands in the report's `errors` with `unresolvedAmbiguity: true`, the command prints `Not synced: …` rather than `Synced: …` and exits 1, and the report's `ambiguous` array carries every removal with its per-list copy counts.

The admin [Sync Collection](/admin/sync-collection/#removals-it-will-not-guess-at) page has an ordered **Removal priority** picker and cannot prompt. The MCP [`sync_collection`](/commands/mcp/#sync_collection) tool takes a `removalPriority` array **or** an explicit `removalAssignments` decision, and asks the user directly when its client supports elicitation.

`--dry-run` never prompts and never fails on an ambiguity. It reports each ambiguous removal and, with a priority, how the priority would place it, or that a real run would fail. An unknown `--removal-priority` name still fails a dry run, since that is a bad argument.

Other ways out: sync fewer lists (`collection-sync pull "Blue Binder"`), or pass `--only additions` so removals are skipped entirely.

### When a list in scope cannot be read

A list that does not make it into the comparison (a name that does not resolve, a file that cannot be read, or one [held back for unreadable lines](#unreadable-lines)) makes its cards look like they exist only on Archidekt. The run withholds the changes that gap would produce, and says so:

- a **pull** adds nothing (it would copy that whole file into the target list);
- a **push** removes nothing (it would delete those cards from your Archidekt collection).

Everything else still applies, and the report's `localIncomplete` flag records that it happened. Fix or accept the listed lists and run again.

## Push (`collection-sync push`)

The union of the in-scope lists is the truth, and the account's records are reshaped to match it.

1. **A printing with no remote record** → the printing is resolved on Archidekt (by name, set, and collector number) and a new record is created. A printing that cannot be resolved is a per-card failure: the run continues and the affected lists are reported as failed. Above 25 new printings, additions go through a [CSV import](#csv-import-for-new-cards) instead, which needs no search.
2. **More copies locally** → the leading record's quantity is raised.
3. **Fewer copies locally** → records are consumed from the end (records matching the key's language first, then small records). The one that only partly covers the difference is trimmed; the rest are deleted.
4. **A printing gone from every list** → all of its records are deleted.

Deletions use Archidekt's bulk endpoint, 25 records per request, and never the CSV path. The "clear collection" endpoint is never used. A push never writes to your list files; the only file it can write is the one `--csv-file` asks for.

:::caution[A collection push is last-writer-wins]

Unlike [`deck-sync push`](/commands/deck-sync/#divergence-guard-push), a collection push has **no divergence guard**. Cards added on archidekt.com since your last sync read as "gone from every list" and are deleted. Archidekt collections have no collection-level timestamp, so there is no cheap way to detect this. Use `--dry-run` or `--only additions` when you have also been editing your collection on Archidekt.

:::

### CSV import for new cards

Adding a printing costs two [paced](#rate-limiting) Archidekt requests (a search, then a create), so a first push of a real collection would take hundreds. Above **25 new printings** a push instead sends its additions through Archidekt's own collection importer: one CSV, one upload, no searches. The rows come entirely from your **local Scryfall cache**:

```csv
Scryfall ID,Quantity,Variant,Condition,Language
1b59533a-3e38-495d-873e-2f89fbd08494,2,Normal,NM,EN
7d4c1a0e-1e6a-4c6f-b6a4-4c0f2e2a9f11,1,Etched,D,JP
```

It is the same file `ritual export --preset archidekt` writes, in Archidekt's spellings:

- Variant is `Normal` / `Foil` / `Etched` (never `nonfoil`).
- Damaged is **`D`**, not Ritual's `DMG`.
- Language uses Archidekt's codes (`EN`, `CT`, `DE`, `FR`, `IT`, `JP`, `KR`, `PT`, `RU`, `CS`, `SP`), so Japanese is `JP`, not Scryfall's `ja`.
- One row is one printing; three copies is a single row with `Quantity` 3.
- Uploads are chunked at 2000 rows per request.

Only **additions** use the CSV. Quantity increases stay individual updates, and removals use the bulk-delete API.

#### Choosing the route

| Situation                     | What happens                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| 25 or fewer new printings     | Added one at a time                                                                       |
| `--csv`                       | Always uploaded as one CSV import, however few — no prompt                                |
| `--csv-file <path>`           | Always written to that file **instead of** being pushed — no prompt                       |
| More than 25, in a terminal   | You are asked (below)                                                                     |
| More than 25, non-interactive | The run fails and pushes **nothing**, naming both flags                                   |
| More than 25, `--dry-run`     | Reported as `would upload N cards (M rows) as a CSV import` — nothing is searched or sent |

Every route into the CSV path needs a reasonably fresh card cache. See [Cache freshness](#cache-freshness).

In a terminal (text output, prompts enabled, not `--dry-run`) the run stops and asks:

```
? 40 cards would be added — more than 25. How should they reach Archidekt? › - Use arrow-keys
❯ Upload them automatically as one CSV import (recommended)
  Save the CSV to a file for a manual upload
  Add them individually (slow; may be rate limited)
  Cancel the run
```

Saving to a file then asks where, prefilled with a dated name like `archidekt-import-2026-07-27.csv`. Cancelling or escaping either prompt fails the run without pushing anything.

Without a terminal (`--output json`/`ndjson`, a pipe, or `--no-input`) the run refuses before touching Archidekt:

```
26 cards would be added — more than 25, so adding them one at a time would cost 26 printing searches. Pass --csv to upload them as one CSV import, or --csv-file <path> to write the CSV for a manual upload. Nothing was pushed.
```

The question is settled **before the first remote write**. A refused or cancelled decision leaves your Archidekt collection untouched: no creates, no quantity changes, no deletions.

The server surfaces cannot prompt, so they carry the answer up front. The [admin Sync Collection page](/admin/sync-collection/#new-cards-on-a-push) has an **Upload new cards as one CSV import** toggle (on by default), and the [`sync_collection`](/commands/mcp/#sync_collection) MCP tool takes `csv: true`. Without it a large push fails without pushing anything. `--csv-file` has no server equivalent; an admin request carrying `csvFile` is rejected (the MCP tool has no such field).

#### Cache freshness

Every uploaded row is keyed by the Scryfall ID your **local card cache** holds for that printing. A stale or empty cache means missing rows, each falling back to one paced search. So a run whose additions take the CSV path (over the threshold, `--csv`, or `--csv-file`) checks the cache before building the file. `--refresh <mode>` decides what happens when the cache is empty or more than a day old:

| `--refresh` | Empty or day-old cache                                                      |
| ----------- | --------------------------------------------------------------------------- |
| `ask`       | Prompts (default **yes**); declining fails the run without pushing anything |
| `auto`      | Redownloads the Scryfall bulk data, then continues                          |
| `no-bulk`   | Fails the run — the cache is only ever filled by a bulk download            |
| `never`     | Fails the run                                                               |

Without a terminal, `ask` cannot prompt and fails the same way `never` does:

```
Archidekt CSV uploads are configured to require Scryfall IDs from the local card cache, which is empty. Run `ritual cache preload-all`, or re-run with --refresh auto. Nothing was pushed.
```

The check runs after the remote collection is read but **before the first remote write**, so a refusal leaves your collection as it was. After a refresh the run re-matches your lists against the new cache and re-plans the push, so a printing the old cache lacked (and so was guessed as nonfoil) is keyed by its real finish. The server surfaces treat freshness as `auto` and report the refresh in the run log.

#### Cards the cache cannot resolve

A printing missing from the local cache even after a refresh (a card too new for the bulk data, say) has no Scryfall ID and cannot go in the CSV. Those additions are reported and added the slow way instead (one search, one create each):

```
1 addition cannot ride the CSV (the printing is not in the Scryfall cache); it is added one at a time instead.
```

Under `--dry-run` they are named rather than resolved, so a preview of a large push makes no per-card request:

```
[dry-run] Would add 1 × Card 3 (LTC:3) one at a time — the printing is not in the Scryfall cache, so it cannot ride the CSV and was not resolved here.
```

This applies to `--csv-file` too: cached printings go in the file, and uncached ones are still pushed one at a time. The report's `csv.uncached` counts them. When the cache can key _none_ of the additions, no file is built and the report says `csv.status: "empty"`.

#### Writing the CSV instead of pushing (`--csv-file`)

`--csv-file <path>` writes the same file and pushes **no** additions the CSV could carry. Quantity changes and removals still push normally. The cards are counted as _pending_ rather than added:

```bash
ritual collection-sync push --csv-file archidekt-import.csv
```

```
Wrote 40 cards (37 rows) to archidekt-import.csv; they were not pushed. Import the file at https://archidekt.com/collections/import.
Synced: +0 added, -3 removed, 40 awaiting upload.
40 cards were not pushed: upload archidekt-import.csv at https://archidekt.com/collections/import to add them.
```

Upload it on Archidekt at **Collection → Import** (`archidekt.com/collections/import`), mapping the columns as `Scryfall ID`, `Quantity`, `Variant`, `Condition`. The header row names them exactly that way.

#### When Archidekt rejects rows

An upload answers with one result per row. Rows it did not import are warned about with counts, the first ten named individually, and the lists holding those cards are reported as **failed**:

```
Archidekt did not import 2 of 37 CSV rows (1 not found, 1 rejected).
  Not imported: Sol Ring (C21:240) — not found on Archidekt.
```

A whole upload that fails (a non-2xx response) fails those additions and nothing else. Quantity changes and removals still apply. The additions are **not** retried one at a time, since a partial import would then be imported twice. Re-run the push once the problem is fixed; only the remaining differences are sent.

A push refuses to run when there is nothing readable to push (every in-scope list failed to load, or none were named and none exist). Otherwise it would read that as "the collection is empty" and delete the whole account collection.

## What Is Compared

The join key is the **printing** (set code and collector number) plus **finish**, **condition**, and **language**.

- Ritual's five conditions are exactly Archidekt's, so `NM`/`LP`/`MP`/`HP`/`DMG` round-trip as-is.
- A line's `[ja]`-style language token (a bare line means English) joins against the record's Archidekt language.
- A line with no explicit finish is resolved against the card cache first, so an etched-only printing compares as etched. A printing the cache does not hold is synced as nonfoil, with one warning per list naming the printing and its copy count. This lookup is **cache-only**: a sync never fetches cards from Scryfall one at a time, so a cold cache means many nonfoil warnings rather than hundreds of requests. Run [`ritual cache preload-all`](/commands/cache/) before a first sync.

Language **round-trips**. A pull writes a non-English record's language onto the new line as its `[ja]`-style token, and a push creates records in the line's language. The one lossy edge is the CSV path: Archidekt's CSV speaks `EN CT DE FR IT JP KR PT RU CS SP`, so a language it cannot express (Hebrew, Latin, Ancient Greek, Arabic, Sanskrit, Phyrexian) uploads as English with a warning naming the line. An Archidekt record with an unknown language id is treated as English, with a warning.

The following have no local representation. They survive on existing records, but nothing local can set them:

| Dimension      | Behavior                                                                         |
| -------------- | -------------------------------------------------------------------------------- |
| Tags           | Records Ritual creates carry no tags; existing tags survive a quantity change.   |
| Purchase price | Records Ritual creates have none; an existing price survives a quantity change.  |
| Game           | Fixed to **Paper**. MTGO and Arena collections are not synced.                   |
| Sections       | Local only. A pull adds into the target list's `Main`; a push flattens sections. |
| Notes          | Local only, and never sent.                                                      |

## Deck-Style Quantity Prefixes

Collections hold **one line per copy**, so a canonical collection line carries no quantity. A deck-style line pasted into a collection (`- 4 Sol Ring (C21:240)`) is still read as four copies (see [read tolerances](/list-format/#read-tolerances)). The next whole-file save (a pull, an editor save, `cleanup`) expands it to four lines: the first keeps the line's `&N`, the rest get fresh ids.

A `collection-sync` run, a `cleanup` run, and the CLI editors each say so, once per such line:

```
collections/Binder.md:12: Read 4 copies: a collection holds one line per copy, so this line becomes 4 lines on the next save.
```

This is an advisory, not an [unreadable line](#unreadable-lines). Nothing is lost, so it never blocks a sync, a save, or `cleanup`. A quantity of `1` is not reported. Only a 1–3 digit leading integer (or digits followed by `x`, as in `4x`) counts as a quantity, so a card named `1996 World Champion` parses untouched. Wanted lists, also one line per copy, behave the same way.

## Unreadable Lines

A list file may hold lines the parser cannot read (stray prose, a refused card line) or a [fenced code block](/list-format/#fenced-code-blocks), which the canonical writer cannot re-emit. Both directions would lose that content, so both refuse to sync such a list without confirmation. A pull rewrites the file (deleting the lines), and a push treats the file as the truth (deleting those cards from your Archidekt collection).

```
1 collection list contains lines Ritual cannot read.
A pull rewrites the list file, so these lines would be removed:
  binder.md ("Blue Binder"):
    Skipped malformed line: sort these later
? Sync 1 collection list anyway, removing the lines above? › (y/N)
```

Answering no (the default) fails those lists; the rest of the run continues. Pass `-y, --yes` to answer yes up front.

Without a terminal to ask (`--no-input`, a piped stdin, or `--output json`/`ndjson`), the affected lists fail and the command exits 1. The listing is written to stderr in every mode, and every report carries an `unreadable` array with the same lists and lines.

`--dry-run` is exempt: a preview writes nothing, so there is nothing to confirm.

## Scripted Output

With `--output json` (or `ndjson`), progress logging is suppressed and a single report is emitted on stdout:

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
  "totals": { "added": 3, "removed": 1, "skipped": 0, "pending": 0 },
  "cancelled": false,
  "unresolvedAmbiguity": false
}
```

- `into` is the list a pull adds to, and `null` on a push.
- `cancelled` is always `false` on the CLI. The [admin API](/admin/api/#sync-collection) and the MCP `sync_collection` tool set it when a client cancels between lists; the lists never reached are then `skipped`, and no `lastSynced` is recorded.
- Each list's `status` is `synced`, `failed`, or `skipped`. `added`, `removed`, and `pending` count **copies**, not lines. A printing held in several lists counts for each of them.
- `errors` holds failures that belong to the run rather than to one list: the collection fetch, or records for cards that live in no list any more. They fail the run like a failed list does.
- `localIncomplete` is `true` when a list in scope did not make it into the comparison (see [When a list in scope cannot be read](#when-a-list-in-scope-cannot-be-read)).
- `ambiguous` holds the removals a pull could not place by itself, with the lists holding copies and how many each holds. They are reported whether or not a [resolution strategy](#ambiguous-removals) placed them. When none could, `errors` says so, `unresolvedAmbiguity` is `true`, and the run wrote nothing. A client that can ask the user branches on that flag rather than parsing `errors`.
- `totals.skipped` counts the changes `--only` left out. `totals.pending` counts copies written to a `--csv-file` rather than pushed; they are **not** part of `added`.
- `csv` describes what the [CSV path](#csv-import-for-new-cards) did with a push's additions, and is `null` on any run that did not take it. Every shape carries `cards` (copies), `rows`, and `uncached` (additions the cache could not resolve, added one at a time instead), plus:

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

## Progress Output

Each slow phase before the first list is touched announces itself and reports how long it took:

```text
Reading collection lists...
Read 3 collection lists holding 1204 card entries in 0.3 seconds.
Matching 1204 card entries against the local card cache (loading the cache the first time, which can take a while)...
Indexed 1180 printings across the local lists in 6.4 seconds.
Fetching the Archidekt collection (paced to stay under the rate limit)...
Fetched page 1 of 4 — 100 collection records so far.
Fetched page 2 of 4 — 200 collection records so far.
Fetched page 3 of 4 — 300 collection records so far.
Fetched page 4 of 4 — 382 collection records so far.
Archidekt collection: 382 collection records covering 377 printings, fetched in 6 seconds.
Comparing the collection against the local lists...
```

The two long pauses are the first card-cache lookup, which loads the whole Scryfall cache from disk, and the collection fetch, one [paced](#rate-limiting) request per page.

The read tally counts only lists that made it into the comparison, so it excludes any list [held back for unreadable lines](#unreadable-lines) or that could not be read. Its elapsed time excludes the time you spend answering that confirmation.

The admin Sync Collection page shows these lines over its event stream. `--quiet` and `--output json`/`ndjson` drop them.

## Failure Behavior

Per-list failures (a list that did not resolve, a file that could not be read or saved, a printing that could not be resolved on Archidekt) are reported as they happen, and the run continues. If any list failed, a summary such as `2 of 5 collection lists failed` is printed to stderr and the command exits 1.

An [unresolved ambiguous removal](#ambiguous-removals) is different. It stops the whole pull before anything is written, including the target list a pull would have created and the account's sync timestamp. It lands in the report's `errors`, the closing line reads `Not synced: …`, and the command exits 1.

## Rate Limiting

Archidekt allows about 80 requests per minute per IP. Ritual spaces requests at least 1.5 s apart (40 per minute). The budget is shared process-wide, so two syncs in the same server pace against each other.

When Archidekt answers `429 Too Many Requests`, the request is retried up to 5 times. Each retry waits out the server's `Retry-After` (capped at 60s) when given, otherwise backs off exponentially (2s, 4s, 8s, 16s, 32s). Each wait is reported as a warning like `Rate limited by Archidekt — waiting 4s before retry 2 of 5.` A 429 that outlives the retries fails that card's operation like any other HTTP error. Re-running the sync later is safe, because only the remaining differences are pushed.

Tune the spacing with the `RITUAL_ARCHIDEKT_MIN_INTERVAL_MS` environment variable (`0` disables it). The 429 handling is always on.

This is why a large push does not add cards one at a time: above 25 new printings the additions become a single [CSV import](#csv-import-for-new-cards), and a `--dry-run` of the same push makes no per-card request at all.

## Exit Codes

| Code | Meaning                                                                                                                                                                                       |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Everything synced cleanly (or there was nothing to sync)                                                                                                                                      |
| `1`  | A list or the run itself failed (an unresolved ambiguous removal or an undecided [CSV question](#csv-import-for-new-cards) included), or you are not signed into Archidekt with an account id |
| `2`  | Missing or invalid `<direction>`, `--only`, a blank `--into` / `--removal-priority` / `--csv-file`, or `--csv` together with `--csv-file`                                                     |

## Examples

Pull the whole collection, letting new cards land in the configured target list:

```bash
ritual collection-sync pull
```

Pull into a specific binder:

```bash
ritual collection-sync pull --into "Blue Binder"
```

Pull unattended, letting the overflow box give up any copies the run cannot place on its own:

```bash
ritual collection-sync pull --removal-priority "Long Box" --removal-priority "Blue Binder"
```

Push one binder's contents without letting the lists you did not name look like losses:

```bash
ritual collection-sync push "Blue Binder" --only additions
```

Preview a whole-collection push (over 25 new printings this makes no per-card request at all):

```bash
ritual collection-sync push --dry-run
```

Push a big first collection unattended, uploading the new cards as one CSV import:

```bash
ritual collection-sync push --csv
```

Write the new cards to a CSV to check (or upload) yourself, pushing only the removals:

```bash
ritual collection-sync push --csv-file archidekt-import.csv
```

Script a pull and inspect the per-list results:

```bash
ritual collection-sync pull --output json
```
