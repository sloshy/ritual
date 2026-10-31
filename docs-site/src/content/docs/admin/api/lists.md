---
title: 'Admin API: Lists'
description: 'Admin API routes to create, load, save, rename and delete decks, collections and wanted lists, and to read their metadata, art, diffs and history.'
sidebar:
  label: 'Lists'
  order: 2
---

Routes for decks, collections and wanted lists: create, load, save, rename and delete them, edit their metadata and custom art, compare two lists, and read or rewrite their change history. Every route here follows the [conventions on the overview page](/admin/api/): the [message triple](/admin/api/#the-message-triple), the [error responses](/admin/api/#error-responses) and [authentication](/admin/api/#authentication).

## List All Lists

```
GET /api/lists
```

Returns every list (deck, collection, wanted) as a slug-keyed summary. The single canonical enumeration route; it populates the [Change History](/admin/history/) page's list picker and the cross-list move targets.

**Response:**

```json
{
  "success": true,
  "lists": [{ "type": "deck", "slug": "my-deck", "name": "My Deck" }]
}
```

## List Decks

```
GET /api/decks
```

List all deck files in the decks directory.

**Response:**

```json
{
  "decks": ["burn", "elves", "mono-red-aggro"]
}
```

## Create Deck

```
POST /api/deck/create
```

Create a new deck file, named after the deck — see [List file names](/commands/new/#list-file-names). A name with no usable file-name characters returns `400`.

**Request Body:**

```json
{
  "name": "My Commander Deck",
  "format": "commander"
}
```

| Field    | Description                           | Required |
| -------- | ------------------------------------- | -------- |
| `name`   | Deck name (used to generate the slug) | Yes      |
| `format` | Deck format (default: `"commander"`)  | No       |

`format` must be a canonical deck format key — see [Deck Format](/commands/new/#deck-format). An unrecognized value returns `400` and creates nothing. The new deck starts with the sections its format expects: an empty `## Commander` and `## Main` for a format with a command zone, otherwise `## Main` alone (see [`new`](/commands/new/#output)).

**Response:**

```json
{
  "success": true,
  "message": "Created deck 'My Commander Deck'",
  "slug": "My Commander Deck"
}
```

### List lifecycle responses

Create, rename, and delete answer identically for decks, collections, and wanted lists:

| Operation | Success body                                                    |
| --------- | --------------------------------------------------------------- |
| Create    | `{ success: true, message, slug }`                              |
| Rename    | `{ success: true, message, newSlug, newFilePath, oldFilePath }` |
| Delete    | `{ success: true, message, deletedFiles, trashDir }`            |

`newFilePath`/`oldFilePath` are the list's paths after and before the rename. `deletedFiles` is every path the delete removed: the list plus its sidecar files. They are moved, not erased: `trashDir` is the [trash folder](/commands/delete/#restoring-a-deleted-list) now holding them, where each keeps its workspace-relative path. All of these paths are absolute; `message` names the trash folder relative to the workspace.

A refusal is the shared [error envelope](/admin/api/#error-responses) at one of these statuses:

- `400` — a missing or invalid argument.
- `404` — a list that does not exist.
- `409` — a target name already taken.

`409` covers more than an identical file name. Create and rename refuse any name that [resolves](/list-resolution/#names-that-would-collide-are-refused-at-creation) to an existing list of the same type: `atraxa superfriends` is refused while `Atraxa Superfriends` exists, with `A deck named 'Atraxa Superfriends' already exists (it matches 'atraxa superfriends' under list-name folding).` Renaming a list to another spelling of its own name (a capitalization or punctuation fix) is not a collision. It succeeds and moves the file and its sidecars, even on a case-insensitive file system.

## Rename Deck

```
POST /api/deck/:slug/rename
```

Rename a deck. Rewrites the `# Title` heading and renames the `.md` together with every sidecar it has — see [List lifecycle responses](#list-lifecycle-responses).

**Request Body:**

```json
{
  "newName": "New Deck Name"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Renamed deck to 'New Deck Name'",
  "newSlug": "New Deck Name",
  "newFilePath": "/home/me/mtg/decks/New Deck Name.md",
  "oldFilePath": "/home/me/mtg/decks/My Commander Deck.md"
}
```

## Delete Deck

```
DELETE /api/deck/:slug
```

Delete a deck and every sidecar it has — see [List lifecycle responses](#list-lifecycle-responses).

**Request Body:**

```json
{
  "confirmName": "My Commander Deck"
}
```

`confirmName` must match the deck's `# Title` (its first H1) exactly; `400` otherwise.

**Response:**

```json
{
  "success": true,
  "message": "Deleted deck 'My Commander Deck'; its files are in .trash/2026-10-05T14-03-22Z-deck-My Commander Deck",
  "deletedFiles": [
    "/home/me/mtg/decks/My Commander Deck.md",
    "/home/me/mtg/decks/My Commander Deck.md.sha256"
  ],
  "trashDir": "/home/me/mtg/.trash/2026-10-05T14-03-22Z-deck-My Commander Deck"
}
```

## Load Deck

```
GET /api/deck/:slug?view=<full|cards|summary>&section=<name>&nameContains=<terms>&limit=<n>&offset=<n>
```

Load a deck at the depth `view` asks for. The same parameters apply to [Load Collection](#load-collection) and [Load Wanted List](#load-wanted-list).

### List load parameters

| Parameter      | Description                                                                                               | Required |
| -------------- | --------------------------------------------------------------------------------------------------------- | -------- |
| `view`         | `full` (default), `cards`, or `summary`. Anything else is a `400` naming the three                        | No       |
| `section`      | Exact `## Section` heading, case-sensitive. A section that does not exist yields no entries, not an error | No       |
| `nameContains` | Whitespace-separated name terms; every term must appear, in any order (as `/api/autocomplete` matches)    | No       |
| `limit`        | Max entries returned. A positive integer; anything else is a `400`                                        | No       |
| `offset`       | Entries to skip before `limit` applies. A non-negative integer (`0` is allowed)                           | No       |

`summary` and `cards` return **before** the changelog-name pass, the Scryfall card/printing/price load, and the mana-symbol fetch, so a filtered read is cheap for the server. `full` applies the filters and then loads card data for the filtered names only.

`totalCount` is always present: the number of entries that matched **before** `limit`/`offset` applied (the list's whole line count when nothing was filtered), so a client can page. `offset`/`limit` count lines, and a line is never split: a `4 Lightning Bolt` deck entry travels whole.

Any of `section`, `nameContains`, `limit`, or `offset` makes the body a **slice**: the response carries `"partial": true` and **no** `contentHash`, because only a full load shows the whole list a save's changes are replayed over. Reload without filters to get a hash you can save with. This applies to every view, `summary` included.

`warnings` is always present on all three views. It lists everything in the file a re-serializing write would not reproduce, as an array of [message triples](/admin/api/#the-message-triple) (empty for a clean file): the English `message`, plus `messageKey` and `messageParams`. A line the card-line grammar refused is located (`domain.card.line.atLine`, `{ line, text }`) with the grammar's own diagnostic nested as `text` (`domain.card.line.*` — for example `domain.card.line.unknownToken`, wrapped in `domain.card.line.withHint` when it suggests a fix):

- Body lines the parser could not read — malformed card lines, prose, comments, or any other text the list grammar does not model.
- One summary entry per file holding a [fenced code block](/list-format/#fenced-code-blocks) (`Fenced code block content (N lines) — …`). A fenced block parses cleanly, so it gets no per-line warning, but the serializers cannot emit it.
- Held deck lines (`domain.card.line.suspectQuantityInName`, located like a refused line): a deck line with no quantity whose name starts with four or more digits (`- 1234 Sol Ring`). It loads as one card of that whole name, but it may be 1,234 copies an earlier version wrote without the `x`, and the write would re-emit it as `- 1 1234 Sol Ring` for good. Only the user can settle it, by editing the file (`- 1234x Sol Ring` or `- 1 1234 Sol Ring`).

A deck's empty extras section (`## Maybeboard`, `## Tokens`) is deliberately **not** listed: it holds nothing to lose and the next write clears it.

**A non-empty `warnings` also blocks saving that list** — see [Unreadable lines block a save](#unreadable-lines-block-a-save).

A missing list is a `404` whose message points at `GET /api/lists` for the real slugs. A slug carrying a path separator is a `400` (`Invalid list slug`) on all three routes.

**Response (`view=full`, the default):**

```json
{
  "success": true,
  "view": "full",
  "deck": { "name": "...", "sections": [] },
  "totalCount": 42,
  "cards": { "Sol Ring": {} },
  "printings": { "Sol Ring": [] },
  "cardsCardKingdom": { "Sol Ring": {} },
  "symbolMap": { "{W}": "https://..." },
  "frontMatter": {},
  "slug": "my-deck",
  "contentHash": "...",
  "warnings": []
}
```

A `full` deck load also carries `lowestPriceCards`, `lowestPriceCardsEur` and `lowestPriceCardsTix`: the cheapest printing per card name, per currency.

`cardsCardKingdom` (and, on decks, `lowestPriceCardsCardKingdom`) is [Card Kingdom's own printing pick](/public-site/prices/#which-printing-a-card-is-priced-at) per card name — the printing CK sells, chosen at CK's prices — which a client shows instead of the Scryfall pick while the Card Kingdom price store is selected. Both are **sparse** (a card CK stocks no printing of has no entry; fall back to the Scryfall pick) and both are **absent entirely** unless [`priceSources`](/configuration/#price-stores-pricesources) includes `cardkingdom` and a buylist feed is cached. A load never downloads the feed.

**Response (`view=cards`):**

```json
{
  "success": true,
  "slug": "my-deck",
  "view": "cards",
  "deck": { "name": "...", "sections": [] },
  "frontMatter": {},
  "totalCount": 42,
  "contentHash": "...",
  "warnings": []
}
```

A deck's `cards` view also returns its front matter. A collection or wanted list returns `entries` + `sectionOrder` instead, plus a top-level `description` (the list's front-matter blurb, absent when none is declared; a deck's is inside `deck.description`). Per-card fields:

- `labels` — a deck and a collection carry a top-level `labels` (the list's [front-matter default](/list-format/#card-labels); a deck's can only be `proxy`), and each of their cards may carry its own signed `labels` override (`["no-proxy"]`), which adjusts that default. Every deck card and collection entry also carries `effectiveLabels`: the labels in force, resolved by the server.
- `tags` — every card on every list type carries `tags` when its line has any: its [tags](/list-format/#card-tags) in canonical order (trimmed, sorted, without the `#`). There is no list-level tag default.

A narrowed request replaces `contentHash` with `"partial": true`.

**Custom art.** Every non-summary load carries `customArt` when the list has any: a `{ "<cardId>": { "file": … } | { "url": … } }` record of the **raw** [custom art](/custom-art/) references for the cards in the body. Clients derive display URLs themselves, since an editor needs the path the user typed. Omitted when none of the returned cards has art.

Problems with the `.art.json` sidecar — it cannot be read, or it holds art under a card id the **whole** list no longer has — come back in a separate `artWarnings` array rather than failing the load. Unlike `warnings`, they never [block a save](#unreadable-lines-block-a-save). `artWarnings` is omitted when the sidecar is clean or absent. The orphan check ignores the filters, so a paged read never reports cards it did not ask for.

**Categories.** Every non-summary load carries the list's [categories](/list-format/#categories-namecategoriesjson) when it has any, as `categories` — `{ "order": ["Ramp", "Artifacts"], "cards": { "Sol Ring": ["Ramp", "Artifacts"] } }` — and every returned card carries its own resolved `categories`, primary first. **Absent means none at both levels**: never an empty array. `order` is the resolved order the next Ritual write persists. `categories` always describes the **whole list**, never just the returned page: a filtered read still reports every categorized name, while each card's own `categories` covers only the cards in the body.

Keys in `cards` are card names as the sidecar stores them, matched case- and whitespace-insensitively. Read each card's own `categories` field rather than joining `cards` by raw name, or you will miss entries the list still resolves.

Problems with the `.categories.json` sidecar — it cannot be read, or it records categories for names the list no longer holds — come back in a separate `categoryWarnings` array, like `artWarnings`. A read reports stale names and never removes them; the next save prunes them. The stale-name check is skipped when the list has unreadable lines, since those lines may still hold the named cards.

A `view=summary` body carries neither `categories` nor `categoryWarnings`: it returns before the sidecar is read.

**Response (`view=summary`):**

```json
{
  "success": true,
  "slug": "my-deck",
  "view": "summary",
  "counts": {
    "entryCount": 42,
    "cardCount": 99,
    "sections": [{ "name": "Commander", "entryCount": 1, "cardCount": 1 }]
  },
  "contentHash": "...",
  "warnings": []
}
```

`entryCount` is lines, `cardCount` is copies (summed quantity). Collections and wanted lists hold one card per line, so the two are equal there. A summary honours `section`/`nameContains` and ignores `limit`/`offset`: the counts describe the whole filtered set. A narrowed summary is `"partial": true` with no `contentHash`, like every other narrowed view.

## Save a List

```
POST /api/deck/:slug/save
POST /api/collection/:slug/save
POST /api/wanted/:slug/save
```

Save an editing session: the request carries **only the changes**, never the list. The route reads the file, replays the changes over it with the same rules the editors apply, and writes the result plus a changelog entry. A save therefore scales with the edit rather than the list, and a client cannot write content its changes do not describe.

What the route takes from the file rather than the request:

- **Front matter** is never taken from the request (edit it with [List Metadata](#list-metadata)). A collection or wanted list keeps its block byte for byte. A deck's is re-written in canonical form: a known field of the wrong type is dropped, and an inferred format is made explicit. A deck whose front matter is not readable YAML is a `400`, rather than a write that would drop it.
- **The title** (a deck's name, a flat list's `# Title`), or the file's name when it has none, as the load route reports it.
- **Section order**: the file's order with the session's `add-section` / `rename-section` / `remove-section` changes replayed over it, so a section the session added survives the write while still empty.

**Request Body:**

```json
{
  "changes": [{ "action": "add", "cardName": "Sol Ring", "set": "c21", "collectorNumber": "263" }],
  "contentHash": "…",
  "continueSession": false,
  "validateCardNames": false
}
```

- `changes` are [change events](/list-format/#the-changesmd-changelog) without the `id` / `timestamp` envelope; the route stamps its own, and ignores any a client sends. At most 50,000 per save.
- `contentHash` is required: the hash the [load](#load-deck) returned. A file that changed since is a `409` with `conflict: true`; reload and retry. A filtered or paged load has no hash, because only a full load shows the whole list.
- `continueSession` (optional boolean) merges this save into the previous save's changelog entry, bumping its timestamp, instead of opening a new one. The editor sets it on every save after the first within an editing session.
- [`validateCardNames`](#validatecardnames) (optional boolean) checks every named card against the card cache.

**Validation.** Each change is decoded with the same rules the changelog and [change bundles](/admin/api/imports/#import-changes) use, before the file is read. Any failure is a `400` naming the change (`changes[2] has an invalid "set".`), and nothing is written. A decode refusal is keyed `domain.changes.problem.*`, with the change it names nested as the `subject` param (see [the message triple](/admin/api/#the-message-triple)). Two checks answer differently: a line break is refused first, keyed `admin.api.save.lineBreak` with the JSON path as `field` (see [Line breaks](#line-breaks)), and a collection change missing its printing names the card, keyed `domain.changes.collectionPrinting.add` or `.setPrinting` with a flat `name`:

- Actions, finishes, conditions, boards and [languages](/list-format/#card-language) must be known values. A `set-language` change requires its `language`.
- Labels are signed (`["trade", "no-sale"]`; see [Card labels](/list-format/#card-labels)) and must be ones the list type carries: `proxy`/`no-proxy` alone on a deck, none on a wanted list. The `keep`/`proxy` exclusivity rule applies, and no label may be both set and negated. A `move-from`/`move-to` is the exception: its `labels` describe the moving copy as its source states them, so only the vocabulary and the conflict rules are checked, and the destination lands them on arrival.
- Tags must be [tag-shaped](/list-format/#card-tags) and are canonicalized (trimmed, single-spaced, deduplicated, sorted). Category names must be [category-shaped](/list-format/#categories-namecategoriesjson); a `set-categories` list keeps its order (the first is the primary category), and an empty one clears.
- No string may contain a line break (see [Line breaks](#line-breaks)).
- A collection change that adds a line (`add`, `move-to`, `set-printing`) must carry a printing.

**Card ids.** A change need not carry an `&N`: the route gives each new line its id as it replays the batch, in apply order, and writes it onto the event, so the changelog records the id the line got.

- An `add` or `move-to` with no `cardId` takes the smallest id free at that point. A line removed earlier in the same batch (a `remove`, a `move-from`, a deck line's last copy) has already released its id.
- A deck copy that merges onto a line the deck already has takes that line's id and draws none.
- A `cardId` the list does not hold is kept, as an editor that allocated it expects, and an id-less add never takes an id a later change in the batch names. On a collection or wanted list, a `cardId` naming a line the list already holds would duplicate it, so the new entry gets a free id instead.
- A `cardId`, `sourceCardId` or `replacesCardId` that is not a positive integer is a `400` like any other decode refusal (`changes[0] has an invalid "cardId".`), and an `add` / `move-to` id beyond the list's highest id plus one per change in the batch is a `400` keyed `admin.api.save.idPastCeiling`.

**All or nothing.** A change that does not apply to the list as it stands (its card is not there, or it needs a printing pinned first) refuses the whole batch with a `400`. The body names each change that missed in an `unmatched` array (each described in English, followed by its reason in parentheses: `no-target`, `not-applicable` or `needs-printing`), and nothing is written. Its `message` (`1 change matched no card in deck "burn": "Add Sol Ring &3" — card names match exactly (case-sensitive). Nothing was saved.`) is keyed `domain.changes.unmatched.summary`, and its params nest: each reason, and each change description inside it, is a message of its own, so the editor shows the whole refusal in the reader's language. A save never reports success while dropping changes.

**Cross-list moves** in `changes` write the other list too, each with its own changelog entry:

- A `move-from {to}` adds the copy to its destination. The copy keeps the event's `tags` and `note`, and its `labels` (the copy's labels as this list states them) land by the [move rule](/commands/move/): a proxy stays a proxy and a real card real wherever both types carry `proxy`, a stated label keeps its state, an unstated one takes the destination's default, as far as the destination type accepts (`proxy` into a deck, all of them into a collection, none into a wanted list), written as the smallest override that says so. On a deck, the copy merges onto a line whose effective labels, printing and tags match, only within the `section` the move names (any section when it names none). A copy that merges onto a deck line with a different note keeps the line's note, and the dropped one is reported in `droppedNotes`.
- A `move-to {from}` (an incoming move) takes the copy out of its source: by the `sourceCardId` line when it still holds the card, else by printing, else by name for a printing-less source line. Each fallback prefers a line whose effective labels equal the move's positive `labels`, so a `[proxy]` copy leaves from the proxy line. The copy lands here with its labels written against this list's default, and a merge onto a deck line with a different note is reported in `droppedNotes` too.
- A `move-to` carrying `replacesCardId` pins one of this list's own name-only lines rather than adding a copy. When it equals the move's `cardId`, the line is converted in place — on a deck only when the copy's labels, landed against the deck default, equal the line's effective labels (`proxy` is a fact a pin never changes); an in-place pin that fails this is refused. Otherwise one copy leaves that line and lands on `cardId` as a normal arrival, with its own labels, tags and note.
- A `move-to` that pins a line (`replacesCardId`) may also carry `replacement` (`{ set, collectorNumber, finish?, language? }`): that printing is added to the source list in place of the copy taken, logged there as an `Added` line. A `replacement` without `replacesCardId` is a `400`.

Every move is validated in memory before anything is written. A missing list, a source with no copy to take, or a printing-less card headed into a collection fails the save with nothing written.

**Response:**

```json
{
  "success": true,
  "message": "Saved 3 changes to My Collection",
  "contentHash": "…",
  "droppedNotes": [],
  "effects": [
    {
      "action": "added",
      "cardId": 7,
      "name": "Sol Ring",
      "section": "Main",
      "quantity": 1,
      "printing": { "set": "c21", "collectorNumber": "167" }
    }
  ]
}
```

See [`effects`](#effects) for what the array reports.

### Unreadable lines block a save

All three save routes parse the file on disk before applying anything, and refuse with `400` when that parse yields any [`warnings`](#load-deck). A line the parser cannot read, or a [fenced code block](/list-format/#fenced-code-blocks), is content the re-serializing write would delete, releasing any `&N` ids it held back into the reuse pool. The message names the file and each entry. Nothing is written. Fix the line, or remove the fenced block, and retry; `GET /api/{type}/:slug` reports the same list in its `warnings` field. A held deck line refuses the save the same way, with its own message (`messageKey: domain.list.rewriteHold`, `action: saving`): nothing would be deleted, but the write would change what the line means. When a file holds both, the refusal says both. MCP mutations surface the same refusal as a tool error.

### Line breaks

Card names, printings, sections, and list names are written into single-line card lines, headings, and changelog entries, so none of them may contain a line break (newline, carriage return, vertical tab, form feed, NEL, or U+2028/U+2029). The [save route](#save-a-list) checks every string in `changes`, and [Move Selected Cards](/admin/api/cards/#move-selected-cards) and `POST /api/move/commit` check their `moves`. A line break anywhere in those is a `400` with `messageKey: admin.api.save.lineBreak` naming the JSON path, such as `changes[2].cardName` or `moves[0].cardName`. A save's notes are trimmed first, so a pasted trailing newline on a note is not refused. Nothing is written. [Import changes](/admin/api/imports/#import-changes) refuses a bundle carrying one the same way. MCP mutations surface the refusal as a tool error.

### `validateCardNames`

The save routes and the [Move Selected Cards](/admin/api/cards/#move-selected-cards) / [Remove Cards](/admin/api/cards/#remove-cards) routes accept an optional boolean `validateCardNames`, default `false`. It is validated, never coerced: any non-boolean value is a `400`.

With it set, every card name the request mentions is checked against the local Scryfall card cache before anything is written:

- A name **already present in the affected list** is accepted with no lookup, so a custom, proxied, or unreleased card stays removable and editable.
- Any other name must be one the cache knows. An unknown one is a `400` naming up to three of the closest cached spellings.
- An **empty** cache is also a `400` (not a `503` as on [Price List](/admin/api/prices/#price-list)), naming both remedies: the MCP `refresh_cache` tool, or `ritual cache preload-all`.

The admin UI leaves it off. The MCP write tools set it on every request, except the import tools, whose engines report per-row failures.

### `effects`

The [save route](#save-a-list) answers with an `effects` array describing what the save did to individual card lines, and a `contentHash` for the next save. Each entry is `{ action, cardId, name, section?, quantity, printing?, previousCardId? }`, where `action` is `added`, `removed`, or `updated`.

`previousCardId` appears only on an `updated` effect whose line was **renumbered**: another entry in the same save claimed its `&N` (a cross-list move carrying its source id, a replayed change bundle), so the serializer gave the older line a fresh number.

A card's `&N` id is allocated inside the save (see [Save a List](#save-a-list)), so the response is the **only** place a client that added a card without one can learn the id its line got. Set codes inside `printing` are lowercase.

A save also re-files the list's [custom-art](/custom-art/) sidecar from the **changes**, not from the file it produced: a card the changes remove loses its art even when they re-add the same card and the new line takes the same `&N` back. To put art on a card you are adding, wait for the save to answer, then aim a [Card Art](#card-art) write at the id the effects report (following `previousCardId` where a line was renumbered). The admin editors' [add-card dialog](/admin/editors/#card-options) does this.

### `artWarnings`

When that re-filing could not happen, the save still succeeds and reports the problem in an **`artWarnings`** array, one message per sidecar it had to leave alone. Causes:

- The list's own `.art.json` cannot be read.
- The `.art.json` of a list this save's cross-list moves ([**Move to list…**](/admin/editors/#custom-art), [**Swap Printings…**](/admin/editors/#swap-printings)) send cards to or take them from cannot be read.
- A moved copy's art has no destination line to follow onto.

The field is omitted when everything re-filed cleanly, and shares its name with the load routes' [sidecar problems](#load-deck) channel.

The card lines were written correctly; the only casualty is that art may now sit under an `&N` the save freed or renumbered. Fix the sidecar by hand (the message names the file and the parse failure) and the art applies again, or comes off the list with the next art write.

### `categoryWarnings` and `prunedCategories`

A save also commits the list's [categories sidecar](/list-format/#categories-namecategoriesjson). The sidecar is keyed by card **name**, so the save is what tells it which entries no card backs any more:

| Field              | Type       | Meaning                                                                                                        |
| ------------------ | ---------- | -------------------------------------------------------------------------------------------------------------- |
| `categoryWarnings` | `string[]` | The categories sidecar could not be read or written. A warning, never a failure — the card lines were written. |
| `prunedCategories` | `string[]` | Card names whose category assignments this save dropped, because the list no longer holds a line of that name. |

Both are omitted when there is nothing to report. A save that carries no category change and prunes nothing leaves the sidecar byte-identical, including a hand-edited one, whose stale `.sha256` survives so [`detect-changes`](/commands/detect-changes/) still records the edit.

## List Collections

```
GET /api/collections
```

Returns the available collections.

**Response:**

```json
{
  "success": true,
  "collections": ["my-collection", "trade-binder"]
}
```

## Load Collection

```
GET /api/collection/:slug
```

Load a collection with full card data, printings, and mana symbol map. Accepts the same [list load parameters](#list-load-parameters) as [Load Deck](#load-deck); the `cards` view returns `entries` + `sectionOrder` rather than a deck.

- Top-level `description` — the collection's front-matter blurb, absent when none is declared.
- Top-level `labels` — its [default card labels](/list-format/#default-labels-and-descriptions), absent when none are declared. An entry's own `labels` is its per-card override, signed (`["trade", "no-sale"]`); its effective labels are the default adjusted by it: the positives added, the negated labels taken away. Each entry also carries `effectiveLabels`, those labels resolved by the server (empty when it has none), so a client never re-implements the rule.
- Entry `tags` — the line's [tags](/list-format/#card-tags), canonical and without the `#`, absent when it has none.
- Entry `categories` — the card name's [categories](/list-format/#categories-namecategoriesjson) in this list, primary first, absent when it has none. The list's own vocabulary is the top-level `categories` — see [Load Deck](#load-deck).

**Response:**

```json
{
  "success": true,
  "view": "full",
  "entries": [
    {
      "name": "Sol Ring",
      "set": "2xm",
      "collectorNumber": "270",
      "labels": ["keep"],
      "effectiveLabels": ["keep"],
      "tags": ["Binder: Trade", "Ramp"],
      "cardId": 1
    }
  ],
  "sectionOrder": ["Main"],
  "description": "Everything I will trade away.",
  "labels": ["sale", "trade"],
  "totalCount": 42,
  "cards": { "Sol Ring": {} },
  "printings": { "Sol Ring": [] },
  "symbolMap": { "{W}": "https://..." },
  "slug": "my-collection",
  "contentHash": "...",
  "warnings": []
}
```

## Create Collection

```
POST /api/collection/create
```

Create a new collection file, named after the collection — see [List file names](/commands/new/#list-file-names).

**Request Body:**

```json
{
  "name": "My Collection"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Created collection 'My Collection'",
  "slug": "My Collection"
}
```

## Rename Collection

```
POST /api/collection/:slug/rename
```

Rename a collection. Replaces the first `# <Title>` line in the file and renames the `.md` together with every sidecar it has — see [List lifecycle responses](#list-lifecycle-responses).

**Request Body:**

```json
{
  "newName": "Renamed Collection"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Renamed collection to 'Renamed Collection'",
  "newSlug": "Renamed Collection",
  "newFilePath": "collections/Renamed Collection.md",
  "oldFilePath": "collections/My Collection.md"
}
```

## Delete Collection

```
DELETE /api/collection/:slug
```

Delete a collection file and every sidecar it has — see [List lifecycle responses](#list-lifecycle-responses). `confirmName` must match the parsed `# Title` exactly.

**Request Body:**

```json
{
  "confirmName": "My Collection"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Deleted collection 'My Collection'; its files are in .trash/2026-10-05T14-03-22Z-collection-My Collection",
  "deletedFiles": [
    "/home/me/mtg/collections/My Collection.md",
    "/home/me/mtg/collections/My Collection.md.sha256"
  ],
  "trashDir": "/home/me/mtg/.trash/2026-10-05T14-03-22Z-collection-My Collection"
}
```

## List Wanted Lists

```
GET /api/wanted
```

Returns the available wanted lists.

**Response:**

```json
{
  "wantedLists": [{ "slug": "high-priority", "name": "High Priority" }]
}
```

## Load Wanted List

```
GET /api/wanted/:slug
```

Load a wanted list with full card data, printings, and mana symbol map. Accepts the same [list load parameters](#list-load-parameters) as [Load Deck](#load-deck); the `cards` view returns `entries` + `sectionOrder` rather than a deck, plus the top-level `description` when the list declares one.

- Entry `tags` — the line's [tags](/list-format/#card-tags), canonical and without the `#`, absent when it has none. Wanted entries carry tags exactly as deck and collection cards do; they are the one list type without `labels`.
- Entry `categories` — the card name's [categories](/list-format/#categories-namecategoriesjson) in this list, primary first, absent when it has none. The list's own vocabulary is the top-level `categories` — see [Load Deck](#load-deck).

**Response:**

```json
{
  "success": true,
  "view": "full",
  "entries": [
    { "name": "Sol Ring", "set": "2xm", "collectorNumber": "270", "tags": ["Ramp"], "cardId": 1 }
  ],
  "sectionOrder": ["Main"],
  "description": "Cards I still need.",
  "totalCount": 42,
  "cards": { "Sol Ring": {} },
  "printings": { "Sol Ring": [] },
  "symbolMap": { "{W}": "https://..." },
  "slug": "high-priority",
  "contentHash": "...",
  "warnings": []
}
```

## Create Wanted List

```
POST /api/wanted/create
```

Create a new wanted list file, named after the list — see [List file names](/commands/new/#list-file-names).

**Request Body:**

```json
{
  "name": "Holiday Wishlist"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Created wanted list 'Holiday Wishlist'",
  "slug": "Holiday Wishlist"
}
```

## Rename Wanted List

```
POST /api/wanted/:slug/rename
```

Rename a wanted list. Replaces the first `# <Title>` line in the file and renames the `.md` together with every sidecar it has — see [List lifecycle responses](#list-lifecycle-responses).

**Request Body:**

```json
{
  "newName": "Renamed Wishlist"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Renamed wanted list to 'Renamed Wishlist'",
  "newSlug": "Renamed Wishlist",
  "newFilePath": "wanted/Renamed Wishlist.md",
  "oldFilePath": "wanted/Holiday Wishlist.md"
}
```

## Delete Wanted List

```
DELETE /api/wanted/:slug
```

Delete a wanted list file and every sidecar it has — see [List lifecycle responses](#list-lifecycle-responses). `confirmName` must match the parsed `# Title` exactly.

**Request Body:**

```json
{
  "confirmName": "Holiday Wishlist"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Deleted wanted list 'Holiday Wishlist'; its files are in .trash/2026-10-05T14-03-22Z-wanted-Holiday Wishlist",
  "deletedFiles": [
    "/home/me/mtg/wanted/Holiday Wishlist.md",
    "/home/me/mtg/wanted/Holiday Wishlist.md.sha256"
  ],
  "trashDir": "/home/me/mtg/.trash/2026-10-05T14-03-22Z-wanted-Holiday Wishlist"
}
```

## List Metadata

```
PUT /api/metadata/:type/:slug
```

Write a list's YAML front matter. Decks take the deck vocabulary below; decks and collections take `labels` (their [default card labels](/list-format/#card-labels)); **all three types** take `description` (the blurb the built site prints above the cards) and `image` (the list's [cover image](/list-images/)). Those two are the only fields a wanted list accepts; a `labels` key on a wanted body is a `400` naming the field. Shares its engine with the [`metadata`](/commands/metadata/) CLI command (which covers all three types and does not write `image`), [`set-list-image`](/commands/set-list-image/), and the MCP `set_list_metadata` tool.

Only the fields present in the body are written; every other front-matter key (including user-authored ones) round-trips untouched. A field sent as `null` is deleted, as is a `description` sent as an empty string. The markdown body below the front matter is left byte for byte as it was: card lines are never re-serialized and no card IDs are assigned. **No changelog entry is written**, since metadata is not a card change.

**Request Body (deck):**

```json
{
  "description": "A ramp deck.",
  "tags": ["ramp", "budget"],
  "format": "commander",
  "image": { "card": 12 },
  "sourceId": "123456",
  "sourceUrl": "https://archidekt.com/decks/123456",
  "contentHash": "abc123..."
}
```

**Request Body (collection):**

```json
{
  "description": "Everything I will trade away.",
  "labels": ["sale", "trade"],
  "image": { "card": 12 },
  "contentHash": "abc123..."
}
```

**Request Body (wanted list):**

```json
{
  "description": "Cards I still need.",
  "image": { "url": "https://example.com/cover.jpg" },
  "contentHash": "abc123..."
}
```

| Field         | Validation                                                                                                                                                                                                                                                     |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `description` | All three types. String (trimmed) or `null`; an empty (or blank) string clears it                                                                                                                                                                              |
| `tags`        | Deck only. Array of non-empty strings (trimmed, deduplicated, order preserved); `null` or `[]` clears the key                                                                                                                                                  |
| `format`      | Deck only. A [deck format](/commands/new/#deck-format) name, canonicalized (`EDH` → `commander`); `null` clears it and the deck falls back to section inference                                                                                                |
| `sourceId`    | Deck only. Non-empty string or `null`                                                                                                                                                                                                                          |
| `sourceUrl`   | Deck only. An `http`/`https` URL or `null`                                                                                                                                                                                                                     |
| `labels`      | Deck and collection. Array of `sale`/`trade` (combinable) or `keep`/`proxy` (each alone), case-insensitive, normalized to canonical order; a **deck** accepts `proxy` alone. A default is positive only (`no-…` is refused). `null` or `[]` clears the default |
| `image`       | All three types. A single-key mapping — `{"card": N}`, `{"file": "rel/path"}` or `{"url": "https://…"}` — or `null` to clear it. Scalars are rejected. See below                                                                                               |
| `contentHash` | Optional concurrency token from the list's load route; a non-string value is a `400`                                                                                                                                                                           |

Rejected fields, each a `400`:

- `name` — the message points at [`POST /api/deck/:slug/rename`](#rename-deck), which also renames the file and its sidecars.
- `created` and `lastSynced` — stamped by Ritual (deck creation and [deck sync](/commands/deck-sync/)).
- Any unknown field. A deck-only field on a collection (and vice versa) is an unknown field.

A flat-list (collection or wanted) write refuses with `400` when the file's existing front matter cannot be read as a YAML mapping, since merging over keys it cannot see would clobber them.

`image` is validated as the front-matter grammar is (see [List cover images](/list-images/)), with one addition: a `{"card": N}` reference is checked against the file being written, so an `&N` the list does not carry is a `400` naming the raw id, and nothing is written. A `{"file": …}` path is checked for shape only (the image need not exist yet; a missing one is a build-time warning), and a `{"url": …}` is never fetched.

Setting `sourceId` together with an `archidekt.com` `sourceUrl` makes a deck sync-linked, so these fields change which decks [`POST /api/deck-sync`](/admin/api/sync/#sync-decks) operates on. The two must name the **same** Archidekt deck once merged over what the file already carries: a sync addresses the deck by `sourceId` while every surface shows `sourceUrl`, so a mismatched pair would push one deck's cards into another. A request that produces one is a `400` (`sourceUrl names Archidekt deck 999 but sourceId is 123. …`) and writes nothing. A `sourceUrl` on another service is not constrained.

When `contentHash` is supplied and no longer matches the file, the response is `409` with `"conflict": true`, the same optimistic-concurrency contract as the editor save routes. Omit it for a plain read-modify-write. The write updates the file's hash, so an editor that had the deck open sees a conflict on its next save rather than silently clobbering the new metadata.

**Response:**

```json
{
  "success": true,
  "slug": "my-deck",
  "frontMatter": {
    "name": "My Deck",
    "format": "commander",
    "created": "2026-01-01T00:00:00.000Z",
    "description": "A ramp deck.",
    "tags": ["ramp", "budget"],
    "image": { "card": 12 }
  },
  "contentHash": "def456..."
}
```

An unknown deck is a `404`.

When git auto-commit is enabled, the deck file and its `.sha256` hash sidecar are committed with the message `Update metadata for deck <slug>`.

## Card Art

```
PUT /api/art/:type/:slug
```

Set or clear one card's [custom art](/custom-art/) on any list type. Like the metadata route this is a **direct** write: no change event, no changelog entry, and **no `contentHash` round trip**. Card lines and the `<list>.art.json` sidecar are separate files, so the write is safe alongside an editor's pending card edits.

**Request Body:**

```json
{ "cardId": 5, "art": { "file": "proxies/sol-ring.jpg" } }
```

| Field    | Validation                                                                                                                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cardId` | Required. A card line's `&N` id (a positive integer) that the list actually holds                                                                                                                                                          |
| `art`    | Required. `{ "file": "<art-dir-relative path>" }` (ending in `.avif`/`.gif`/`.jpeg`/`.jpg`/`.png`/`.webp`), `{ "url": "<http(s) URL>" }`, or `null` to clear the card's art. Exactly one of `file`/`url`, and no other key, may be present |

Any other field is a `400` naming it.

The save, move, and remove routes re-file this sidecar themselves — see [Art follows the card](/custom-art/#art-follows-the-card):

- A save or removal that drops a card drops its art, even when the same save re-adds that card.
- A renumbered line takes its entry with it.
- A cross-list move carries the entry to the destination list's sidecar under the new line's `&N`. A copy that merges onto a line the destination already had keeps that line's own art.

The sidecars land in the same auto-commit as the list files they describe.

**Response:**

```json
{
  "success": true,
  "slug": "my-deck",
  "cardId": 5,
  "art": { "file": "proxies/sol-ring.jpg" },
  "message": "Set custom art on 'my-deck'"
}
```

Refusals are `400` for:

- a malformed body;
- a `cardId` the list does not hold (for a card an editing session added but has not saved, save first and use the id the save's [`effects`](#effects) report);
- a reference that does not parse: a backslash, an absolute path, a `..` escape, a `file` whose extension is not one the art route serves, a non-`http(s)` URL;
- a `file` with no image behind it in the configured art directory (the message names the exact path checked);
- an existing `.art.json` that cannot be read. The route refuses rather than overwrite it, since that would erase art for cards the request never mentioned.

Each refusal is keyed (see [Error responses](/admin/api/#error-responses)). A reference the grammar refuses carries its own `domain.list.art.*` key; an unreadable `.art.json` answers `domain.list.sidecar.problem`, whose `file` is the sidecar's path and whose `reason` nests the parse problem (`domain.list.sidecar.invalidJson`, `domain.list.art.sidecarBadEntry` with the entry's own refusal nested again, …).

An unknown list is a `404`.

Clearing the last card's art removes the sidecar rather than writing `{}`. When git auto-commit is enabled the sidecar is committed with the message `Update custom art for <type> <slug>`, but only when a file was actually written or removed.

The images themselves are served read-only, behind the same login, at `GET /art/<relpath>` from the configured [`artDir`](/configuration/#directory-options), which lets the editor preview a local file. Only `.avif`, `.gif`, `.jpeg`, `.jpg`, `.png`, and `.webp` are served (the same allowlist a `file` reference is validated against), and any path leaving the art directory is a `404`. That `404`'s body is `{"error": "Not found", "errorKey": "admin.api.server.notFound"}`: the English under `error`, its key beside it.

## Diff Lists

```
GET /api/diff?a=<[type:]name>&b=<[type:]name>&by=<name|printing>
```

Compare two lists (any mix of deck, collection, and wanted list) and return the matched identities with per-side quantities plus the entries only one side has. Exposed as the MCP `diff_lists` tool; shares its engine with the [`diff`](/commands/diff/) CLI command — see that page for the identity rules (nonfoil folding, the no-printing bucket, all sections included).

**Query Parameters:**

| Parameter | Description                                                                                          | Required |
| --------- | ---------------------------------------------------------------------------------------------------- | -------- |
| `a`       | First list, resolved like CLI list arguments; a `deck:`/`collection:`/`wanted:` prefix pins the type | Yes      |
| `b`       | Second list, same form as `a`                                                                        | Yes      |
| `by`      | Identity to compare by: `name` (default) or `printing`                                               | No       |

A missing `a`/`b`, an invalid `by`, or a name that resolves to no list (or ambiguously) returns `400`.

**Response:**

```json
{
  "success": true,
  "a": { "listType": "deck", "slug": "burn", "name": "Burn" },
  "b": { "listType": "collection", "slug": "binder", "name": "Binder" },
  "by": "name",
  "matches": [
    {
      "name": "Lightning Bolt",
      "a": {
        "quantity": 2,
        "printings": [
          { "set": "lea", "collectorNumber": "161", "finish": "nonfoil", "quantity": 2 }
        ]
      },
      "b": {
        "quantity": 1,
        "printings": [
          { "set": "lea", "collectorNumber": "161", "finish": "nonfoil", "quantity": 1 }
        ]
      }
    }
  ],
  "onlyInA": [
    {
      "name": "Fireblast",
      "quantity": 1,
      "printings": [{ "set": "vis", "collectorNumber": "78", "finish": "foil", "quantity": 1 }]
    }
  ],
  "onlyInB": [],
  "warnings": []
}
```

`matches` includes identities whose quantities are equal on both sides; clients decide what counts as interesting. `warnings` carries list parse warnings from either side, and names a list's [`.categories.json` sidecar](/list-format/#categories-namecategoriesjson) that could not be read (the diff still runs). Each entry is a [message triple](/admin/api/#the-message-triple): `domain.export.warning.inList`, whose `list` names the list and whose `warning` nests the parser's own message.

## Load Change History

```
GET /api/history/:type/:slug
```

Returns the parsed change sets of a list's change log (newest first) plus the typed change events a "rewrite with defaults" would produce. `:type` is `deck`, `collection`, or `wanted`.

- Each set carries its prose `lines` and its `events`: the typed events from the entry's [`ritual-changes` block](/list-format/#the-changesmd-changelog), one per line in the same order (empty for a legacy entry with no block).
- The list file and its [`.categories.json` sidecar](/list-format/#categories-namecategoriesjson) are read only to derive `defaultEvents`. A list with no change log yet returns an empty `sets` array.
- A sidecar that exists but cannot be read contributes no category events and is reported in a `categoryWarnings` array (absent otherwise).
- A set followed by hand-written non-change text carries it in a `trailing` array (absent otherwise). The text survives an edit-and-save round trip: each line is kept as written and re-emitted after the set's change lines; blank lines between them are not kept.

**Response:**

```json
{
  "success": true,
  "header": "# Changelog for My Deck",
  "sets": [
    {
      "timestamp": "2026-05-29T12:00:00.000Z",
      "lines": ["- Added \"Sol Ring\" (LEA:1) &1"],
      "events": [
        {
          "action": "add",
          "cardName": "Sol Ring",
          "cardId": 1,
          "set": "lea",
          "collectorNumber": "1"
        }
      ],
      "trailing": ["NOTE TO SELF: the FNM tuning session."]
    }
  ],
  "defaultEvents": [
    { "action": "add", "cardName": "Sol Ring", "cardId": 1, "set": "lea", "collectorNumber": "1" }
  ]
}
```

## Save Change History

```
POST /api/history/:type/:slug/save
```

Overwrite the list's change log with the supplied change sets. Each set needs:

- a valid ISO-8601 `timestamp`;
- a `lines` array of strings, each starting with `- `;
- an `events` array of typed change events, one per line in the same order, echoed back from `GET` (empty only for a legacy set that had none). An event that does not decode is a `400` naming it (`Set #1 event #2 is missing its "id".`), keyed `domain.changes.problem.*` with the event nested as its `subject`.
- optionally a `trailing` array of preserved hand-written lines. These must **not** start with `- ` or `## ` (they would be re-parsed as change lines or set headers on the next load) and are written back verbatim after the set's change lines.

Only the `.changes.md` file is written; the list's own `.md` is never touched, and the existing header is preserved. When git auto-commit is enabled, the change log is committed (`Rewrite change history for <slug>`).

**Request Body:**

```json
{
  "sets": [
    {
      "timestamp": "2026-05-29T12:00:00.000Z",
      "lines": ["- Added \"Sol Ring\" (LEA:1) &1"],
      "events": [
        {
          "action": "add",
          "cardName": "Sol Ring",
          "cardId": 1,
          "set": "lea",
          "collectorNumber": "1"
        }
      ]
    }
  ]
}
```

**Response:**

```json
{
  "success": true,
  "message": "Saved 1 change set.",
  "setCount": 1
}
```
