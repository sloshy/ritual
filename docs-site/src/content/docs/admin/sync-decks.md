---
title: 'Sync Decks'
---

The **Sync Decks** page syncs decks imported from Archidekt without leaving the browser. It runs the
same engine as the [`deck-sync`](/commands/deck-sync/) CLI command — the same diffing, changelog
entries, and `lastSynced` stamping — with per-deck progress streamed into the page as it happens.

## Signing in

Syncing needs an Archidekt login, stored on the server and shared with the CLI. The page reports the
state of that login at the top:

- **Signed in as _username_** — the stored token is usable (an expired access token that can still be
  refreshed counts as usable, exactly as the CLI treats it).
- **Your Archidekt session has expired** / **Not signed in to Archidekt** — a login form appears
  inline. Signing in there is the same operation as the admin's Archidekt Login page and
  [`ritual login archidekt`](/commands/login/); the sync controls unlock as soon as it succeeds.

If the token stops working mid-run, the run reports the failure and the login form reappears.

## Choosing what to sync

| Control            | Effect                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Direction**      | `Pull` (Archidekt → local) or `Push` (local → Archidekt). The description below the control spells out what the selected direction writes.                                                                                                                                                                                                                                              |
| **Changes**        | `All changes`, `Additions only`, or `Removals only` — the page's form of the CLI's [`--only`](/commands/deck-sync/#change-filter). Skipped changes are still reported per deck.                                                                                                                                                                                                         |
| **Decks**          | One row per Archidekt-linked deck, all selected by default. **All decks** toggles every row at once and syncs any deck linked after the page loaded. With nothing selected, the sync button is disabled.                                                                                                                                                                                |
| **Preview only**   | Runs as a dry run: both directions still fetch the remote deck to compute the diff, but nothing is written locally and nothing is sent to Archidekt.                                                                                                                                                                                                                                    |
| **Sync printings** | Also sync each card's set, collector number, and foil/etched finish — the page's form of the CLI's [`--sync-printings`](/commands/deck-sync/#printing-sync---sync-printings). A card held at several printings at once is reconciled copy by copy: copies are added, removed, or re-pinned so both sides hold the same printings. Off by default; unaffected by the **Changes** filter. |

Only decks whose front matter carries an Archidekt `sourceUrl` **and** a `sourceId` are listed —
those are the decks that can be synced. A deck with a `sourceUrl` but no `sourceId` is reported as
skipped when you sync all decks.

Each row shows when that deck last synced (hover for the exact timestamp), and a line above the
controls shows the most recent sync across all decks. Both refresh when a run finishes.

## Watching a run

The run streams over server-sent events, so each deck updates as it is processed:

| Icon | Meaning                                                                                      |
| ---- | -------------------------------------------------------------------------------------------- |
| ⏳   | In progress.                                                                                 |
| ✓    | Synced — including "no changes detected".                                                    |
| ⏭   | Skipped, with the reason (e.g. an Archidekt deck you do not own, which a push cannot write). |
| ✗    | Failed, with the error. The run continues with the remaining decks.                          |

Under each deck are the same lines the CLI prints: the change summary — a pull reports
`Changes: +2 added, -1 removed, ~0 quantity changed`, a push
`Changes: +2 to add, -1 to remove, ~0 quantity changes`, each gaining a
`, 3 printings changed` / `, 3 printings to change` clause when printing sync is on — what the change filter left out
(`Skipped 3 removals (applying additions only).`), any format change, a warning for each card whose
printings the two sides cannot square up when printing sync is **off**
(`Printings not synced for "Lightning Bolt": … Re-run with --sync-printings to reconcile them.`),
and the final `Saved.` /
`Pushed N card changes to Archidekt.` A closing alert summarizes the run, e.g.
`Pulled 3 decks, 1 skipped.`, or `Previewed 3 decks, 1 skipped.` for a preview run.

If the browser cannot hold the event stream open (some reverse proxies buffer server-sent events),
the page falls back to a single non-streaming request and fills in every deck's result when it
returns.

## Decks with unreadable lines

Syncing rewrites the deck file, so a line Ritual's parser cannot read — a stray comment, a malformed
card line — would be **deleted** by the save. Rather than let that happen quietly, the run refuses
those decks and shows what is at stake: each deck file, each line, and a **Sync anyway and remove
those lines** button that re-runs with your consent. This is the page's version of the confirmation
the [CLI prompts for](/commands/deck-sync/#unreadable-lines); leaving it alone and fixing the lines
by hand is the lossless option. The panel appears on the non-streaming fallback too — the run's
report carries the same decks and lines.

Decks refused this way are reported as failed (`N unreadable lines would be dropped by a sync`); the
rest of the run continues normally. A **Preview only** run is exempt, since it writes nothing: those
decks are previewed like any other and no confirmation is asked for.

## What a sync changes

Identical to the CLI, since it is the same engine:

- A **pull** applies remote card additions, removals, and quantity changes per board, adopts the
  deck's Archidekt format, records every card change in the deck's `.changes.md`, and stamps
  `lastSynced`.
- A **push** sends local card changes to Archidekt (ignoring board placement) and stamps
  `lastSynced` — **only for decks that pushed cleanly**.
- With **Sync printings** ticked, a pull also rewrites local printings and finishes to what
  Archidekt records (as `set-printing` changelog entries), and a push moves the remote entries to
  the local file's printing and finish. A card held at several printings at once is reconciled
  printing by printing, adding and removing copies as needed — see
  [Printing Sync](/commands/deck-sync/#printing-sync---sync-printings).
- With it **unticked**, printings are never added or removed. A card's new total is still spread
  over the lines (or Archidekt entries) it already occupies rather than collapsed onto one, and a
  card whose printings the two sides cannot square up is reported and left alone — see
  [Without the flag](/commands/deck-sync/#without-the-flag).

See [What Is Compared](/commands/deck-sync/#what-is-compared) for the full rules.

## Decks the remote moved on from

A push makes Archidekt match your local file, so a card added on archidekt.com since your last sync
would be silently reverted. A push therefore **refuses** any deck whose Archidekt `updatedAt` is
newer than the `sourceUpdatedAt` its last sync recorded:

```
Remote deck changed since last sync (remote: …, last synced against: …) — pull first, or pass --force to overwrite remote changes.
```

The deck is reported as failed and the rest of the run continues. The remedy on this page is to
**pull that deck first** — a pull records the new baseline even when it finds no card changes, after
which the push goes through. The `--force` override is deliberately not offered here: it is a CLI
(`deck-sync push --force`) and MCP (`sync_decks` with `force: true`) affordance, since overwriting
someone's remote edits should take an explicit act rather than a button.

See [Divergence Guard](/commands/deck-sync/#divergence-guard-push) for the full rules.

:::note
When git auto-commit is enabled in the admin config, deck files written by a sync are committed in a
single commit (`Sync decks with Archidekt (pull)`), the same as the editor and move endpoints. CLI
runs never auto-commit.
:::
