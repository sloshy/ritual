---
title: 'List Resolution'
---

Every command that loads a deck, collection, or wanted list by name resolves that name the same way. This page is the single reference for that shared behavior.

## How a name is matched

Given a name, the resolver searches existing list files and applies these rules in order:

1. **Exact match**, ignoring case, diacritics, separators, and a trailing `.md`. A list whose file name equals the input under those rules wins outright.
2. **Unique substring match.** If nothing matches exactly, a list whose name _contains_ the input (under the same rules) is accepted — but only if exactly one does.
3. **Otherwise it is an error.** No match is a "not found" error; more than one match at the winning tier is an "ambiguous" error.

Matching is performed against the **file name** (without the `.md` extension), not the human-facing title in front matter or the markdown heading.

Before matching:

- Accented letters are folded to their plain forms, so `cafe` resolves a list named `Café` and vice versa.
- Hyphens and underscores are treated as spaces, so a list is found whichever way its name is punctuated: `winota-stax` resolves `Winota Stax.md`, and `Black Panther` resolves a `black-panther.md` left over from before list files were [named as entered](/commands/new-deck/#list-file-names).

Two lists whose names differ only in punctuation (`Mono Red` and `mono-red`) are reported as ambiguous rather than silently picked between.

## Type flags and disambiguation

Type-agnostic commands (`add-card`, `add-note`, `clear-note`, `history`, `price`) search **all three** list types at once. A name that exists in more than one type — say a deck _and_ a collection both called `staples` — is ambiguous. Resolve it with a type flag:

| Flag           | Restricts the search to |
| -------------- | ----------------------- |
| `--deck`       | Decks                   |
| `--collection` | Collections             |
| `--wanted`     | Wanted lists            |

The flags are mutually exclusive. Single-type commands (`deck-sync`, `get-primer`) already know their type, so they never need a flag — but they match names by the same case- and accent-insensitive, substring, ambiguity-aware rules.

## Examples

```bash
# Exact, case- and accent-insensitive — resolves decks/Goblins.md
./ritual price goblins --deck

# Unique substring — resolves decks/mono-red-burn.md
./ritual price burn --deck

# Ambiguous across types — fails, asking you to disambiguate
./ritual add-note staples "Sol Ring" --note ramp
#   'staples' is ambiguous — it matches multiple lists:
#     - Deck: staples
#     - Collection: staples
#   Disambiguate with --deck, --collection, or --wanted.

# Disambiguated with a flag
./ritual add-note --collection staples "Sol Ring" --note ramp
```
