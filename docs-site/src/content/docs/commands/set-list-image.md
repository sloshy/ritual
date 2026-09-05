---
title: 'set-list-image'
---

Choose the cover image a deck, collection, or wanted list shows on the published site — the picture on its index-page tile and in Quick Switch, written as the [`image:` front-matter key](/list-images/).

Without the key, Ritual picks the cover itself: a commander deck shows its commander, every other list its most expensive printing. This command overrides that with a card from the list, an image in your [art directory](/custom-art/#the-art-directory), or a URL — and takes the override back off again.

The write is front-matter-only: card lines — `&N` ids, label overrides, notes — survive byte for byte, and no changelog entry is recorded (the changelog is card-level, and a cover is not a card change).

## Usage

```bash
ritual set-list-image [listName] [options]
```

`[listName]` is resolved across all three list types (see [List Resolution](/list-resolution/)); pass `--deck`, `--collection`, or `--wanted` (or a `deck:`/`collection:`/`wanted:` prefix on the name) to pin the type or disambiguate. With no list name — or with no mode option — the command runs as a wizard: pick the list, pick the mode, then pick the card, browse for a file, or type the URL.

## Arguments

| Argument     | Description                                                                               | Required |
| ------------ | ----------------------------------------------------------------------------------------- | -------- |
| `[listName]` | Name of the deck, collection, or wanted list (case- and accent-insensitive, no extension) | No       |

## Options

The four mode options are mutually exclusive — passing two is a usage error before anything is read.

| Option              | Description                                                                                | Default |
| ------------------- | ------------------------------------------------------------------------------------------ | ------- |
| `--deck`            | Resolve the name as a deck                                                                 |         |
| `--collection`      | Resolve the name as a collection                                                           |         |
| `--wanted`          | Resolve the name as a wanted list                                                          |         |
| `--card <id>`       | Show the card with this `&N` id. `12` and `&12` are both accepted                          |         |
| `--file <path>`     | Show this image, as a path relative to the [art directory](/custom-art/#the-art-directory) |         |
| `--url <url>`       | Show this absolute `http(s)` URL, exactly as given                                         |         |
| `--default`         | Remove the override; Ritual's own choice applies again                                     |         |
| `--dry-run`         | Report what the cover would become without writing anything (long form only)               | `false` |
| `--output <format>` | Output format: `text`, `json`, or `ndjson`                                                 | `text`  |
| `--quiet`           | Suppress non-essential output                                                              | `false` |

## Modes

| Mode        | Front matter written        | Checked when written?                                                        |
| ----------- | --------------------------- | ---------------------------------------------------------------------------- |
| `--card`    | a `card:` mapping           | **Yes** — a list with no such `&N` is refused (exit `2`), nothing is written |
| `--file`    | a `file:` mapping           | Shape only (see below); the file itself need **not** exist yet               |
| `--url`     | a `url:` mapping            | Shape only — an absolute `http(s)` URL. Never fetched                        |
| `--default` | the `image:` key is removed | n/a                                                                          |

```yaml
image:
  card: 12
```

A `--file` path obeys the same rules as [custom art](/custom-art/#the-sidecar): forward slashes, relative to the art directory, never escaping it, and ending in `.avif`, `.gif`, `.jpeg`, `.jpg`, `.png`, or `.webp`. Only the **shape** is checked here — unlike [`set-card --art`](/commands/set-card/#custom-art), the image may be added later, and until it is there the site build prints a `Custom art file not found` warning and falls back to the default cover. A `--card` id is different because it is checked against the very file being written, so a stale one is always a mistake rather than a plan.

The stored `card` reference then follows the list's card lines: removing that card clears the key, and a save that renumbers the line rewrites it. See [List cover images](/list-images/#the-card-reference-follows-the-card).

## Interactive

Run it with no mode option to open the wizard:

1. **Mode** — a menu of the four modes, with the list's current one marked `✓` and the current value shown in the prompt header.
2. **Card** — an autocomplete over every line in the list that carries an `&N`, in file order, described the way every other card picker describes one. A list with no cards at all exits `3` here.
3. **File** — the same art-directory browser [`set-card --art`](/commands/set-card/) uses.
4. **URL** — a text prompt; submitting it blank cancels.

A value the wizard cannot parse is reported (`Cover image unchanged — …`) and nothing is written — a refusal is not a decision to change anything.

## `--no-input`

Every prompt goes through the shared [prompt gate](/cli-conventions/#when-prompts-are-unavailable). With piped stdin, `--no-input`, or `RITUAL_NO_INPUT`, a run that would have to ask — no list name, or no mode option — exits `2` with `Input required: …` instead of prompting. A fully-flagged invocation is always safe to script.

## Examples

```bash
ritual set-list-image "Winota Stax" --card 12          # &12 also works
ritual set-list-image "Main Binder" --file alters/binder.png
ritual set-list-image "To Buy" --wanted --url https://example.com/cover.jpg
ritual set-list-image "Winota Stax" --default          # back to the commander
ritual set-list-image "Winota Stax" --card 12 --dry-run
ritual set-list-image                                  # wizard
```

## Output

Text output is one line: `Deck 'winota-stax': cover image is now the card &12`, or `… cover image cleared; the built-in choice applies again`. A `--dry-run` prefixes it with `[dry-run]` and says _would become_ (or _would be cleared_, for `--default`).

With `--output json` the payload is `{ type, list, mode, image }` — `mode` is `default`, `card`, `file`, or `url`, and `image` is the stored mapping (`{"card":12}`) or `null` when the key was removed. A dry run adds `"dryRun": true`. Errors are emitted on stderr as `{ "error": { "code", "message" } }` per the [scripting conventions](/cli-conventions/#scripting-conventions).

## Behavior

- **The card-ID backfill is conditional.** This command [backfills `&N` ids](/cli-conventions/#the-card-id-backfill) only when the run actually consumes one — `--card`, or the wizard's card picker. A `--file`, `--url`, or `--default` run writes nothing but the front matter, so it triggers no backfill at all, and neither does any `--dry-run`.
- **One validator, three surfaces.** The card-id check, the path rules, and the URL rule are the [admin route's](/admin/api/#list-metadata) own, so this command, the HTTP API, the MCP `set_list_metadata` tool, and the admin editors refuse the same values in the same words.
- **The `.sha256` sidecar** is refreshed only when it matched the file before the write, so a hand-edited file keeps its stale sidecar and [`detect-changes`](/commands/detect-changes/) still records the edit.
- **Wanted lists are in scope**, as they are for [`metadata`](/commands/metadata/): `image` and `description` are the two front-matter keys they carry.

## Exit Codes

| Code | Meaning                                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------ |
| `0`  | Success                                                                                                      |
| `1`  | Runtime error (unreadable existing front matter, file I/O failure)                                           |
| `2`  | Usage error (unknown `--card` id, invalid path or URL, two modes at once, conflicting type flags, cancelled) |
| `3`  | Not found (no list matches the given name, or the list has no cards to choose from)                          |

## See Also

- [List cover images](/list-images/) — the `image:` key, its grammar, and how the site resolves it
- [`metadata`](/commands/metadata/) — the rest of a list's front matter (it displays `image` but does not write it)
- [Custom Card Art](/custom-art/) — the per-card images a `file` cover shares its rules and its art directory with
