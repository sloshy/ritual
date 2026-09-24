---
title: 'Sync Collection'
description: Pull or push your collection lists against the signed-in Archidekt account's collection, from the browser.
---

The **Sync Collection** page syncs your collection lists with the Archidekt collection of the signed-in account, from the browser. It runs the same engine as the [`collection-sync`](/commands/collection-sync/) CLI command, with the same matching, the same ambiguity guard, and the same changelog entries. Progress streams into the page as it happens.

An Archidekt account has **one** collection while Ritual has **many** collection lists, so a run compares the union of the lists in scope against the whole remote collection. There is no per-list link and no per-list "last synced". The account has one, shown above the controls.

## Signing in

Syncing needs an Archidekt login, stored on the server and shared with the CLI. The page reports the state of that login at the top and shows a login form inline when one is needed. Signing in there is the same operation as the [Archidekt Login](/commands/login/) page, which the disabled sync button links to. The controls unlock as soon as the sign-in succeeds.

A login stored before Ritual recorded which account it belongs to cannot be used. The run reports that and asks you to sign in again.

## Choosing what to sync

| Control              | Effect                                                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Direction**        | `Pull` (Archidekt → local) or `Push` (local → Archidekt). The text below the control says what the selected direction writes.                                                               |
| **Scope**            | `Whole collection` compares every collection list, including any created since the page loaded. `Selected lists` compares only the ones you tick.                                           |
| **Changes**          | `All changes`, `Additions only`, or `Removals only` — the CLI's [`--only`](/commands/collection-sync/#change-filter). Skipped changes are still counted.                                    |
| **Add new cards to** | Pull only: the list additions land in — the CLI's [`--into`](/commands/collection-sync/#where-pulled-cards-land). Applies to **this run only**.                                             |
| **Removal priority** | Pull only: the ordered lists an [ambiguous removal](#removals-it-will-not-guess-at) may take copies from — the CLI's [`--removal-priority`](/commands/collection-sync/#ambiguous-removals). |
| **New cards**        | Push only: upload a push's new cards as one CSV import, or create them one at a time. **On by default.** See [New cards on a push](#new-cards-on-a-push).                                   |
| **Preview only**     | Runs as a dry run. Both directions still fetch the remote collection, but nothing is written locally and nothing is sent to Archidekt.                                                      |

Notes on the controls:

- With `Selected lists`, the remote side is still the whole Archidekt collection, so cards that live only in lists you left out read as missing: a push would delete them from Archidekt and a pull would re-add them. Unless those lists really are your whole Archidekt collection, use `Additions only` on a push and `Removals only` on a pull.
- **Add new cards to** defaults to the [`collectionSync.pullTarget`](/configuration/#collection-sync) setting. That default is offered even when no list has that name yet; a pull creates it on first use. Change the persistent default with `ritual config set collectionSync.pullTarget "<list>"` (the Settings page does not expose it).
- **Removal priority**: click a list to append it. The chips are numbered in the order copies are taken from them, and each can be dropped again. Empty by default, which means an ambiguous removal stops the run.

## Watching a run

The run streams over server-sent events, so each list updates as it is processed:

| Icon | Meaning                                                             |
| ---- | ------------------------------------------------------------------- |
| ⏳   | In progress.                                                        |
| ✓    | Synced — including "no changes".                                    |
| ⏭    | Skipped, with the reason.                                           |
| ✗    | Failed, with the error. The run continues with the remaining lists. |

A finished list shows its tally (`+2 added, -1 removed`) beside its name, counting **copies**, since a collection line is one physical copy. Under each list are the lines the CLI prints: the change summary, what the change filter left out, and the final `Saved.`

Lines that belong to the run rather than to one list sit above the list rows: the opening phase progress (reading the list files, matching them against the card cache, one line per fetched collection page, each with its elapsed time), the size of the fetched collection, and any removal too ambiguous to place (see below). A closing alert summarizes the run, such as `Pulled +4 added, -1 removed into "Inbox".`

If the browser cannot hold the event stream open (some reverse proxies buffer server-sent events), the page falls back to a single non-streaming request and fills in every list's result, including ambiguous removals and run-level errors, when it returns. That fallback shows no progress lines, only the finished report.

## Removals it will not guess at

A pull removes the copies Archidekt no longer has. That is clear when **every** copy of a printing is going (each list loses what it holds) and when the copies that are going all sit in **one** list. It is ambiguous when only _some_ of a printing's copies are going and they live in several lists. Nothing says which binder the card physically left.

The browser cannot be prompted mid-run, so the **Removal priority** control answers that question up front. Copies are taken only from the lists it names, in the order shown, taking each list's last lines first. A placed removal is logged with the list that lost it.

Without a priority, or with one that cannot cover a removal (the copies live elsewhere, or the named lists hold too few), the run **fails and writes nothing at all**, not even the changes it could have made on its own. The page then shows an _Ambiguous removals_ panel listing each one it could not place, with the lists holding copies and how many each holds:

```
Not removing 2 × Lightning Bolt (LEA:161): ambiguous — copies live in "Blue Binder" (1) and "Long Box" (2).
```

The priority offers only the lists **in scope**; a list the run does not compare holds no copies it could take. Each is shown by its heading with its file name beside it, which is the name the messages use.

Ways forward: set a priority and run again, move a printing's copies into one list, scope the run to that list, or choose `Additions only` so removals are skipped. A **Preview only** run never fails on an ambiguity itself. It reports each one and, with a priority set, how that priority would place it. (A priority naming a list that does not exist still fails a preview, since that is a bad answer rather than an unresolved removal.) The [CLI](/commands/collection-sync/#ambiguous-removals) applies the same rules, and can also resolve the copies one at a time in a terminal, which this page cannot do.

## New cards on a push

A printing your Archidekt collection does not have yet costs two [paced](/commands/collection-sync/#rate-limiting) requests to add, so a first push of a real collection would take hundreds of them. Archidekt's own collection importer takes one CSV instead, built entirely from your local Scryfall cache, so the whole batch costs a single upload.

The **Upload new cards as one CSV import** toggle (push only) is that choice, and it is **on by default**, since the browser cannot be asked mid-run. It is the page's form of the CLI's [`--csv`](/commands/collection-sync/#csv-import-for-new-cards): new cards are uploaded however few there are. Quantity changes and removals never use it; removals use Archidekt's bulk-delete endpoint.

Turned **off**, new cards are created one at a time, and a push with more than 25 of them **fails without pushing anything**: no creates, no quantity changes, no deletions. The run log reports the refusal:

```
26 cards would be added — more than 25, so adding them one at a time would cost 26 printing searches, and this run was not told to upload them as one CSV import instead. Nothing was pushed.
```

Switch the toggle back on and run again. A **Preview only** run is exempt: over the threshold it reports the upload it would make and resolves no printings, so a first preview is not rate limited.

Every CSV row is keyed by the Scryfall ID your local card cache holds for that printing, so a run that uploads a CSV needs a reasonably fresh cache. The page's runs treat freshness as `auto`: an empty or day-old cache is redownloaded before the file is built, and the run log says so (`Archidekt CSV uploads are configured to require Scryfall IDs from the local card cache, which is empty. Refreshing it from Scryfall first...`). After a refresh, the run matches your lists against the new cache again and re-plans the push before sending anything. This is the same requirement the CLI's [`--refresh`](/commands/collection-sync/#cache-freshness) governs.

When the run finishes, what the import did is reported above the log:

- **Uploaded 40 cards (37 rows) to Archidekt as a CSV import in 1 request.** One row per printing, chunked at 2000 rows per request.
- Rows Archidekt refused are listed by card with the reason (`not found on Archidekt`, `matched more than one printing`, or whatever it said). The lists holding those cards are reported as **failed**; the rest of the run still applied.
- A card whose printing is missing from your local Scryfall cache has no Scryfall ID and cannot go in the CSV. It is added one at a time instead and counted separately. Refresh the cache (`ritual cache preload-all`) to keep that rare. When the cache can key **none** of them, the panel says no CSV was built.
- A chunk whose answer Ritual could not read is called out. Those rows are counted as imported because nothing said otherwise, and the run log carries what Archidekt replied.
- A whole upload that fails says so and adds nothing. The additions are **not** retried one at a time, since a partial import would then be imported twice. Fix the problem and run again; only the remaining differences are sent.

Writing the CSV to a file instead of pushing it is CLI-only ([`--csv-file`](/commands/collection-sync/#writing-the-csv-instead-of-pushing---csv-file)); the server does not write files a request names. `ritual export --preset archidekt` writes the same file by hand.

## Lists with unreadable lines

A line Ritual's parser cannot read is a line a sync would destroy. A pull rewrites the list file and would drop it, and a push treats the file as the truth and would delete those cards from your Archidekt collection. Rather than let either happen quietly, the run refuses those lists and shows what is at stake: each file, each line, and a **Sync anyway and lose those lines** button that re-runs with your consent. This is the page's version of the confirmation the [CLI prompts for](/commands/collection-sync/#unreadable-lines). Fixing the lines by hand is the lossless option. The panel appears on the non-streaming fallback too.

Lists refused this way are reported as failed; the rest of the run continues. A **Preview only** run is exempt, since it writes nothing.

## What a sync changes

The same as the CLI, since it is the same engine:

- A **pull** adds missing copies to the target list, removes the copies Archidekt no longer has, records every change in each list's `.changes.md`, and stamps the account's `lastSynced`. A run that stopped without writing anything leaves that stamp alone.
- A **push** creates, grows, trims, and deletes records in your Archidekt collection until it matches the lists in scope. Nothing is written locally.

See [What Is Compared](/commands/collection-sync/#what-is-compared) for the full rules. Language is part of the join key and round-trips (a `[ja]` line syncs as a Japanese record), while tags and purchase price have no local counterpart.

:::note
When git auto-commit is enabled in the admin config, list files written by a pull are committed in a single commit (`Sync collection with Archidekt (pull)`), the same as the editor and move endpoints. CLI runs never auto-commit.
:::
