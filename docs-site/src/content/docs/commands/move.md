---
title: 'move'
---

Move cards between decks, collections, and wanted lists — interactively by default, or as a single scripted command with `--from` and `--to`.

## Usage

```bash
# Interactive session across all lists
./ritual move

# Interactive session, pre-filtered to one source list
./ritual move --from <list>

# Scripted (headless) move — no prompts
./ritual move [cardName...] --from <list> --to <list> [options]
```

`<list>` accepts an optional `deck:`, `collection:`, or `wanted:` prefix (e.g. `wanted:needs`). The prefix pins the list type; without it, the name is resolved across all three types and an ambiguous name is an error (see [List Resolution](/commands/list-resolution/)).

## Arguments

| Argument        | Description                                                   | Required                                      |
| --------------- | ------------------------------------------------------------- | --------------------------------------------- |
| `[cardName...]` | Card to move, fuzzy-matched against the source list's entries | In scripted mode, unless `--card-id` is given |

## Options

| Option                    | Description                                                                                                      | Default |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------- |
| `--from <list>`           | Source list. Alone, launches the interactive session filtered to this source; with `--to`, moves without prompts |         |
| `--to <list>`             | Destination list. Requires `--from`                                                                              |         |
| `-q, --quantity <n>`      | Number of copies to move                                                                                         | `1`     |
| `--card-id <id>`          | Select the source card by ID (the `&N` suffix in list files)                                                     |         |
| `--set <code>`            | Narrow the match to this set code — or assign the printing when the card has none                                |         |
| `--collector-number <cn>` | Narrow the match to this collector number — or assign the printing when the card has none                        |         |
| `--finish <finish>`       | Narrow the match to this finish: `nonfoil`, `foil`, `etched`                                                     |         |
| `--to-section <name>`     | Deck destinations only: add the card to this section (exact name, created if missing)                            |         |
| `--output <format>`       | Output format: `text`, `json`, or `ndjson`                                                                       | `text`  |
| `--quiet`                 | Suppress non-essential output                                                                                    | `false` |

## Scripted Moves

When both `--from` and `--to` are given, the move runs headlessly — no prompts, ever — making it safe for scripts and agents. A card selector is required: a card name argument or `--card-id`. Passing any scripting flag (a card name, `--quantity`, `--card-id`, `--set`, `--collector-number`, `--finish`, `--to-section`) without both `--from` and `--to` is a usage error (exit code 2) — it never silently falls back to the interactive session.

The scripted path uses the exact same engine as the interactive session, so all its behaviors apply: deck sources decrement quantity, notes travel with the card, both lists get changelog entries, and destination lists assign fresh `&N` IDs.

When the destination is a deck, `--to-section <name>` places the card in that section instead of the default (the first non-Commander, non-Sideboard section). The section is matched by exact name and created when missing; using it with a collection or wanted-list destination is a usage error.

When a move quantity-merges onto an existing deck line that already carries a different note, the incoming card's note cannot travel (one line has one note slot) — the existing note wins. Each dropped note is warned on stderr, and JSON output reports them in a `droppedNotes` array (`{ cardName, cardId?, note }`).

### Examples

Record a purchase — a wanted card arrived and goes into the collection with its printing assigned in the same command:

```bash
./ritual move "Demonic Tutor" --from wanted:needs --to collection:binder \
  --set sta --collector-number 90
```

Move a card between decks:

```bash
./ritual move "Lightning Bolt" --from deck:burn --to deck:storm
```

Move two copies at once:

```bash
./ritual move "Lightning Bolt" --from deck:burn --to collection:binder -q 2
```

Disambiguate between printings with `--set` (or `--card-id`):

```bash
./ritual move "Lightning Bolt" --from deck:burn --to deck:storm --set lea
```

Move a card into a specific deck section:

```bash
./ritual move "Duress" --from collection:binder --to deck:storm --to-section Sideboard
```

Select by card ID and emit a JSON record for scripting:

```bash
./ritual move --card-id 7 --from wanted:needs --to deck:storm --output json
```

```json
{
  "moved": 1,
  "card": { "name": "Demonic Tutor", "cardId": 7 },
  "from": { "type": "wanted", "name": "needs" },
  "to": { "type": "deck", "name": "Storm" },
  "droppedNotes": []
}
```

