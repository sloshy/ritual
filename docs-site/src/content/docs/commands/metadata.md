---
title: 'metadata'
---

Inspect and change a list's front matter from scripts, with the same `set`, `get`, `list`, and `unset` subcommands as [`config`](/commands/config/).

Every list type takes `description`, the prose the [built site](/commands/build-site/) prints above the cards. Decks add `tags`, `format`, `labels`, `sourceId`, and `sourceUrl`. Collections add `labels`, their [default card labels](/list-format/#default-labels-and-descriptions). A wanted list carries the description alone.

Every list type also carries a cover [`image`](/list-images/), but that key is **out of scope here**. It is a mapping rather than a scalar, so [`set-list-image`](/commands/set-list-image/) writes it. `set`, `unset`, and `get` all point you there; only `list` reports it.

Writes use the same engine as the admin [List Metadata](/admin/api/#list-metadata) route and the MCP `set_list_metadata` tool, so validation is identical on every surface. Card lines (`&N` ids, label overrides, notes) survive byte for byte. Only the front-matter block is rewritten; comments and quoting style there are not preserved, though every key and value is.

## Usage

```bash
ritual metadata set [listName] <property> <value...> [--add | --remove]
ritual metadata get [listName] <property>
ritual metadata list [listName]
ritual metadata unset [listName] <property>
```

`[listName]` names a list of any type; see [List Names](/list-resolution/). Pass `--deck`, `--collection`, or `--wanted` to fix the type or disambiguate. When the name is omitted, an interactive picker offers every list ([prompts permitting](/cli-conventions/#when-prompts-are-unavailable)).

### Options

Every subcommand takes:

| Flag                | Description                                                       |
| ------------------- | ----------------------------------------------------------------- |
| `--deck`            | Resolve the name as a deck                                        |
| `--collection`      | Resolve the name as a collection                                  |
| `--wanted`          | Resolve the name as a wanted list                                 |
| `--output <format>` | Output format: `text` (default), `json`, or `ndjson`              |
| `--quiet`           | Suppress non-essential text output (`get` still prints its value) |

`set` also takes `--add` / `--remove` (mutually exclusive) to merge values into an array property (`tags`, `labels`) instead of replacing it.

Once a list name is given, no subcommand prompts, so they are safe under `--no-input`.

## Properties

| List type  | Property      | Value                                                                                                                                                                                         |
| ---------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| any        | `description` | Free text; values are joined with spaces, so quoting is optional. Stored trimmed; an empty value clears it.                                                                                   |
| deck       | `tags`        | One tag per argument (commas inside an argument split too). `--add` appends, `--remove` drops; otherwise values replace. Removing the last tag clears the key.                                |
| deck       | `format`      | A [deck format key](/commands/new/#deck-format) (e.g. `commander`, `modern`); exactly one value.                                                                                              |
| deck       | `labels`      | Default card labels for the deck. [`proxy`](/list-format/#card-labels) is the only accepted value. Every line without its own `[labels]` token inherits it.                                   |
| deck       | `sourceId`    | The deck's id on its sync source; exactly one value. Must agree with `sourceUrl` (see below).                                                                                                 |
| deck       | `sourceUrl`   | The deck's `http(s)` URL on its sync source; exactly one value.                                                                                                                               |
| collection | `labels`      | Default card labels: `sale`/`trade` (combinable) or `keep`/`proxy` (each exclusive), as separate values or comma-joined, case-insensitively.                                                  |
| any        | `image`       | **Not settable here.** `list` reports the stored [cover image](/list-images/) mapping; `get`, `set`, and `unset` refuse it (exit `2`) and name [`set-list-image`](/commands/set-list-image/). |

Notes on `labels` (deck and collection):

- `--add` / `--remove` merge with the current set. Removing the last label clears the key.
- A misspelled label errors, even under `--remove`, rather than silently removing nothing.
- An empty `set` is refused; clearing is `unset`'s job.

Setting `sourceId` plus an `archidekt.com` `sourceUrl` is what makes a deck [sync-linked](/commands/deck-sync/). The two must name the same Archidekt deck; a write that would leave them disagreeing is refused. For the interactive linking flow, prefer `deck-sync link`.

A deck's `lastSynced` field is not settable here (a usage error says deck sync stamps it). Any other property is refused with the accepted-fields listing. A list's name is not front matter at all: it is the file's `# Title` heading, changed with [`rename`](/commands/rename/).

## Examples

```bash
ritual metadata set trade-binder labels sale,trade   # collection default labels
ritual metadata set trade-binder labels keep         # keep is exclusive
ritual metadata unset trade-binder labels            # back to no default

ritual metadata set my-deck labels proxy            # every deck line counts as a proxy
ritual metadata unset my-deck labels                # back to no default

ritual metadata set my-deck description "A budget mono-red burn list"
ritual metadata set trade-binder description "Everything I will trade away"
ritual metadata set wants description "Cards I still need" --wanted
ritual metadata unset wants description
ritual metadata set my-deck tags aggro budget
ritual metadata set my-deck tags spicy --add
ritual metadata set my-deck format modern

ritual metadata get my-deck tags                     # ["aggro","budget","spicy"]
ritual metadata list my-deck
```

## Output

- `set` reports the property's new stored value (`Set labels = ["sale","trade"] on collection 'trade-binder'`). A value that cleared the key reports `Cleared`.
- `get` prints the raw value, arrays as JSON, and exits `3` with a `not_found` error when the property is unset.
- `list` prints every property for the list's type, `(unset)` included, and the non-settable `image` among them. With `--output json` the payload is `{ type, list, frontMatter }`, where `frontMatter` is the **full** mapping, including non-settable keys (`lastSynced`, `sourceUpdatedAt`) and hand-authored unknown keys. This is the same shape the admin route returns.

Under `--output json`/`ndjson`, errors are emitted on stderr as `{ "error": { "code", "message" } }` per the [scripting conventions](/cli-conventions/#scripting).

## Behavior

- **Only the front-matter block is touched.** Prose, fenced blocks, and card lines survive byte for byte. No changelog entry is recorded; the changelog is card-level, and metadata is not a card change.
- **Unknown keys round-trip.** A hand-authored key the vocabulary does not know is preserved through every write. One deck-side exception: a _known_ field stored with the wrong type (say, a `tags:` holding a string) is dropped by the write, exactly as a full deck save would drop it. A file whose front matter cannot be read as YAML refuses every subcommand with a runtime error, since merging over keys that cannot be seen would destroy them. Fix the block by hand first.
- **An empty array reads as unset.** `labels: []` means "no default" and `tags: []` says nothing, so `get` exits `3` for both, and removing an array's last value deletes the key rather than writing `[]`.
- **The `.sha256` content hash** is refreshed only when it matched the file before the write. A hand-edited file keeps its stale hash, so [`detect-changes`](/commands/detect-changes/) still records the edit.
- **Validation matches the other surfaces**: the label vocabulary, the `keep`/`proxy` exclusivity rule, which labels the list's type carries, deck format keys, `http(s)` source URLs, and the Archidekt id/URL agreement rule are enforced exactly as the admin route enforces them.

## Exit Codes

| Code | Meaning                                                                                                        |
| ---- | -------------------------------------------------------------------------------------------------------------- |
| `0`  | Success                                                                                                        |
| `1`  | Runtime error (unreadable existing front matter, file I/O failure)                                             |
| `2`  | Usage error (unknown property for the list's type, invalid value, conflicting type flags, ambiguous list name) |
| `3`  | Not found (`get` on an unset property, or no list matches the given name)                                      |

## See Also

- [`edit`](/commands/edit/) — the session editor's `🏷️ Edit List Labels` / `🔖 Edit Deck Tags` / `🏷️ Change Format` actions edit the same fields interactively, deferred to the session's save
- [`config`](/commands/config/) — the same subcommand shape for the ritual configuration file
- [`set-list-image`](/commands/set-list-image/) — the cover `image:` key, on all three list types
- [List cover images](/list-images/) — what the key means and how the site resolves it
- [Admin API — List Metadata](/admin/api/#list-metadata) and the MCP `set_list_metadata` tool — the same engine over HTTP (that route _does_ write `image`)
