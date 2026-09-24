---
title: 'move'
---

Move cards between decks, collections, and wanted lists. Run it interactively, or as a single scripted command with `--from` and `--to`.

## Usage

```bash
# Interactive session across all lists
ritual move

# Interactive session, pre-filtered to one source list
ritual move --from <list>

# Scripted (headless) move — no prompts
ritual move [cardName...] --from <list> --to <list> [options]
```

`<list>` accepts an optional `deck:`, `collection:`, or `wanted:` prefix (`wanted:needs`) to pin the list type. Without it, the name is resolved across all three types, and an ambiguous name is an error (see [List Names](/list-resolution/)).

## Arguments

| Argument        | Description                                                   | Required                                      |
| --------------- | ------------------------------------------------------------- | --------------------------------------------- |
| `[cardName...]` | Card to move, fuzzy-matched against the source list's entries | In scripted mode, unless `--card-id` is given |

## Options

| Option                    | Description                                                                                     | Default |
| ------------------------- | ----------------------------------------------------------------------------------------------- | ------- |
| `--from <list>`           | Source list. Alone, opens the interactive session filtered to it; with `--to`, moves headlessly |         |
| `--to <list>`             | Destination list. Requires `--from`                                                             |         |
| `-q, --quantity <n>`      | Number of copies to move                                                                        | `1`     |
| `--card-id <id>`          | Select the source card by its `&N` ID                                                           |         |
| `--set <code>`            | Narrow the match to this set code, or assign the printing when the card has none                |         |
| `--collector-number <cn>` | Narrow the match to this collector number, or assign the printing when the card has none        |         |
| `--finish <finish>`       | Narrow the match to this finish: `nonfoil`, `foil`, `etched`                                    |         |
| `--to-section <name>`     | Deck destinations only: add the card to this section (exact name, created if missing)           |         |
| `--output <format>`       | Output format: `text`, `json`, or `ndjson`                                                      | `text`  |
| `--quiet`                 | Suppress non-essential output                                                                   | `false` |

## Scripted Moves

With both `--from` and `--to`, the move runs with no prompts, so it is safe for scripts and agents. A card selector is required: a card name or `--card-id`. Passing any scripting flag (a card name, `--quantity`, `--card-id`, `--set`, `--collector-number`, `--finish`, `--to-section`) without both `--from` and `--to` is a usage error (exit `2`); the command never falls back to the interactive session.

Scripted moves behave exactly like interactive ones: deck sources decrement quantity, notes travel with the card, both lists get changelog entries, and the destination assigns a fresh `&N` ID.

`--to-section <name>` places the card in that deck section instead of the default (the first section that is neither Commander nor Sideboard). The name is matched exactly and created when missing. Using it with a collection or wanted-list destination is a usage error.

When a card merges onto an existing deck line that already has a different note, the existing note wins and the incoming note is dropped. Each dropped note is warned on stderr, and JSON output lists them in a `droppedNotes` array (`{ cardName, cardId?, note }`).

### Examples

Record a purchase: a wanted card arrived and goes into the collection with its printing assigned in the same command.

```bash
ritual move "Demonic Tutor" --from wanted:needs --to collection:binder \
  --set sta --collector-number 90
```

Move a card between decks:

```bash
ritual move "Lightning Bolt" --from deck:burn --to deck:storm
```

Move two copies at once:

```bash
ritual move "Lightning Bolt" --from deck:burn --to collection:binder -q 2
```

Disambiguate between printings with `--set` (or `--card-id`):

```bash
ritual move "Lightning Bolt" --from deck:burn --to deck:storm --set lea
```

Move a card into a specific deck section:

```bash
ritual move "Duress" --from collection:binder --to deck:storm --to-section Sideboard
```

Select by card ID and emit a JSON record for scripting:

