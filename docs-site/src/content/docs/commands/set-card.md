---
title: 'set-card'
---

Update a card in place — its printing, finish, condition, language, label, tags, custom art, deck section, or commander status — in a deck, collection, or wanted list, without opening an editor.

The edit is line-preserving: only the targeted card's line is rewritten (or moved, for section and commander changes). Everything else in the file — prose, comments, unusual headings, even lines the parser cannot read — stays intact. (A `--section`/`--commander` move may additionally create the destination's `## Section` heading when it does not exist yet.)

## Usage

```bash
./ritual set-card [listName] [cardName...] [options]
```

`[listName]` is resolved across all three list types (see [List Resolution](/commands/list-resolution/)); pass a `--deck`, `--collection`, or `--wanted` flag (or a `deck:`/`collection:`/`wanted:` prefix on the name) to pin the type or disambiguate. If invoked with no list name, the command runs interactively, prompting you to pick a list and then a card. Both prompts need a terminal with prompting enabled — when [prompts are unavailable](/#when-prompts-are-unavailable) (piped stdin, or `--no-input` / `RITUAL_NO_INPUT`), omitting `[listName]` or a card selector (`[cardName...]`/`--card-id`) exits with a usage error (code `2`) instead of prompting. At least one mutation flag is required.

## Arguments

| Argument        | Description                                                                               | Required |
| --------------- | ----------------------------------------------------------------------------------------- | -------- |
| `[listName]`    | Name of the deck, collection, or wanted list (case- and accent-insensitive, no extension) | No       |
| `[cardName...]` | Card name to update (fuzzy match)                                                         | No       |

## Options

| Option                    | Description                                                                                                                    | Default |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------- |
| `--deck`                  | Resolve the name as a deck                                                                                                     |         |
| `--collection`            | Resolve the name as a collection                                                                                               |         |
| `--wanted`                | Resolve the name as a wanted list                                                                                              |         |
| `--card-id <id>`          | Disambiguate by card ID (the `&N` suffix in list files). Required when name search hits multiple printings.                    |         |
| `--set <code>`            | New set code — must be given together with `--collector-number`                                                                |         |
| `--collector-number <cn>` | New collector number — must be given together with `--set`                                                                     |         |
| `--finish <finish>`       | New finish: `nonfoil`, `foil`, or `etched` (case-insensitive)                                                                  |         |
| `--condition <condition>` | New condition: `NM`, `LP`, `MP`, `HP`, `DMG`, or `NONE` to clear it (case-insensitive; decks and collections only)             |         |
| `--language <code>`       | New language as a Scryfall code (`ja`, `de`, `zhs`, ...; aliases like `jp`/`Japanese` normalize); `en` clears the line's token |         |
| `--label <labels>`        | New label override: `sale,trade` (combinable), `keep` or `proxy`, or `none` to clear it (decks take `proxy` only)              |         |
| `--tag <tags>`            | Add these [tags](/commands/edit/#card-tags) to the card: one or more, comma-separated (`"Ramp, Card Draw"`); any list type     |         |
| `--untag <tags>`          | Remove these tags from the card: one or more, comma-separated; any list type                                                   |         |
| `--art <value>`           | Custom art for this card: an image path relative to the art directory, an `http(s)` URL, or `none` to clear it                 |         |
| `--section <name>`        | Move the card to this deck section, creating the section if it does not exist (decks only)                                     |         |
| `--commander`             | Move the card to the deck's Commander section (decks only)                                                                     |         |
| `--no-commander`          | Move the card out of the Commander section back to the main section (decks only)                                               |         |
| `-n, --dry-run`           | Report what would change without writing anything                                                                              | `false` |
| `--output <format>`       | Output format: `text`, `json`, or `ndjson`                                                                                     | `text`  |
| `--quiet`                 | Suppress non-essential output                                                                                                  | `false` |

Multiple mutation flags can be combined in one invocation; each is applied and reported.

## Examples

Change a card's finish:

```bash
./ritual set-card --deck "My Deck" Sol Ring --finish foil
```

Switch to a different printing (validated against the Scryfall cache):

```bash
./ritual set-card --collection main "Lightning Bolt" --set 2xm --collector-number 157
```

Change the printing and finish together, targeting a specific entry:

```bash
./ritual set-card --collection main --card-id 12 --set lea --collector-number 161 --finish nonfoil
```

Downgrade a collection card's condition:

```bash
./ritual set-card --collection main "Mana Crypt" --condition LP
```

Mark a copy as Japanese, or back to English (the token is removed — a bare line means English):

```bash
./ritual set-card --collection main "Sol Ring" --language ja
./ritual set-card --collection main "Sol Ring" --language en
```

Move a deck card to the sideboard section and capture JSON output:

```bash
./ritual set-card --deck "My Deck" "Winota, Joiner of Forces" --section Sideboard --output json
```

The JSON payload is `{ type, list, cardName, cardId, applied }` (plus `dryRun: true` under `--dry-run`), where `applied` is one entry per change made (e.g. `"printing → 2XM:157"`, `"finish → foil"`, `"condition → LP"`, `"language → ja (Japanese)"`, `"label → sale, trade"`, `"tags added → Card Draw, Ramp"`, `"tags removed → Ramp"`, `"custom art → proxies/sol-ring.jpg"`, `"section → Sideboard"`, `"commander"`, `"not commander"`).

Make a card the deck's commander:

```bash
./ritual set-card --deck "My Deck" "Winota, Joiner of Forces" --commander
```

## Behavior

### Card Resolution

Cards are matched the same way as [`note`](/commands/note/): fuzzy name match (case-, accent-, and punctuation-insensitive; exact name preferred, then substring), `--card-id` for a precise target, or an interactive picker when neither is given. An ambiguous name match exits with a `usage_error` listing each candidate.

When a card name **and** `--card-id` are both given they must agree: the ID's entry has to match the name by the same rule the name-only path uses. A disagreement is a usage error naming both (`--card-id 3 is 'Demonic Tutor', which does not match 'Lightning Bolt'.`) — IDs are reused from a pool after a removal, so a stale ID paired with a name is a strong signal the wrong card is about to be touched. ID-only and name-only invocations are unaffected.

### Printing Validation

`--set` and `--collector-number` must be given together, and the pair is validated against the card's printings in the local Scryfall cache: an unknown pair is a usage error listing the available printings (up to 10). Whenever `--finish` is given — with a printing change, with `--condition`, or on its own — the finish is validated against the printing the line will carry (the new one when pinned, otherwise the one the entry already has), and a finish that printing is not offered in is a usage error listing the finishes it does offer. If the printing lookup itself fails (empty or unreachable cache), the command exits with a runtime error — refresh the cache with [`cache`](/commands/cache/).

When the local card cache holds no entry for the card at all, there is no printing list to validate against, so the pinned printing is verified directly with Scryfall (a single request): accepted when Scryfall confirms it belongs to that card, a usage error when it belongs to a different one (`STA:90 is 'Other Card', not 'This Card'`), and a runtime error (exit `1`) when Scryfall cannot be reached.

When you change the printing **without** `--finish`, the card's current finish is carried onto the new printing — and validated there too, against the pinned printing's finishes. Repinning a `[foil]` entry to a printing that has no foil is a usage error saying the entry already records that finish and to pass `--finish` to record an available one, rather than silently writing a finish the new printing is not offered in.

Validating `--finish` against an entry's **existing** printing is cache-only: no hidden network fetch is made for an in-place edit, and a single-printing fallback fetch could not be trusted as a complete printing list anyway. When the cache cannot vouch for the printing, the check is skipped with a note on stderr and the edit proceeds; the note distinguishes the two reasons, since only one is fixable — a cache that holds no complete printing list for the card (run `ritual cache preload-all`), or an entry pinned to a printing the cache does not know at all (no preload will make it one).

### A Finish Belongs To A Printing

`--finish foil` and `--finish etched` require the line to name a printing. A deck or wanted-list line with no `(SET:CN)` has nothing for the token to describe, so the edit is a usage error (exit `2`) rather than a silently unvalidated write — pass `--set` and `--collector-number` in the same invocation to pin a printing and record the finish together:

```bash
./ritual set-card --deck "My Deck" "Sol Ring" --set c19 --collector-number 221 --finish foil
```

`--finish nonfoil` is always accepted: it clears a finish token rather than asserting one, so a hand-written `[foil]` on a printing-less line can still be removed. Combining `--finish foil` with `--condition` is refused for the same reason — that pairing is recorded as a printing update, but it still writes the finish token.

The rule holds everywhere an **existing** line's finish is edited: the site editors grey out "Set as Foil" until a printing is chosen, `ritual edit` offers the finish action only on a pinned entry, and the [MCP](/commands/mcp/) `apply_changes` and `set_card_printing` tools refuse it too (a `set-printing` earlier in the same batch satisfies it).

**Creating** a line is deliberately different. `ritual add-card ... --wanted --name-only --finish foil` still records "any printing, in foil" — a wanted-list specificity rather than a claim about a card in hand — and deck imports and cross-list moves may likewise carry a finish onto a line they create. Once such a line exists, clearing its finish is one-way: setting it back to `foil` needs a printing.

### Condition Updates

Condition applies to decks and collections only (wanted-list entries never track condition). `--condition NONE` clears a recorded grade, matching [`add-card`](/commands/add-card/)'s vocabulary.

**`NM` is the unrecorded default.** The line format omits a `[NM]` annotation, so `--condition NM` and `--condition NONE` produce the same line: one with no grade on it. This collapse is intentional — an ungraded card and a card graded Near Mint are one state in Ritual's file format. The success output says so rather than claiming a grade was recorded: `condition → NM (written as an ungraded line — NM is the default)` and `condition → none (grade cleared)`. Internally there is no standalone "set condition" change event — a condition change rides on the same printing-update event the editors use, carrying the card's current set/collector number/finish, so only the condition (and finish, if also given) actually changes. In the changelog this therefore appears as a printing update, e.g. `Set "Mana Crypt" printing to 2XM:1 [foil] [LP] &2`.

### Label Updates

`--label` sets the card's [label override](/commands/edit/#card-labels), and `--label none` clears it so the list's front-matter default applies again. Which labels the flag accepts depends on the list type: a **collection** takes the whole vocabulary (`sale` and `trade` combine as `sale,trade`; `keep` and `proxy` each stand alone), a **deck** takes `proxy` alone, and a **wanted list** carries no labels at all. A label the type does not carry is a usage error (exit `2`) naming the offending labels and the ones that type supports — it is never silently dropped. `--label` is also the only edit that can **repair** a line whose existing `[labels]` token the parser refuses (`[sale,keep]`, or a label the type does not carry): it replaces the token outright, while every other edit to that line refuses rather than dropping it silently.

```bash
./ritual set-card --collection main "Sol Ring" --label keep
./ritual set-card --collection main "Sol Ring" --label sale,trade
./ritual set-card --deck "Winota Stax" "Sol Ring" --label proxy
./ritual set-card --deck "Winota Stax" "Sol Ring" --label none
```

A `proxy` card is priced at zero everywhere and is excluded from buylist and sell reports — see [Proxies carry no price](/commands/edit/#proxies-carry-no-price).

### Tag Updates

`--tag` adds [tags](/commands/edit/#card-tags) to the card's line and `--untag` removes them, on **every** list type. Either flag takes one or more tags **separated by commas** — spaces are part of a tag, so `--tag "Card Draw, Ramp"` is two tags — kept in the case you wrote them; a tag cannot contain `#`, `,`, `&`, brackets, braces or parentheses, and one that does is rejected at parse time (exit `2`). Tags the line already carries are left alone: `--tag` never replaces the set and `--untag` removes only the tags it names. Only the tags that actually move are recorded — a `--tag` or `--untag` in which _nothing_ changed reports `tags unchanged (…)`, naming the tags you passed, instead of re-recording them. Naming the same tag in both flags is a usage error. Repeating a flag accumulates (`--tag ramp --tag staple` is `--tag ramp,staple`), and an empty value (`--tag ""`) is refused at parse time rather than read as a no-op — unlike the editor's tag prompt, where an empty field clears the tags. Tags are the owner's own vocabulary, unrelated to labels — a `Keep` tag is a legal tag with nothing to do with the `[keep]` label — and a deck's front-matter `tags:` key is a property of the deck, never of its cards.

```bash
./ritual set-card --collection main "Sol Ring" --tag "ramp, staple"
./ritual set-card --collection main "Sol Ring" --untag ramp
./ritual set-card --deck "Winota Stax" "Sol Ring" --tag edh-staple
./ritual set-card --wanted needs "Mox Ruby" --tag budget --untag reserved-list
```

The line is rewritten with its tags in canonical order — `- Sol Ring (C21:240) #Card Draw, Ramp &1` — and each tag that actually changed is its own changelog line (`Added tag "Ramp" to "Sol Ring" &1`, `Removed tag "Staple" from "Sol Ring" &1`), so an add and a later remove of the same tag read as exactly that in the history.

### Custom Art

`--art` records [custom art](/custom-art/) for the card on every list type. The value is one of:

- an image path **relative to the [art directory](/configuration/#directory-options)** (`proxies/sol-ring.jpg`) — forward slashes only, never escaping that directory, and ending in `.avif`, `.gif`, `.jpeg`, `.jpg`, `.png`, or `.webp` (the extensions the art route serves);
- an absolute `http(s)` URL (`https://example.com/bolt.png`), stored verbatim — no extension rule applies to a URL;
- `none`, which removes whatever art the card carried.

```bash
./ritual set-card --deck "Winota Stax" "Sol Ring" --art proxies/sol-ring.jpg
./ritual set-card --collection main "Lightning Bolt" --art https://example.com/bolt.png
./ritual set-card --wanted "My Wants" "Mana Crypt" --art none
```

A path is checked against the configured art directory **before** anything is written: a missing file is a `not_found` (exit `3`) naming both the absolute path that was checked and the art directory, an unreadable one a runtime error (exit `1`), and a directory a usage error. A malformed value (a backslash, an absolute path, a `..` escape, an extension that is not an image, a non-`http(s)` URL) is rejected by argument parsing itself, exit `2`.

The reference is filed under the card's `&N` id in the list's `<list>.art.json` sidecar, so a line that carries no id yet is refused rather than guessed at. Everything else about the card is untouched: art is list **metadata**, written straight to the sidecar with no change event, no changelog entry, and no `.sha256` refresh. `--art` counts toward the "at least one change" requirement, so it can be the only flag — and an `--art`-only run does not rewrite the list file at all.

Applied output reads `custom art → proxies/sol-ring.jpg` (or `custom art → none (cleared)`).

A card with custom art is priced at zero everywhere and excluded from buylist and sell reports, exactly like a `proxy` — see [Custom art carries no price](/custom-art/#custom-art-carries-no-price).

### Language Updates

`--language` works on all three list types and takes a Scryfall language code (`en es fr de it pt ja ko ru zhs zht he la grc ar sa ph` — note `zhs`/`zht` for Chinese, not ISO codes); common aliases (`jp`, `kr`, `sp`, `cs`, `ct`, full English names like `Japanese`) normalize to the canonical code before anything is written.

The token is written in canonical position on the line (`- Sol Ring (C21:263) [foil] [LP] [ja] &7`) and **omitted for English**: `--language en` removes the token, because a bare line always means `en`. The success output says exactly what was written: `language → ja (Japanese)`, or `language → en (token cleared — a bare line means English)`.

Unlike `--finish`, a non-English value is **not** validated cache-only. The check is cache-first: the cached printing list can prove the language is available, and — when the cache is complete and was built from the `all_cards` bulk — prove it is not. Otherwise the printing is verified directly with Scryfall (`GET /cards/{set}/{cn}/{lang}`). A printing that has no object in that language is a usage error (exit `2`); only an unreachable API downgrades the check to a note — `Note: could not verify that C21:263 exists in Japanese (ja) — Scryfall could not be reached. Recording it as asserted.` — and the edit proceeds. An entry with no `(SET:CN)` printing goes silently unchecked — there is nothing to verify against.

In the changelog the change appears as `Set language of "Sol Ring" to Japanese &7`.

### Sections and Commander

`--section` moves the card to the named deck section; a section that does not exist yet is created at the end of the deck. `--commander` moves the card into the deck's `Commander` section (created at the top if missing); `--no-commander` moves it back out to the first regular section. The two are opposites of one flag — if both appear on one command line, the last one wins.

### Dry Runs

`-n` / `--dry-run` resolves the list and the card and runs every validation — including the ones raised by the apply itself, which it performs in memory and throws away, so a preview never reports an edit the real run would refuse — then reports the change it _would_ apply and stops. Nothing is written: no list file, no changelog, no `.sha256` sidecar, no `.art.json` sidecar, and the card-ID backfill is skipped too. Text output is prefixed `[dry-run]`; JSON output carries `"dryRun": true` alongside the usual fields. (Because the backfill is skipped, a dry-run `--art` against a list whose lines have no `&N` ids yet reports the missing id rather than inventing one.)

### Change Tracking

Every applied change is recorded in the list's `.changes.md` changelog in a single block per invocation (`Set ... finish to foil`, `Set ... printing to 2XM:157`, `Set labels on ... to [proxy]`, `Added tag "Ramp" to ...`, `Moved ... to section "Sideboard"`, `Set ... as commander`, etc.). A `--tag`/`--untag` whose every tag was already in its requested state records nothing.

`--art` is the exception: [custom art](/custom-art/) is list metadata, so it is written to the `.art.json` sidecar with no changelog entry at all.

## Exit Codes

| Code | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Success                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `2`  | Usage error (no mutation flags, a `--card-id` that disagrees with the card name, `--set` without `--collector-number`, unknown printing, unavailable finish, a foil/etched finish on a line that names no printing, a language the printing has no Scryfall object in, a label the list type does not carry, a malformed tag or the same tag given to both `--tag` and `--untag`, a malformed `--art` value or one naming a directory, flag not valid for the list type, ambiguous list or card, prompts unavailable for interactive list/card selection) |
| `3`  | Not found (missing list file, missing card, missing card ID, an `--art` file that is not in the art directory)                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `1`  | Runtime error (Scryfall printing lookup failed, an unreadable `--art` file or `.art.json` sidecar, a card line with no `&N` id to file art under, etc.)                                                                                                                                                                                                                                                                                                                                                                                                   |
