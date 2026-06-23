---
title: 'List Resolution'
---

Every command that loads a deck, collection, or wanted list by name resolves that name the same way. This page is the single reference for that shared behavior.

## How a name is matched

Given a name, the resolver searches existing list files and applies these rules in order:

1. **Case- and accent-insensitive exact match.** A list whose file name equals the input (ignoring case and diacritics, and ignoring a trailing `.md`) wins outright.
2. **Unique substring match.** If nothing matches exactly, a list whose name _contains_ the input (again ignoring case and diacritics) is accepted — but only if exactly one does.
3. **Otherwise it is an error.** No match is a "not found" error; more than one match at the winning tier is an "ambiguous" error.

Matching is performed against the **file name** (without the `.md` extension), not the human-facing title in front matter or the markdown heading.

Accented letters are folded to their plain forms before matching, so `cafe` resolves a list named `Café` and vice versa.

## Type flags and disambiguation

Type-agnostic commands (`add-card`, `add-note`, `clear-note`, `history`) search **all three** list types at once. A name that exists in more than one type — say a deck _and_ a collection both called `staples` — is ambiguous. Resolve it with a type flag:

| Flag           | Restricts the search to |
| -------------- | ----------------------- |
| `--deck`       | Decks                   |
| `--collection` | Collections             |
| `--wanted`     | Wanted lists            |

The flags are mutually exclusive. Single-type commands (`price-deck`, `price-collection`, `price-wanted-list`, `deck-sync`, `get-primer`) already know their type, so they never need a flag — but they match names by the same case- and accent-insensitive, substring, ambiguity-aware rules.

## Examples

```bash
# Exact, case- and accent-insensitive — resolves decks/Goblins.md
./ritual price-deck goblins

# Unique substring — resolves decks/mono-red-burn.md
./ritual price-deck burn

# Ambiguous across types — fails, asking you to disambiguate
./ritual add-note staples "Sol Ring" --note ramp
#   'staples' is ambiguous — it matches multiple lists:
#     - Deck: staples
#     - Collection: staples
#   Disambiguate with --deck, --collection, or --wanted.

# Disambiguated with a flag
./ritual add-note --collection staples "Sol Ring" --note ramp
```