```bash
ritual move --card-id 7 --from wanted:needs --to deck:storm --output json
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

- **By name**: punctuation-, case-, and accent-insensitive. An exact name match wins; otherwise substring matches are used.
- **By card ID**: `--card-id <N>` targets an entry by its `&N` suffix. A card name given alongside it must match that entry, or the move is refused with a usage error naming both (`--card-id 2 is 'Brainstorm', which does not match 'Sol Ring'.`). This guards against a stale ID moving the wrong card.
- **Narrowing**: when the name matches several variants (set, collector number, finish, or language), the command exits with a usage error listing them rather than picking one. Narrow with `--set`, `--collector-number`, `--finish`, or `--card-id`. A bare English line beside a `[ja]` one counts as two variants; `--card-id` picks between them.
- **Quantity**: `-q` moves that many copies of the _same_ printing. Asking for more copies than the source holds is an error, and nothing is moved.

### Printings for Collection Destinations

Collections require a concrete printing. A card that already has one keeps it. A name-only card (such as a wanted entry) gets its printing resolved in this order:

1. `--set` + `--collector-number`, when given (both are required together). The pair is checked against the card's printings in the local card cache. A pair the card was never printed as is a usage error listing the printings that exist.
2. The card's **single** known printing in the local cache, accepted automatically.
3. Otherwise a usage error listing the cached printings to pick from.

Both steps read the local cache only. For a card the cache does not hold, step 2 cannot apply, so `--set`/`--collector-number` is required. In that case Ritual verifies the given printing with one direct Scryfall request, so the purchase flow above works on a workspace that has never bulk-downloaded the cache, as long as it is online. Offline, that check fails with exit `1`. Running [`ritual cache preload-all`](/commands/cache/) once makes that network check unnecessary.

Resolution happens before anything is written; a failure leaves both lists untouched.

## Interactive Session

Run without `--to` to open the interactive session. With `--from <list>`, only that list starts enabled as a source. This is the same setting the Session Filters screen edits, so you can widen it mid-session.

The session needs a terminal with prompts enabled. When [prompts are unavailable](/cli-conventions/#when-prompts-are-unavailable), the command exits with code `2` (`Input required: pass --from and --to …`) instead of opening.

Key behaviors:

- **Deck moves**: moving a card out of a deck decrements its quantity by 1. The line is removed at 0.
- **Deck merges**: a copy arriving in a deck joins an existing line only when card, printing, finish, condition, language, labels, and tags all match, the same rule the editors' add uses. A `[foil]` or `[LP]` copy gets its own line beside the plain one.
- **Note preservation**: notes (`{note}`) travel to the destination. The one exception is a merge onto a deck line that already has a different note: the existing note wins, and the dropped note is reported after saving.
- **Tag preservation**: [tags](/list-format/#card-tags) travel on every list type. They are part of the identity a deck merge checks, so a tagged copy lands on its own line rather than folding into an untagged one.
- **Label preservation**: a card's `[labels]` override travels, filtered to what the destination type [carries](/list-format/#card-labels): another collection keeps all of it, a deck keeps `proxy` only, a wanted list keeps none. A move never invents a label. The list _default_ never travels; the destination's own front matter applies.
- **Language preservation**: a language token (`[ja]`) travels to any list type, and a bare (English) line stays bare. When a printing is resolved for a collection destination, its availability in the card's language is checked too. The JSON record's `card` includes `language` for non-English copies.
- **Name-only wanted entries**: a card with no printing headed into a collection prompts you to pick one before the move is queued. The picker shows each printing's price in your configured `defaultCurrency`; see [Printing and Finish Prices](/commands/edit/#printing-and-finish-prices).
- **Single destination**: in the single-card flow, when only one enabled destination is not the card's own list, the destination prompt is skipped. [Batch Mode](#batch-mode) always asks.
- **Change tracking**: the source gets a `Moved … to …` changelog entry and the destination a `Moved … from …` entry.
- **Deck files are rewritten in canonical form**: a move touching a deck re-serializes that deck file. The move is **refused** when the parser cannot read part of the file (prose, a fenced code block, or an empty section other than `## Main`/`## Sideboard`), since the write would delete it. An empty extras section (`## Maybeboard`, `## Tokens`) holds nothing, so it is dropped rather than refused. Collection and wanted-list files are edited as text and keep such lines.

### Interactive Flow

