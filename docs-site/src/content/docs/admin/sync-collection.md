---
title: 'Sync Collection'
---

The **Sync Collection** page syncs your collection lists with the Archidekt collection of the
signed-in account, without leaving the browser. It runs the same engine as the
[`collection-sync`](/commands/collection-sync/) CLI command — the same key matching, the same
ambiguity guard, the same changelog entries — with progress streamed into the page as it happens.

An Archidekt account has **one** collection while Ritual has **many** collection lists, so a run
compares the union of the lists in scope against the whole remote collection. There is no per-list
link and no per-list "last synced": the account has one, shown above the controls.

## Signing in

Syncing needs an Archidekt login, stored on the server and shared with the CLI. The page reports the
state of that login at the top, and shows a login form inline when one is needed — the same
operation as the [Archidekt Login](/commands/login/) page, which the disabled sync button links to.
The controls unlock as soon as the sign-in succeeds.

A login stored before Ritual recorded which account it belongs to cannot be used: a collection is
fetched by account, so the run reports that and asks you to sign in again.

## Choosing what to sync

| Control              | Effect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Direction**        | `Pull` (Archidekt → local) or `Push` (local → Archidekt). The description below the control spells out what the selected direction writes.                                                                                                                                                                                                                                                                                                                                                                   |
| **Scope**            | `Whole collection` compares every collection list, including any created since the page loaded. `Selected lists` compares only the ones you tick — the remote side is still the whole Archidekt collection, so cards that live only in the lists you left out read as missing.                                                                                                                                                                                                                               |
| **Changes**          | `All changes`, `Additions only`, or `Removals only` — the page's form of the CLI's [`--only`](/commands/collection-sync/#change-filter). Skipped changes are still counted and reported.                                                                                                                                                                                                                                                                                                                     |
| **Add new cards to** | Pull only: the list additions land in, the page's form of [`--into`](/commands/collection-sync/#where-pulled-cards-land). It defaults to the [`collectionSync.pullTarget`](/configuration/#collection-sync) setting, which is offered even when no list answers to that name yet — a pull creates it on first use. The picker chooses a destination for **this run only**; change the persistent default with `ritual config set collectionSync.pullTarget "<list>"` (the Settings page does not expose it). |
| **Removal priority** | Pull only: the ordered list of binders an [ambiguous removal](#removals-it-will-not-guess-at) may take copies from — the page's form of [`--removal-priority`](/commands/collection-sync/#ambiguous-removals). Click a list to append it; the chips are numbered in the order copies are taken from them, and each can be dropped again. Empty by default, which means an ambiguous removal stops the run.                                                                                                   |
| **New cards**        | Push only: whether a push's new cards are uploaded as one CSV import or created one at a time — see [New cards on a push](#new-cards-on-a-push). **On by default**, since the browser cannot be asked mid-run.                                                                                                                                                                                                                                                                                               |
| **Preview only**     | Runs as a dry run: both directions still fetch the remote collection to compute the diff, but nothing is written locally and nothing is sent to Archidekt.                                                                                                                                                                                                                                                                                                                                                   |

A subset scope with an unfiltered run is the combination to think twice about: telling Ritual that
one binder mirrors your whole Archidekt collection is exactly what `Removals only` and
`Additions only` exist to qualify.

## Watching a run

The run streams over server-sent events, so each list updates as it is processed:

| Icon | Meaning                                                             |
| ---- | ------------------------------------------------------------------- |
| ⏳   | In progress.                                                        |
| ✓    | Synced — including "no changes".                                    |
| ⏭   | Skipped, with the reason.                                           |
| ✗    | Failed, with the error. The run continues with the remaining lists. |

A finished list shows its tally (`+2 added, -1 removed`) beside its name, counting **copies** rather
than cards: a collection line is one physical copy, so that is the unit both directions move. Under
each list are the lines the CLI prints — the change summary, what the change filter left out, and
the final `Saved.` Lines that belong to the run rather than to one list sit above the list rows: the
phase progress a run opens with — reading the list files, matching them against the card cache, one
line per page of the fetched collection, each with how long it took — the size of the fetched
collection, and any removal too ambiguous to place (see below). A closing alert summarizes the run,
e.g. `Pulled +4 added, -1 removed into "Inbox".`

If the browser cannot hold the event stream open (some reverse proxies buffer server-sent events),
the page falls back to a single non-streaming request and fills in every list's result — including
the ambiguous removals and run-level errors — when it returns. That fallback carries no progress
lines at all: it has only the finished report to show.

## Removals it will not guess at

A pull removes the copies Archidekt no longer has. That is unambiguous whenever **every** copy of a
printing is going — each list simply loses what it holds, however many are involved — and whenever
the copies that are going all sit in **one** list. It is ambiguous when only _some_ of a printing's
copies are going and they live in several lists: nothing says which binder the card physically left.

The browser cannot be prompted half way through a run, so the **Removal priority** control answers
that question up front. Copies are then taken only from the lists it names, walking them in the
order shown and taking each list's last lines first; a placed removal is logged with the list that
lost it.

Without a priority — or with one that cannot cover a removal (the copies live elsewhere, or the
named lists hold too few) — the run **fails and writes nothing at all**, not even the changes it
could have made on its own. There is no partial, one-card-at-a-time sync. The page then shows an
_Ambiguous removals_ panel listing each one it could not place, with the lists holding copies and
how many each holds:

```
Not removing 2 × Lightning Bolt (LEA:161): ambiguous — copies live in "Blue Binder" (1) and "Long Box" (2).
```

The priority offers the lists **in scope** — a list the run does not compare holds no copies it
could take, so naming it would fail the run rather than settle anything — and each is shown by its
heading with its file name beside it, which is the name the messages above use.

Set a priority and run again, move a printing's copies into one list, scope the run to that list, or
narrow it with `Additions only` so removals are skipped entirely. A **Preview only** run never fails
on an ambiguity itself: it reports each one, and with a priority set, how that priority would place
it. (A priority naming a list that does not exist still fails a preview — that is a bad answer
rather than an unresolved removal.) The
[CLI](/commands/collection-sync/#ambiguous-removals) applies the same rules, and can additionally
resolve the copies one at a time in a terminal — the one thing this page cannot do.

## New cards on a push

A printing your Archidekt collection does not have yet costs two requests to add — a search to find
it, then a create — and every request is
[paced](/commands/collection-sync/#rate-limiting), so a first push of a real collection
would take hundreds of them. Archidekt's own collection importer takes one CSV instead, and the rows
are built entirely from your local Scryfall cache, so the whole batch costs a single upload.

The **Upload new cards as one CSV import** toggle (push only) is that choice, and it is **on by
default**: the browser cannot be stopped and asked half way through a run, so the answer is given
before it starts. It is the page's form of the CLI's
[`--csv`](/commands/collection-sync/#csv-import-for-new-cards) and means the same thing — the new
cards are uploaded however few of them there are. Quantity changes and removals never ride it;
removals use Archidekt's own bulk-delete endpoint.

Turned **off**, new cards are created one at a time, and a push with more than 25 of them
**fails without pushing anything at all** — no creates, no quantity changes, no deletions. The
refusal is reported in the run log:

```
26 cards would be added — more than 25, so adding them one at a time would cost 26 printing searches, and this run was not told to upload them as one CSV import instead. Nothing was pushed.
```

Switch the toggle back on and run again. (A **Preview only** run is exempt: over the threshold it
reports the upload it would make and resolves no printings at all, which is what keeps a first
preview from being rate limited.)

Because every row is keyed by the Scryfall ID your local card cache holds for that printing, a run
that uploads a CSV needs that cache to be reasonably fresh. The browser cannot be asked about it
mid-run, so the page's runs treat freshness as `auto`: an empty or day-old cache is redownloaded
before the file is built, and the run log says so
(`Archidekt CSV uploads are configured to require Scryfall IDs from the local card cache, which is empty. Refreshing it from Scryfall first...`).
It is the same requirement the CLI's
[`--refresh`](/commands/collection-sync/#cache-freshness) governs.

When the run finishes, what the import did is reported above the log:

- **Uploaded 40 cards (37 rows) to Archidekt as a CSV import in 1 request.** — one row per printing,
  chunked at 2000 rows per request as Archidekt's own importer does.
- Rows Archidekt refused are listed by card with the reason (`not found on Archidekt`,
  `matched more than one printing`, or whatever it said), and the lists holding those cards are
  reported as **failed** — the rest of the run still applied.
- A card whose printing is missing from your local Scryfall cache has no Scryfall ID to key a row by,
  so it cannot ride the CSV: it is added one at a time instead and counted separately. Refresh the
  cache (`ritual cache preload-all`) to keep that rare. When the cache can key **none** of them, the
  panel says no CSV was built at all.
- A chunk whose answer Ritual could not read is called out: those rows are counted as imported
  because nothing said otherwise, and the run log carries what Archidekt actually replied.
- A whole upload that fails says so and adds nothing; the additions are **not** retried one at a
  time, since a partial import would then be imported twice. Fix the problem and run again — only
  the remaining differences are sent.

Writing the CSV to a file instead of pushing it is CLI-only
([`--csv-file`](/commands/collection-sync/#writing-the-csv-instead-of-pushing---csv-file)): the
server does not write files a request names. `ritual export --preset archidekt` writes the same file
by hand.

## Lists with unreadable lines

A line Ritual's parser cannot read is a line a sync would destroy: a pull re-serializes the list
file and would drop it, and a push treats the file as the truth and would delete those cards from
your Archidekt collection. Rather than let either happen quietly, the run refuses those lists and
shows what is at stake — each file, each line, and a **Sync anyway and lose those lines** button
that re-runs with your consent. This is the page's version of the confirmation the
[CLI prompts for](/commands/collection-sync/#unreadable-lines); fixing the lines by hand is the
lossless option. The panel appears on the non-streaming fallback too.

Lists refused this way are reported as failed; the rest of the run continues normally. A **Preview
only** run is exempt, since it writes nothing.

## What a sync changes

Identical to the CLI, since it is the same engine:

- A **pull** adds missing copies to the target list, removes the copies Archidekt no longer has,
  records every change in each list's `.changes.md`, and stamps the account's `lastSynced`. A run
  that stopped without writing anything leaves that stamp alone, so "last synced" never claims a
  run that changed nothing.
- A **push** creates, grows, trims, and deletes records in your Archidekt collection until it
  matches the lists in scope. Nothing is written locally.

See [What Is Compared](/commands/collection-sync/#what-is-compared) for the full rules — language
is part of the join key and round-trips (a `[ja]` line syncs as a Japanese record), while tags and
purchase price have no local counterpart.

:::note
When git auto-commit is enabled in the admin config, list files written by a pull are committed in a
single commit (`Sync collection with Archidekt (pull)`), the same as the editor and move endpoints.
CLI runs never auto-commit.
:::
