---
title: 'Admin API: Import and Export'
description: Admin API routes to import decks, CSV files and change bundles, and to export cards.
sidebar:
  label: 'Import and export'
  order: 5
---

Routes that bring cards in (a deck from a URL or text, a CSV file, a change bundle) and that export cards as CSV or JSON. Every route here follows the [conventions on the overview page](/admin/api/): the [message triple](/admin/api/#the-message-triple), the [error responses](/admin/api/#error-responses) and [authentication](/admin/api/#authentication).

## Import Deck

```
POST /api/import-deck
```

Import a deck from a supported URL, or from decklist text supplied directly (pasted in the UI or read from an uploaded file). The request is one of two shapes, distinguished by `mode`.

**Request body (URL):**

```json
{
  "mode": "url",
  "url": "https://archidekt.com/decks/123456",
  "overwrite": false,
  "syncPrintings": true
}
```

**Request body (text):**

```json
{
  "mode": "text",
  "content": "4 Lightning Bolt\n1 Sol Ring\n\n## Sideboard\n2 Pyroblast",
  "name": "My Burn Deck",
  "overwrite": false
}
```

| Field           | Type    | Required         | Default | Description                                                                                                                                                                                                       |
| --------------- | ------- | ---------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mode`          | string  | Yes              | —       | `"url"` or `"text"`                                                                                                                                                                                               |
| `url`           | string  | When `url` mode  | —       | Archidekt, Moxfield, or MTGGoldfish URL                                                                                                                                                                           |
| `content`       | string  | When `text` mode | —       | Decklist text (`QTY Name` per line; `## Heading` lines start sections)                                                                                                                                            |
| `name`          | string  | No               | —       | Deck name for `text` mode; ignored if the text defines its own `# Title`                                                                                                                                          |
| `overwrite`     | boolean | No               | `false` | Overwrite existing deck on conflict                                                                                                                                                                               |
| `syncPrintings` | boolean | When `url` mode  | —       | `true` keeps the exact printings (set, collector number, finish) the source lists; `false` imports bare card names. Rejected in `text` mode. See [Printing choice](/commands/import/#printings-from-a-url-import) |

`syncPrintings` is required in `url` mode because the CLI asks interactively and over HTTP the caller must decide. In `text` mode the printings come from the pasted lines.

**Response:**

```json
{
  "success": true,
  "message": "Successfully imported 'My Deck'",
  "messageKey": "admin.api.importDeck.imported",
  "messageParams": { "name": "My Deck", "notes": { "list": [], "join": "concat" } },
  "deckName": "My Deck",
  "syncPrintings": true,
  "warnings": [],
  "advisories": []
}
```

- `warnings` lists text lines the parser skipped — content that was **not** imported (always empty for URL imports). Like `advisories`, it is a list of message triples: the English `message`, plus `messageKey`/`messageParams`. A line the card-line grammar refused is keyed `domain.card.line.atLine` (`{ line, text }`), its diagnostic nested as `text` (`domain.card.line.*`). A warning whose card **was** imported, only without the labels it carried, has `"labelsDropped": true`; the others are lines that were skipped.
- `advisories` lists content that **was** read but is worth a word: a card name still carrying a printing token, a skipped MTG Arena `About` line, or an empty `## Maybeboard`/`## Tokens` header the write drops. On a URL import it carries notes about the source's [categories](/commands/import/#categories-from-a-url-import): names Ritual refused, or a categories file that could not be written.
- When either array is non-empty, `message` notes the count, as a nested message per kind of note (see [the message triple](/admin/api/#the-message-triple)).

A URL import from Archidekt or Moxfield also writes the deck's `<deck>.categories.json` (and its `.sha256`), replacing the file a replaced deck had; with git auto-commit enabled, the categories and primer files are committed with the deck.

Pasted/uploaded text is read with the same dialects as [`ritual import`](/commands/import/#mtg-arena--mtgo-exports): Ritual's own format plus MTG Arena/MTGO/Moxfield exports (`4 Lightning Bolt (M10) 146`, bare `Deck`/`Sideboard` markers, and a `*F*`/`*E*` finish marker either trailing or between the set and the collector number).

A name/ID conflict without `overwrite`, or a deck name with no characters usable in a file name, fails with a `400` (the same usage classification the CLI turns into exit code `2`), not a `500`.

An Archidekt URL whose deck Archidekt does not show (it does not exist, or is private) fails with a `404`; Archidekt failing any other way (any other 4xx such as a `403`, a 5xx, a rate limit that outlived its retries, or a `200` whose reply cannot be read) answers `502`. Both bodies are the [error response](/admin/api/#error-responses), English plus its key whatever the server's UI language:

```json
{
  "success": false,
  "message": "Failed to fetch Archidekt deck 123456 (HTTP 404): Not found.",
  "messageKey": "domain.sync.archidekt.deckFailedWithReason",
  "messageParams": { "deckId": "123456", "status": 404, "reason": "Not found." }
}
```

`status` is Archidekt's HTTP status, a number. `reason` is Archidekt's own explanation, quoted as it sent it and cut to a few hundred characters (several are a `clauses` list); a reply that explains nothing, such as an HTML error page, gives `domain.sync.archidekt.deckFailed`, without `reason`. A reply Archidekt answered but Ritual could not read (not JSON, or its `cards` not a list of entries) is `domain.sync.archidekt.deckUnreadable` (`deckId`, and what was wrong nested as `reason`).

## Import CSV

```
POST /api/import-csv
```

Import cards from CSV text into a deck, collection, or wanted list. Used by the admin site's **Import CSV** page and exposed as the MCP `import_csv` tool; shares its parsing, normalization, and column-mapping engine with the [`import`](/commands/import/#csv-imports) CLI command's CSV mode.

**Request Body:**

```json
{
  "listType": "collection",
  "name": "Red Binder",
  "mode": "append",
  "content": "Name,Set,Collector Number,Quantity\nSol Ring,C19,221,2",
  "columns": "name=1,set=2,collector-number=3,quantity=4",
  "hasHeader": true
}
```

| Field       | Description                                                                                                                                                                                    | Required |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `listType`  | `deck`, `collection`, or `wanted`                                                                                                                                                              | Yes      |
| `name`      | New list name (`create`/`overwrite`) or an existing list to append to (`append`)                                                                                                               | Yes      |
| `mode`      | `create` (default — fails if the list exists), `overwrite`, or `append`                                                                                                                        | No       |
| `format`    | Deck format; required when creating or overwriting a deck                                                                                                                                      | No       |
| `content`   | Raw CSV text                                                                                                                                                                                   | Yes      |
| `columns`   | 1-based column mapping spec, e.g. `name=1,set=2,collector-number=3`. Fields: `name`, `set`, `collector-number`, `condition`, `finish`, `language`, `tags`, `categories`, `section`, `quantity` | Yes      |
| `hasHeader` | Whether the first row is a header row (default `true`)                                                                                                                                         | No       |

`format`, when given, must be a canonical deck format key — see [Deck Format](/commands/new/#deck-format). An unrecognized value returns `400`.

**Response:**

```json
{
  "success": true,
  "message": "Appended 2 cards to collection 'Red Binder'; 1 row failed validation",
  "messageKey": "admin.api.importCsv.partial",
  "messageParams": {
    "result": {
      "messageKey": "admin.api.importCsv.appended",
      "messageParams": {
        "listType": "collection",
        "cards": { "messageKey": "domain.count.cards", "messageParams": { "count": 2 } },
        "name": "Red Binder"
      }
    },
    "failed": { "messageKey": "admin.api.importCsv.rowsFailed", "messageParams": { "count": 1 } }
  },
  "cardCount": 2,
  "failures": [
    {
      "lineNumber": 3,
      "raw": "No Printing,,",
      "reason": "Missing set code (required for collections)",
      "reasonKey": "domain.import.csv.missingSet"
    }
  ],
  "failedCount": 1,
  "warnings": [
    {
      "message": "Skipped header row: Name,Set,Collector Number,Quantity",
      "messageKey": "admin.api.importCsv.headerSkipped",
      "messageParams": { "row": "Name,Set,Collector Number,Quantity" }
    }
  ]
}
```

`message`'s counts are nested messages (see [the message triple](/admin/api/#the-message-triple)), so a client renders them in its reader's language. A partial import names the failed rows in the same sentence.

**`failures`.** Each row's `reason` is English — several reasons joined with `; ` — with `reasonKey`/`reasonParams` beside it, the [message triple](/admin/api/#the-message-triple) under the field's own name. A row failing for several reasons carries `reasonKey: "domain.sync.reasonList"` and the reasons nested as `reasonParams.reasons` (`{ list: [{ messageKey, messageParams }, …], join: "clauses" }`), so a client joins them in its reader's language. A reason worded outside the catalog (a [tag](/list-format/#card-tags) refusal) carries no key.

**Merging.** In a **deck**, rows naming the same card **and** the same printing merge into one line with their quantities summed, in every mode. **Collections and wanted lists** keep one line per physical copy in every mode, so N rows of the same printing stay N lines.

**`warnings`** is a list of message triples — the English `message`, plus `messageKey`/`messageParams` (which may nest) when the notice has a catalog entry. It reports:

- the row that was skipped as a header, plus a second entry when that row does not look like one (`… — set hasHeader to false to import it as a card.`). A row looks like a header when a cell matches a known column name: the English ones, plus the spellings of every language this build ships — never just the server's own interface language, so the answer, and `warnings`, are the same bytes whoever runs the server;
- category values a row's `categories` cell refused (the row still imported), and, on a deck, values that named a board and set the row's section instead (`domain.import.csv.rowNotice`, whose `notice` param nests what happened to the value);
- anything that went wrong writing the list's [categories sidecar](/list-format/#categories-namecategoriesjson), including the card names whose entries an overwrite pruned.

It is empty when `hasHeader` is `false` and nothing else had news.

**Categories.** A mapped `categories` column (headers `category` or `categories`) writes the list's `<name>.categories.json` sidecar: comma-separated values, the first primary. On a **deck**, a cell value that names a board (`Sideboard`, `Commander`, `Tokens`, …) sets the row's section instead of becoming a category, and an explicit non-empty `section` cell wins. The sidecar and its `.sha256` join the auto-commit set.

**Status codes.** `cardCount`, `failures`, `failedCount`, and `warnings` are **always** present. Rows that fail validation are returned in `failures` while the valid rows still import, and `success` is a pure envelope flag: a request where _every_ row failed is still a `200` carrying `cardCount: 0` and the per-row report. The response is `400` only when the **request** is invalid: bad body shape, unknown `listType`/`format`, an unparseable column spec, a mapped column number the file has no column for (`Column 99 (mapped to 'name') does not exist: the file has 6 columns`), an unparseable CSV, no data rows, an append to a list that does not exist, a new list whose name has no usable file-name characters, a new list whose name matches an existing one, or an append to a file holding content its rewrite would delete. Each of those refusals is keyed; an unparseable CSV's (`admin.api.importCsv.parseFailed`) nests the CSV reader's own message as its `reason` param. An unknown `format` is `domain.list.deckFormat.invalid`, whose `formats` param is the valid keys as a `{ list, join: "unit" }`; an unusable name is `domain.list.name.unusable`; a name that collides is `domain.import.nameTaken`, whose `reason` param nests the list engine's own collision message (`domain.list.lifecycle.exists` or `domain.list.lifecycle.existsFolded`); and an append the rewrite gate refuses is `domain.list.unreadableContent`, whose `problems` param is a `{ list, join: "clauses" }`. Appends record each added card in the list's changelog. When git auto-commit is enabled, the list file (and changelog) are committed.

## Import Changes

```
POST /api/import-changes
```

Apply a change bundle exported from the site editor to the underlying lists. Used by the admin site's **Import Changes** page and exposed as the MCP `import_change_bundle` tool; shares its apply engine with the [`import-changes`](/commands/import-changes/) CLI command.

**Request Body:** the exported JSON, verbatim — a version-3 `ritual-change-bundle` covering one or more lists. Each list's own edits sit in `lists[].changes`. Cross-list moves are normalized into the top-level `moves` array and never appear as `move-from`/`move-to` inside a list's `changes`. Each move is one copy, naming its source and destination list by kind + name (the slug is a best-effort hint), and carries:

- the copy's printing fields (`set`, `collectorNumber`, `finish`, `condition`, `language`);
- optional `tags` (the card's [tags](/list-format/#card-tags), canonical and without the `#`), landing on the destination line;
- optional `labels` (the card's [labels](/list-format/#card-labels) as its source list states them, signed: its effective labels there plus a `no-` for each label its source stated that it lacks), landed by the [move rule](/commands/move/) — a proxy stays a proxy and a real card real, a stated label keeps its state, an unstated one takes the destination's default — as far as the destination type accepts, and optional `note`, landing on the destination line;
- optional `toCardId`, the destination line's `&N` as the exporting editor allocated it, which the import re-targets like an `add`'s id;
- for a copy pinning a name-only destination line, `pinsCardId` and `replacement`.

```json
{
  "format": "ritual-change-bundle",
  "version": 3,
  "exportedAt": "2026-06-04T00:00:00.000Z",
  "lists": [
    {
      "kind": "deck",
      "slug": "Winota Stax",
      "name": "Winota Stax",
      "changes": [{ "id": "a1", "timestamp": 1, "action": "add", "cardName": "Counterspell" }]
    }
  ],
  "moves": [
    {
      "id": "m1",
      "timestamp": 2,
      "cardName": "Sol Ring",
      "from": { "kind": "deck", "slug": "Winota Stax", "name": "Winota Stax" },
      "to": { "kind": "collection", "slug": "binder", "name": "Binder" },
      "set": "c19",
      "collectorNumber": "221",
      "cardId": 5,
      "toCardId": 9
    }
  ]
}
```

**Response:**

```json
{
  "success": true,
  "message": "Applied 2 changes across 2 lists",
  "messageKey": "admin.api.importChanges.applied",
  "messageParams": {
    "changes": { "messageKey": "domain.count.changes", "messageParams": { "count": 2 } },
    "lists": { "messageKey": "domain.count.lists", "messageParams": { "count": 2 } }
  },
  "failedCount": 0,
  "lists": [
    {
      "kind": "deck",
      "slug": "Winota Stax",
      "name": "Winota Stax",
      "applied": 1,
      "conflicts": [],
      "droppedNotes": [{ "cardName": "Sol Ring", "cardId": 3, "note": "from trade" }]
    },
    {
      "kind": "collection",
      "slug": "binder",
      "name": "Binder",
      "applied": 1,
      "conflicts": [],
      "droppedNotes": []
    }
  ]
}
```

**How changes apply.** Every list's changes and every move are merged into one timestamp-ordered stream and applied in batches (consecutive events aimed at the same list); each batch loads its list fresh immediately before saving it. Changes are re-targeted to the list's current card IDs: by ID when it still exists, otherwise by card name (a copy the same import just added first). Added cards (and arriving moves) take the smallest free ID at the point they apply: a card the same batch removed earlier has already released its ID, and a deck copy that merges onto a line the deck already has takes that line's ID rather than drawing one.

**Conflicts.** Changes whose target card no longer exists, whose action cannot apply to that list (a commander change aimed at a collection), or which would set a foil/etched finish on a card that pins no printing are skipped and reported in that list's `conflicts` as `{ change, reason }`, where `reason` is `"target-not-found"`, `"not-applicable"`, or `"needs-printing"`.

**Moves.** Each entry of `moves` is applied on its **destination** list as a `move-to`: that save adds the copy there, takes it out of the source list (by the source line id the move names, else by the exact printing, else by name for a printing-less source line), and writes both changelogs. A destination named only by a move is resolved by its slug, then by its name, and reported as a list of its own (`slug` is the file basename it resolved to). `lists[].applied` counts moves arriving in the list; a replacement printing written back to a move's source list is not counted.

**Dropped notes.** Each list's `droppedNotes` gathers its saves' own `droppedNotes` (see [Save a List](/admin/api/lists/#save-a-list)): a moved card that merged onto a deck line already holding a different note keeps the line's note. Each distinct note is listed once. Empty when none.

**Failures.** A list that fails to resolve, load, or save carries an `error` string (English) and is counted in `failedCount`. When the failure has a catalog entry — the load or save route's own keyed refusal, such as `admin.api.list.notFoundListRoute` — `errorKey` and `errorParams` ride beside it, as `messageKey` and `messageParams` do beside `message`. The failing batch applied nothing, that list's later batches are skipped, and batches already applied stay applied and counted; the other lists continue. `success` stays `true` on a partial import, so read `failedCount` (and each list's `error`), not the envelope. Every list that received changes gets a changelog entry, through the same save path as the editors. The response is `400` when the body is not a valid change bundle; its `message` says why (`Move #1 "from" is not an object.`, `List #2: Missing or invalid "slug".`), keyed `domain.changes.problem.*`, and when the problem is about one change or move that record is nested as the `subject` param.

## Export Cards

```
POST /api/export
```

Render a CSV, JSON, plain-text, or Markdown export of cards from decks, collections, and wanted lists. Exposed as the MCP `export_cards` tool; shares its engine with the [`export`](/commands/export/) CLI command. By default the rendered export is returned inline as a string; with `write: true` it is written to a server-named file instead.

**Request Body:** every field is optional. With no `lists` and no `cards`, every list is exported.

```json
{
  "lists": [{ "type": "deck", "name": "Winota Stax" }],
  "cards": ["sol ring"],
  "filters": {
    "name": "sol",
    "set": "c21",
    "finish": "foil",
    "conditions": ["NM", "none"],
    "labels": ["trade"],
    "tags": ["Signed"]
  },
  "format": "csv",
  "columns": ["name", "set", "collectorNumber", "quantity"],
  "header": true,
  "quoteAll": false,
  "dialect": "ritual",
  "preset": "trade-sheet",
  "write": false
}
```

Selection:

- `lists` names resolve like CLI list arguments; the optional `type` pins an ambiguous name.
- Each `cards` entry is whitespace-separated name terms. Every entry across all lists whose name matches all terms is added, deduplicated against the selected lists.
- `filters.conditions` takes condition grades and/or `none` (cards with no condition marked), matching the CLI's `--condition`.
- `filters.labels` takes label values (`sale`, `trade`, `keep`, `proxy`) and/or `none` (unlabeled), matched against each deck and collection card's effective labels like the CLI's `--labels`. Wanted entries carry no labels and never match.
- `filters.tags` takes [card tags](/list-format/#card-tags) and keeps every card carrying any of them, matched exactly and case-sensitively on every list type, wanted lists included. A card with no tags never matches, and there is no `none` value (`none` is an ordinary tag). A malformed tag is a `400`.
- `preset` starts from a saved or built-in [export preset](/commands/export/#presets). The built-in `archidekt` preset needs no config, and a saved preset of that name shadows it. Explicit fields override the preset's values.

Output:

- `format` is `csv` (default), `json`, `text` (a plain-text decklist, quantities aggregated), or `md` (canonical list markdown without `&N` ids) — see [export formats](/commands/export/#formats).
- `columns`, `header`, and `quoteAll` shape `csv`/`json` output only and are ignored for `text`/`md` (unlike the CLI, the route does not reject the combination).
- `dialect` is the output vocabulary, ignored for `md` — see [dialects](/commands/export/#dialects). For `csv`/`json` it spells finish and condition: `ritual` (the default; `nonfoil`/`foil`/`etched`, `NM`…`DMG`) or `archidekt` (`Normal`/`Foil`/`Etched` under a `Variant` header, and `NM|LP|MP|HP|D`). For `text` it picks the decklist form: `arena` and `moxfield` write bare board markers over `1 Name (SET) CN` lines (moxfield splices `*F*`/`*E*` between the set and the collector number, and closes each line with the card's categories as `#tag` tokens) and omit maybeboard/token cards, naming them in the response's `warnings`.
- An unknown `dialect` or `preset` is a `400`.
- Selected `scryfallId` and `edhrecRank` columns are resolved from the local Scryfall cache.
- The `categories` column exports the card name's [categories](/commands/categories/) in that list, comma-joined primary first, and `primaryCategory` just the first of them. Both are empty for an uncategorized card. The `md` format and every `text` dialect but `moxfield` drop them; `moxfield` text writes them as `#tag` tokens.

**Response:** the body is discriminated by `mode`.

Content mode (the default, or `write: false`):

```json
{
  "success": true,
  "mode": "content",
  "format": "csv",
  "entryCount": 2,
  "warnings": [],
  "content": "Name,Set,Collector Number,Quantity\nSol Ring,C21,263,1\n..."
}
```

File mode (`write: true`):

```json
{
  "success": true,
  "mode": "file",
  "format": "csv",
  "entryCount": 2,
  "warnings": [],
  "path": "exports/Binder-20260728.csv",
  "bytes": 214
}
```

`write` must be a boolean; anything else is a `400`.

The file lands under an `exports/` directory in the base dir, which [`init-site`](/commands/init-site/) adds to `.gitignore`. The server picks the name, `<scope>-<YYYYMMDD>.<ext>`: scope is the single selected list's sanitized name, `cards` for a card-pick-only export, or `all-lists` otherwise, and the date is UTC. A name already taken gains the lowest free `-2`, `-3`, … suffix, so a write never overwrites an earlier export. `path` is **base-dir-relative**, so a caller that trusts it cannot be walked outside the workspace. The written file is newline-terminated and byte-identical to what the CLI's `export --out` writes.

`warnings` carries [message triples](/admin/api/#the-message-triple) (`domain.export.warning.*`), never bare strings:

- list parse warnings (`domain.export.warning.inList`, the parser's own message nested as `warning`);
- `cards` terms that matched nothing;
- one entry naming the maybeboard/token sections a `text` export in the `arena` or `moxfield` dialect left out (`domain.export.warning.extrasOmitted`, whose `sections` is a `{ list, join: "unit" }` of `domain.export.warning.sectionCount` messages with per-section counts, each `section` a `domain.board.*` message when it is a standard board such as `Maybeboard`, else the heading as written);
- one entry naming the categories a `text` export in the `moxfield` dialect could not write as tags (a space, a leading `!`, or a character a Ritual tag cannot hold);
- one entry per list whose [categories sidecar](/list-format/#categories-namecategoriesjson) could not be read (that list exports with empty category cells);
- when the `scryfallId` column is selected, one entry per printing the local Scryfall cache does not hold (`domain.export.warning.scryfallIdUncached`), and one per card name whose line pins no printing (`domain.export.warning.scryfallIdUnpinned`); either cell renders empty;
- when the `edhrecRank` column is selected, one entry per card name the local Scryfall cache does not hold (an unranked card is not warned about — its cell is simply empty).

The response is `400` for an unknown list, preset, column, dialect, or filter value. A refused column or condition/label filter value is keyed `domain.export.problem.*`. An unknown value, or an empty list, offers the values accepted as a `{ list, join: "unit" }` (`columns`, or `values`); a duplicate column names only the duplicate. A write that cannot settle on a free file name answers `500` with `domain.export.problem.fileNameExhausted`.
