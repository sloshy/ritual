---
title: 'metadata'
---

Inspect and modify a list's front-matter metadata from scripts, mirroring [`config`](/commands/config/)'s subcommand shape: `set`, `get`, `list`, and `unset`.

Decks take `description`, `tags`, `format`, `labels`, `sourceId`, and `sourceUrl`; collections take `labels` (their [default card labels](/commands/edit/#collection-front-matter)). Wanted lists define no front-matter keys, so every subcommand refuses them with a usage error. Writes go through the same engine as the admin [List Metadata](/admin/api/#list-metadata) route and the MCP `set_list_metadata` tool, so validation and the body-preserving write live exactly once: card lines — `&N` ids, label overrides, notes — survive byte for byte, and only the front-matter block is re-dumped (comments and quoting style are not preserved, though every key and value is).

## Usage

```bash
./ritual metadata set [listName] <property> <value...> [--add | --remove]
./ritual metadata get [listName] <property>
./ritual metadata list [listName]
./ritual metadata unset [listName] <property>
```

`[listName]` is resolved with the shared [List Resolution](/commands/list-resolution/) rules across all three list types — a wanted list that matches is then refused, since it has no metadata. Pass `--deck` or `--collection` to pin the type or disambiguate. When the name is omitted, an interactive picker opens ([prompts permitting](/#when-prompts-are-unavailable)), offering only decks and collections.

### Options

Every subcommand takes:

| Flag                | Description                                                        |
| ------------------- | ------------------------------------------------------------------ |
| `--deck`            | Resolve the name as a deck                                         |
| `--collection`      | Resolve the name as a collection                                   |
| `--wanted`          | Registered for symmetry; always a usage error (no wanted metadata) |
| `--output <format>` | Output format: `text` (default), `json`, or `ndjson`               |
| `--quiet`           | Suppress non-essential text output (`get` still prints its value)  |

`set` additionally takes `--add` / `--remove` (mutually exclusive) to merge values into an array property (`tags`, `labels`) instead of replacing it.

None of the subcommands ever prompts once a list name is given, so they are safe under `--no-input`.

## Properties

| List type  | Property      | Value                                                                                                                                                                                                                                                                                                                                                    |
| ---------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| deck       | `description` | Free text; values are joined with spaces, so quoting the whole description is optional. Empty clears it.                                                                                                                                                                                                                                                 |
| deck       | `tags`        | One tag per argument (commas inside an argument split too). `--add` appends to the current tags, `--remove` drops from them; otherwise values replace. Removing the last tag clears the key.                                                                                                                                                             |
| deck       | `format`      | A [deck format key](/commands/new/#deck-format) (e.g. `commander`, `modern`); exactly one value.                                                                                                                                                                                                                                                         |
| deck       | `labels`      | Default card labels for the deck — [`proxy`](/commands/edit/#card-labels) is the only label a deck carries, so `proxy` is the only accepted value. Every line without its own `[labels]` token inherits it. `--add`/`--remove` merge as they do for a collection; an empty `set` is refused (clearing is `unset`'s job).                                 |
| deck       | `sourceId`    | The deck's id on its sync source; exactly one value. Must agree with `sourceUrl` (see below).                                                                                                                                                                                                                                                            |
| deck       | `sourceUrl`   | The deck's `http(s)` URL on its sync source; exactly one value.                                                                                                                                                                                                                                                                                          |
| collection | `labels`      | Default card labels: `sale`/`trade` (combinable) or `keep`/`proxy` (each exclusive), as separate values or comma-joined, case-insensitively. `--add`/`--remove` merge with the current set (a typo'd label errors rather than silently removing nothing; removing the last label clears the key). An empty `set` is refused — clearing is `unset`'s job. |

Setting `sourceId` + an `archidekt.com` `sourceUrl` is what makes a deck [sync-linked](/commands/deck-sync/); the two must name the same Archidekt deck, and a write that would leave them disagreeing is refused — the same validation the admin route applies. For the interactive linking flow, prefer `deck-sync link`.

A deck's `name`, `created`, and `lastSynced` front-matter fields are not settable here (a usage error explains each — the display name is changed with [`rename`](/commands/rename/), the other two are stamped automatically), and any other property is refused with the accepted-fields listing.

## Examples

```bash
./ritual metadata set trade-binder labels sale,trade   # collection default labels
./ritual metadata set trade-binder labels keep         # keep is exclusive
./ritual metadata unset trade-binder labels            # back to no default

./ritual metadata set my-deck labels proxy            # every deck line counts as a proxy
./ritual metadata unset my-deck labels                # back to no default

./ritual metadata set my-deck description "A budget mono-red burn list"
./ritual metadata set my-deck tags aggro budget
./ritual metadata set my-deck tags spicy --add
./ritual metadata set my-deck format modern

./ritual metadata get my-deck tags                     # ["aggro","budget","spicy"]
./ritual metadata list my-deck
```

## Output

`set` reports the property's new stored value (`Set labels = ["sale","trade"] on collection 'trade-binder'`; a value that cleared the key reports `Cleared`). `get` prints the raw value — arrays as JSON — and exits `3` with a `not_found` error when the property is unset. `list` prints every settable property for the list's type, `(unset)` included; with `--output json` the payload is `{ type, list, frontMatter }` where `frontMatter` is the **full** mapping — non-settable keys (`name`, `created`, `lastSynced`) and hand-authored unknown keys included, the same honest shape the admin route returns.

Under `--output json`/`ndjson`, errors are emitted on stderr as `{ "error": { "code", "message" } }` per the [scripting conventions](/#scripting-conventions).

## Behavior

- **Only the front-matter block is touched.** The write is body-preserving: prose, fenced blocks, and card lines survive byte for byte. No changelog entry is recorded — the changelog is card-level, and metadata is not a card change.
- **Unknown keys round-trip.** A hand-authored key the vocabulary does not know is preserved through every write; only the addressed property changes. One deck-side exception: a _named_ field stored with the wrong type (say, a `tags:` holding a string) is dropped by the write, exactly as a full deck save would drop it. A file whose existing front matter cannot be read as YAML refuses every subcommand with a runtime error (a merge over keys that cannot be seen would clobber them) — fix the block by hand first.
- **An empty array reads as unset.** `labels: []` means "no default" and `tags: []` says nothing, so `get` exits `3` for both, and removing an array's last value deletes the key rather than writing `[]`.
- **The `.sha256` sidecar** is refreshed only when it matched the file before the write, so a hand-edited file keeps its stale sidecar and [`detect-changes`](/commands/detect-changes/) still records the edit.
- **Validation matches the other surfaces**: the label vocabulary, the `keep`/`proxy` exclusivity rule, which labels the list's own type carries, deck format keys, `http(s)` source URLs, and the Archidekt id/URL agreement rule are all enforced exactly as the admin route enforces them.

## Exit Codes

| Code | Meaning                                                                                                        |
| ---- | -------------------------------------------------------------------------------------------------------------- |
| `0`  | Success                                                                                                        |
| `1`  | Runtime error (unreadable existing front matter, file I/O failure)                                             |
| `2`  | Usage error (unknown property, invalid value, wanted-list target, conflicting type flags, ambiguous list name) |
| `3`  | Not found (`get` on an unset property, or no list matches the given name)                                      |

## See Also

- [`edit`](/commands/edit/) — the session editor's `🏷️ Edit List Labels` / `🔖 Edit Tags` / `🏷️ Change Format` actions edit the same fields interactively, deferred to the session's save
- [`config`](/commands/config/) — the same subcommand shape for the ritual configuration file
- [Admin API — List Metadata](/admin/api/#list-metadata) and the MCP `set_list_metadata` tool — the same engine over HTTP