### Card Selection

- **By name**: punctuation-, case-, and accent-insensitive; an exact name match wins, otherwise substring matches are used.
- **By card ID**: `--card-id <N>` targets an entry by its persistent `&N` suffix in the source list. A card name given alongside it must match the ID's entry, or the move is refused with a usage error naming both (`--card-id 2 is 'Brainstorm', which does not match 'Sol Ring'.`) — a stale ID would otherwise move the wrong card. ID-only and name-only selection are unaffected.
- **Narrowing**: when the name matches several distinct variants (set / collector number / finish / language), the command refuses to pick one arbitrarily — it exits with a usage error listing them. Narrow with `--set`, `--collector-number`, `--finish`, or `--card-id`; two copies differing only by language (a bare English line beside a `[ja]` one) are distinct variants, and `--card-id` is what pins one of them.
- **Quantity**: `-q` moves that many copies of the _same_ printing. Requesting more copies than the source list holds is an error, and nothing is moved.

### Printings for Collection Destinations

Collections require a concrete printing. When the selected card already has one, nothing changes. When it does not (a name-only wanted entry), the printing is resolved in this order:

1. `--set` + `--collector-number`, when given (both are required together). The pair is validated against the card's known printings in the local Scryfall cache — a set/collector-number the card was never printed as is a usage error listing the printings that do exist.
2. The card's **single** known printing in the local Scryfall cache, auto-accepted.
3. Otherwise the command exits with a usage error listing the cached printings to pick from.

Both steps read the **local card cache only**: a name the cache holds no entry for has no known printing list, so step 2 cannot apply and the command asks for `--set`/`--collector-number` rather than guessing. When a pin is given for such a card, Ritual verifies that one printing directly with Scryfall (a single request) instead of validating it against an incomplete list — so the purchase flow above works on a workspace whose cache has never been bulk-downloaded, as long as it is online. Offline, that verification fails with exit code `1`. Running [`ritual cache preload-all`](/commands/cache/) once removes both round trips.

The resolution happens before anything is written — a failure here leaves both lists untouched.

## Interactive Session

Run without `--to` to launch the interactive session. With `--from <list>`, the session starts with only that list enabled as a source — the same setting the Session Filters screen edits, so it can be widened mid-session.

The session requires a terminal with prompts enabled. When prompts are unavailable (stdin is not a terminal, or `--no-input` / `RITUAL_NO_INPUT` is in force), the command refuses to open the session and exits with code `2` (`Input required: pass --from and --to …`) — the headless path is the only one available to scripts.

Key behaviors:

- **Deck moves**: Moving a card from a deck decrements its quantity by 1. The line is removed when quantity reaches 0.
- **Note preservation**: Notes (`{note}`) on deck, collection, and wanted list entries are carried over to the destination list. The one exception is a quantity-merge onto an existing deck line that already carries a different note — the existing note wins and the dropped note is reported after saving.
- **Label preservation**: A collection entry's `[labels]` override travels with a collection→collection move; moves to a deck or wanted list drop it, since those formats carry no labels token. (The list _default_ never travels — the destination collection's own front matter applies.)
- **Language preservation**: A card's language token (`[ja]`) travels with the move to any list type — a bare line stays bare, since a bare line always means English. When a printing is resolved for a collection destination, its availability in the card's language is checked like the printing itself, and the JSON record's `card` includes `language` for non-English copies.
- **Name-only wanted entries**: If a card has no set/collector number (i.e., it is a name-only wanted list entry) and the destination requires a printing (e.g., a collection), you will be prompted to resolve a printing before the move is queued. The picker lists each printing's price in your configured `defaultCurrency` — see [Printing and Finish Prices](/commands/edit/#printing-and-finish-prices).
- **Single destination**: If only one valid destination is configured, the destination prompt is skipped and the card is queued immediately.
- **Change tracking**: Source files receive a `Moved … to …` changelog entry. Destination files receive a `Moved … from …` changelog entry.
- **Deck files are rewritten in canonical form**: a move touching a deck re-serializes that deck file, so a move is **refused** when the parser cannot read some of that file (prose, comments, a fenced code block, an empty `## Main`/`## Sideboard` header) — the write would delete it. An empty extras section (`## Maybeboard`, `## Tokens`) is the exception: it holds nothing, so it is dropped rather than refused. Collection and wanted-list files are edited as text and keep such lines.