The session opens on an autocomplete search field. Type a card name, or pick a menu item:

| Option                                      | Description                                                       |
| ------------------------------------------- | ----------------------------------------------------------------- |
| `📋 View Pending Changes (N)`               | Preview queued moves before committing                            |
| `🧺 Batch Mode — select many cards at once` | Select many cards at once and send them all to one destination    |
| `⚙️ Configure Session Filters`              | Restrict which lists are eligible as sources or destinations      |
| `🚪 Exit`                                   | Leave the session (asks to save, discard, or cancel when pending) |

Select a card, then choose a destination (or confirm the single available one). The destination prompt is also an autocomplete field. The move is queued as a pending change, and you can queue as many as you like before committing.

When the destination is a **deck**, the session asks which section the card lands in, listing the deck's sections plus `➕ New section…`. The deck's default section (the first that is neither Commander nor Sideboard) is preselected, so pressing Return accepts it. On a deck with only a Commander and a Sideboard, the default is a `Main` section the move would create, offered as a row. A deck with no sections is not asked about, and neither is a collection or wanted-list destination.

Escaping the section prompt cancels the move: in the single-card flow nothing is queued, and in Batch Mode you return to the checklist with the selection intact. `➕ New section…` asks for a name. An empty name cancels; a name matching an existing section (in any casing) folds onto that section; a name starting with `#` or containing a line break is refused, since it could not be written as a `## ` heading. A destination deck whose file the parser cannot read is refused here rather than at save time.

Foil and etched cards are flagged in search results, the pending-changes view, and the queued-move confirmation (`Lightning Bolt (LEA:161) [Foil]`). Nonfoil printings carry no finish tag.

Nothing is written until you exit and choose to save. `🚪 Exit` (or Escape) leaves immediately when nothing is pending. With pending moves it offers **Save and exit** (commit all pending moves), **Exit without saving**, or **Cancel** (keep editing).

### Batch Mode

`🧺 Batch Mode` switches the session from "one card at a time" to "many cards, one destination". It is a toggle: the batch screens replace the card search until you leave them. Cards queued here land in the same pending-move state as the single-card flow, so `View Pending Changes`, chained moves, and the save-on-exit menu behave identically.

A batch is three screens:

1. **Which lists to view.** The same two-level toggle screen the [Session Filters](#session-filters) use, seeded from the current **Move FROM** filter. Changes here are local to the batch and never rewrite the session's filters. Emptying the list leaves Batch Mode.
2. **Which cards to take.** The cards from every viewed list, combined into one searchable checklist. Each row shows the card's details (printing, finish, language, `&N`, note) plus its list. Selecting a row toggles its `[X]`; the list never reorders. Cards already queued for a move are not shown.
3. **Where they go.** An autocomplete of every enabled destination, then the deck-section question when the destination is a deck. The whole selection is queued to that one destination. Cards already sitting in the chosen list are skipped and counted.

The rows above the cards are:

| Row                     | Description                                                                     |
| ----------------------- | ------------------------------------------------------------------------------- |
| `✅ Done selecting (N)` | Continue to the destination screen; refuses while nothing is selected           |
| `☐ Select all`          | Tick every card on screen — flips to `☑ Deselect all` once everything is ticked |
| `☑ Select all from…`    | Shown instead when more than one list is being viewed (see below)               |
| `⬅ Exit batch mode`     | Return to the single-card search                                                |

`☑ Select all from…` opens a picker of the viewed lists. Tick at least one and choose `→ Continue` to select every card in them, or take `★ All selected lists` to select every card from every viewed list regardless of the boxes. Both add to the current selection. `← Back` (or Escape) returns to the checklist unchanged.

Escape at the destination or section question returns to the checklist with the selection intact, and so does a batch in which nothing could be queued. Your selection is never thrown away.

After a batch is queued the session stays in Batch Mode and reopens at the list picker with the same lists ticked. When every card of the viewed lists is already queued (or those lists are empty), Batch Mode reports `No cards left to move in the selected lists.` and returns to the card search. So Batch Mode ends in four ways: `⬅ Exit batch mode`, Escape on the checklist, emptying the list picker, or running the viewed lists dry.

Cards can drop out of a queued batch, each reported with a count:

- It already sits in the chosen destination.
- It is a printing-less card headed for a **collection** with no known printings. Each such card is prompted for individually after the destination is chosen, as in the single-card flow.
- Escaping one of those printing prompts ends the batch there. Cards already resolved are queued; the rest are reported as left unqueued.

### Session Filters

**Configure Session Filters** opens the filter dialog with two independent settings:

- **Move FROM**: which lists are valid sources
- **Move TO**: which lists are valid destinations

Inside each view, toggle lists by category (Decks, Collections, Wanted Lists) or individually:

```
[X] Decks (3/3)
[~] Collections (1/2)
[ ] Wanted Lists (0/1)
── Toggle All ON ──
── Toggle All OFF ──
← Done
```

The bracket shows how much of the category is enabled: `[X]` all, `[~]` some, `[ ]` none.

At least one destination must stay enabled.

### Chained Moves

If you queue a move for a card and then move the same card again (B to C after A to B), the pending move is updated to the final destination. Only the original source and the final destination are written; intermediate lists are never touched.

For example, if you queue:

1. Sol Ring: Deck A → Collection B
2. Sol Ring: Collection B → Wanted C

The result is Sol Ring removed from Deck A and added to Wanted C. Collection B is unchanged, and the changelogs read `Deck A → Wanted C`.

## Changelog Format

Card names are quoted so the name is clearly separated from trailing annotations.

Source list changelog (`.changes.md`):

```
- Moved "Lightning Bolt" (LEA:161) [foil] &5 to Collection 'Red Binder'
```

Destination list changelog:

```
- Moved "Lightning Bolt" (LEA:161) [foil] &5 from Deck 'Ghyrson Starn Spellslinger'
```

## Custom Art

A moved card takes its [custom art](/custom-art/#art-follows-the-card) with it: the entry leaves the source list's `.art.json` and is re-filed under the destination line's new `&N`. Two exceptions leave the destination's art alone: a copy that merges onto a line the destination already had, and a deck line that still has copies left in the source (it keeps its ID and its art). Art sidecars carry no changelog entry, but an auto-commit stages them.

## Categories

A card's [categories](/commands/categories/) do **not** travel with it. A category belongs to a card **name in one list**, so the arriving copy has whatever categories the destination already recorded for that name, if any.

The move does rewrite the categories sidecars of the lists it writes. Each is pruned to the names that list still holds, so a source that lost its **last** copy of a name loses that name's entry. Pruned names are reported on stderr, and `<list>.categories.json` and its `.sha256` are staged by an auto-commit. A list holding a bullet the card-line parser could not read is skipped: its sidecar keeps every entry, stale or not, until a later clean parse (a save, or [`ritual cleanup`](/commands/cleanup/)) prunes them.

## Fenced Code Blocks

Collection and wanted-list sides of a move are line-preserving. A card-looking bullet inside a [fenced code block](/list-format/#fenced-code-blocks) is prose, never the line a move removes, and the block survives byte-for-byte. A **deck** on either side is re-serialized whole, which cannot reproduce a fenced block, so a move touching a deck whose file holds one (or any line the parser cannot read) is refused before anything is written.

A destination whose file ends inside an **unclosed** fence is also refused, since the new line would be appended inside the fence and read back as prose.

## Exit Codes

Scripted (`--from` + `--to`) invocations follow the standard exit-code contract:

| Code | Meaning                                                                                                                                                                                                                                                            |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `0`  | The requested copies were moved                                                                                                                                                                                                                                    |
| `1`  | Runtime error, or fewer copies were moved than requested                                                                                                                                                                                                           |
| `2`  | Usage error: `--to` without `--from`, missing card selector, a `--card-id` that disagrees with the card name, ambiguous list or printing, unresolvable collection printing, invalid flag values, or an interactive session requested while prompts are unavailable |
| `3`  | Not found: unknown source or destination list, no matching card, or fewer copies available than requested                                                                                                                                                          |
