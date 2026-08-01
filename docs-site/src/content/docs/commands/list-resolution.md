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
- Hyphens and underscores are treated as spaces, so a list is found whichever way its name is punctuated: `winota-stax` resolves `Winota Stax.md`, and `Black Panther` resolves a `black-panther.md` left over from before list files were [named as entered](/commands/new/#list-file-names).

Two lists whose names differ only in punctuation (`Mono Red` and `mono-red`) are reported as ambiguous rather than silently picked between.

## Type flags and disambiguation

Type-agnostic commands (`add-card`, `remove-card`, `set-card`, `note`, `edit`, `history`, `price`, `export`, `rename`, `delete`) search **all three** list types at once. A name that exists in more than one type — say a deck _and_ a collection both called `staples` — is ambiguous. Resolve it with a type flag:

| Flag           | Restricts the search to |
| -------------- | ----------------------- |
| `--deck`       | Decks                   |
| `--collection` | Collections             |
| `--wanted`     | Wanted lists            |

The flags are mutually exclusive. A `deck:`/`collection:`/`wanted:` prefix on the name itself (e.g. `collection:staples`) pins the type too, and overrides the flag. Commands that take **more than one** list — [`diff`](/commands/diff/)'s two sides, [`move`](/commands/move/)'s `--from`/`--to`, and [`export`](/commands/export/)'s list arguments — can't be scoped one argument at a time by a single whole-command flag, so the prefix is the mechanism their ambiguity errors suggest. [`lists`](/commands/lists/) doesn't resolve a name at all, but accepts the same three flags to filter which types it enumerates.

Single-type commands (`deck-sync`, `collection-sync`, `get-primer`) already know their type, so they never need a flag — but they match names by the same case- and accent-insensitive, substring, ambiguity-aware rules.

### What the ambiguity error advises

The error always lists every match; the remedy line under it names the mechanism the command you ran actually has:

| Situation                                                                         | Advice                                                                  |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| All matches are the **same type** (including single-type commands)                | `Type more of the name to narrow the match (e.g. 'burn').`              |
| Matches span types, command takes type flags                                      | `Disambiguate with --deck, --collection, or --wanted.`                  |
| Matches span types, the name takes a type prefix (`move`, `diff`, `export`)       | `Disambiguate with a type prefix, e.g. 'deck:Storm' or 'wanted:Storm'.` |
| Matches span types, the caller sends a structured type field (`POST /api/export`) | `Set the list's type to 'deck' or 'wanted'.`                            |
| Matches span types, no type selector exists at all                                | `Type more of the name to narrow the match (e.g. 'Storm').`             |

A type selector can never break a tie between two lists of the same type, so the same-type case always asks for a longer name. A type is only suggested when it holds exactly **one** match — pinning a type that would just produce a second ambiguity error is never offered, and when no type qualifies the error asks for a longer name instead. The suggested example name is likewise always one that would actually resolve; when two files normalize to the same name (`Storm Crow.md` and `storm-crow.md`) no example is offered, because typing either one hits the same ambiguity.

Single-type commands (`get-primer`, the sync engines, the CSV importer) resolve within one type, so their ambiguities are always same-type and always take the first row.

## Examples

```bash
# Exact, case- and accent-insensitive — resolves decks/Goblins.md
./ritual price goblins --deck

# Unique substring — resolves decks/mono-red-burn.md
./ritual price burn --deck

# Ambiguous across types — fails, asking you to disambiguate
./ritual note staples "Sol Ring" --note ramp
#   'staples' is ambiguous — it matches multiple lists:
#     - Deck: staples
#     - Collection: staples
#   Disambiguate with --deck, --collection, or --wanted.

# Disambiguated with a flag
./ritual note --collection staples "Sol Ring" --note ramp

# Ambiguous within one type — no flag can help, so type more of the name
./ritual edit bur
#   'bur' is ambiguous — it matches multiple lists:
#     - Deck: burn
#     - Deck: burn-red
#   Type more of the name to narrow the match (e.g. 'burn').
```