### Interactive Flow

When launched, the tool shows an autocomplete search field. You can type a card name to search, or select from the menu:

| Option                         | Description                                                       |
| ------------------------------ | ----------------------------------------------------------------- |
| `📋 View Pending Changes (N)`  | Preview queued moves before committing                            |
| `⚙️ Configure Session Filters` | Restrict which lists are eligible as sources or destinations      |
| `🚪 Exit`                      | Leave the session (asks to save, discard, or cancel when pending) |

After searching, select a card and choose a destination (or confirm the single available one). The destination prompt is also an autocomplete field — type to filter the list of destinations instead of scrolling with the arrow keys. The move is queued as a pending change. You can queue multiple moves before committing.

Foil and etched cards are flagged in the search results, the pending-changes view, and the queued-move confirmation (e.g. `Lightning Bolt (LEA:161) [Foil]`). Normal non-foil printings are shown without a finish tag.

Nothing is written until you exit and choose to save. `🚪 Exit` (or pressing Escape) leaves the
session immediately when nothing is pending; with pending moves it opens a menu to **Save and
exit** (commit all pending moves), **Exit without saving**, or **Cancel** (keep editing).

### Session Filters

Select **Configure Session Filters** to open the filter dialog. You can independently configure:

- **Move FROM** — which lists are valid sources
- **Move TO** — which lists are valid destinations

Inside each filter view, you can toggle lists by category (Decks, Collections, Wanted Lists) or individually:

```
[X] Decks (3/3)
[~] Collections (1/2)
[ ] Wanted Lists (0/1)
── Toggle All ON ──
── Toggle All OFF ──
← Done
```

The bracket indicator shows:

- `[X]` — all lists in this category are enabled
- `[~]` — some lists in this category are enabled
- `[ ]` — no lists in this category are enabled

At least one destination must remain enabled at all times.

### Chained Moves

If you move a card and then try to move the same card again (e.g., from B to C after already queuing A → B), the tool updates the pending move to reflect the final destination. Only the original source and the final destination are written to; intermediate lists are never touched.

For example, if you queue:

1. Sol Ring: Deck A → Collection B
2. Sol Ring: Collection B → Wanted C

The committed result is: Sol Ring removed from Deck A and added to Wanted C. Collection B is unchanged. Changelogs reflect `Deck A → Wanted C`.

## Changelog Format

Card names are written quoted so the name is unambiguously separated from trailing
annotations.

Source list changelog (`.changes.md`):

```
- Moved "Lightning Bolt" (LEA:161) [foil] &5 to Collection 'Red Binder'
```

Destination list changelog:

```
- Moved "Lightning Bolt" (LEA:161) [foil] &5 from Deck 'Ghyrson Starn Spellslinger'
```

## Fenced Code Blocks

Collection and wanted-list sides of a move are line-preserving: a card-looking bullet inside a
[fenced code block](/commands/edit/#fenced-code-blocks) is prose, never the line a move removes, and
the block survives byte-for-byte. A **deck** on either side is different — a deck move re-serializes
the whole deck file, which cannot reproduce a fenced block — so a move touching a deck whose file
holds one (or holds a line the parser cannot read) is refused before anything is written.

A destination whose file ends inside an **unclosed** fence is also refused: the moved card's line
would be appended past the fence opener and read back as prose.

## Exit Codes

Scripted (`--from` + `--to`) invocations follow the standard exit-code contract:

| Code | Meaning                                                                                                                                                                                                                                                            |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `0`  | The requested copies were moved                                                                                                                                                                                                                                    |
| `1`  | Runtime error, or fewer copies were moved than requested                                                                                                                                                                                                           |
| `2`  | Usage error: `--to` without `--from`, missing card selector, a `--card-id` that disagrees with the card name, ambiguous list or printing, unresolvable collection printing, invalid flag values, or an interactive session requested while prompts are unavailable |
| `3`  | Not found: unknown source or destination list, no matching card, or fewer copies available than requested                                                                                                                                                          |
