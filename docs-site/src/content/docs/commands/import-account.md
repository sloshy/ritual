---
title: 'import-account'
---

Import all public decks from an Archidekt user account, or your own private decks when you are logged in.

## Usage

```bash
ritual import-account [username] [options]
```

## Arguments

| Argument     | Description                                                  | Required |
| ------------ | ------------------------------------------------------------ | -------- |
| `[username]` | Archidekt username to fetch decks for (or omit if logged in) | No       |

## Options

| Option                | Description                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------------- |
| `-a, --all`           | Import all decks without interactive selection                                                        |
| `-o, --overwrite`     | Overwrite existing decks without prompting                                                            |
| `-y, --yes`           | Automatically answer yes to the overwrite confirmation when an import conflicts with an existing deck |
| `--sync-printings`    | Keep the exact printings (set, collector number, finish) Archidekt states, without asking             |
| `--no-sync-printings` | Import bare card names, dropping the printings Archidekt states, without asking                       |
| `-n, --dry-run`       | Preview imports without writing deck files                                                            |
| `--output <format>`   | Output format: `text` (default), `json`, or `ndjson`                                                  |
| `--quiet`             | Suppress progress lines; never the structured payload, errors, or essential warnings                  |

The account's deck list is fetched **in full**. The Archidekt endpoint paginates, and every page is followed (through the same paced, rate-limit-aware client the sync commands use), so `Found N decks.` and `--all` cover the whole account rather than its first page.

Whether the imported decks keep the exact printings Archidekt states is the same choice [`import`](/commands/import/#printings-from-a-url-import) makes, asked **once for the whole run**. It is asked before anything is fetched, like the `--all` gate, so an unanswerable run fails without wasted requests (default yes). `--sync-printings` / `--no-sync-printings` answer it up front. Under `--no-input` with neither flag the printings are kept, with a line saying so.

## Scripting Without Prompts

The global `--no-input` flag (or `RITUAL_NO_INPUT`) disables all prompts. Deck selection is a prompt, so a headless run must pass `--all` explicitly. Omitting it whenever [prompts are unavailable](/cli-conventions/#when-prompts-are-unavailable) (including a plain piped run) is a usage error (exit code `2`) before anything is fetched. A per-deck name conflict in such a run reports the same `--overwrite`/`--yes` guidance [import](/commands/import/) gives, and the run exits `2`. `-y, --yes` only answers the overwrite confirmation on conflicts. For that purpose it is equivalent to `--overwrite`, matching [import](/commands/import/), and it does not imply `--all`.

## JSON Output

With `--output json` (or `ndjson`) the run emits one structured result:

```json
{
  "username": "johndoe",
  "found": 12,
  "selected": 12,
  "imported": 11,
  "failed": 1,
  "skipped": 0,
  "dryRun": false,
  "decks": [
    {
      "id": 7031486,
      "name": "Bant Ramp",
      "status": "imported",
      "action": "created",
      "filePath": "decks/Bant Ramp.md"
    },
    {
      "id": 7031487,
      "name": "Burn",
      "status": "failed",
      "error": "Import conflict for 'Burn.md'..."
    }
  ]
}
```

Each deck's `status` is `imported`, `planned` (a `--dry-run` preview), `failed`, or `skipped` (a conflict prompt that was cancelled). `action` is the save resolution (`created`, `overwritten`, `renamed`) and is absent when nothing was written. Errors are emitted on stderr as `{ "error": { "code", "message" } }`.

## Empty Results

Archidekt answers an unknown `ownerUsername` with an empty result set, exactly what a real account with no public decks returns, so the two cannot be told apart. A run that finds no decks says so:

```
No public decks found for 'johndoe' — check the spelling; Archidekt does not distinguish an
unknown user from an account with no public decks. Private decks require `ritual login archidekt`.
```

That warning goes to stderr and survives `--quiet`. The run still exits `0`, since nothing failed.

## Exit Codes

| Code | Meaning                                                                                                                                                                                                                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `0`  | Success — the selected decks were imported, or fully previewed under `--dry-run` (including a run that found no decks)                                                                                                                                                                                 |
| `1`  | Runtime failure — a fetch or save error on at least one deck                                                                                                                                                                                                                                           |
| `2`  | Usage error — no username and not logged in, `--all` omitted when prompts are unavailable, an unanswerable [printings prompt](/commands/import/#printings-from-a-url-import), a per-deck conflict needing `--overwrite`/`--yes`, or a cancelled selection or printings prompt (`Cancelled.` on stderr) |

## Examples

Import decks interactively (select which ones to import):

```bash
ritual import-account johndoe
```

Import all public decks from a user:

```bash
ritual import-account johndoe --all
```

Plan an import in CI without prompts:

```bash
ritual import-account johndoe --all --no-input --dry-run
```

Import every deck and consume the result in a script:

```bash
ritual import-account johndoe --all --no-input --output json --quiet
```

## Notes

- If you are logged in to your account, you can import your private or unlisted decks.
- Interactive mode lets you select which decks to import with a checkbox interface.
- All selected decks are imported sequentially.
- Cancelling the selection prompt exits `2` with `Cancelled.` on stderr, matching [import](/commands/import/) and [import-changes](/commands/import-changes/), so a script can tell a cancelled run from a successful one.
- Deck lines keep the printing (set, collector number, and foil/etched finish) Archidekt states for each card unless the run declined them. See [Printings from a URL import](/commands/import/#printings-from-a-url-import).
