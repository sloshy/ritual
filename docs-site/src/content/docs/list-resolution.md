---
title: 'List Names'
description: How a name you type on the command line is matched to a deck, collection, or wanted list.
---

When you name a list on the command line, as in `ritual price burn` or `ritual edit "Winota Stax"`, every command matches that name the same way. This page describes the rules.

## How a name is matched

The resolver searches the existing list files and applies these rules in order:

1. **Byte-exact match.** A list whose file name equals the input character for character wins outright, before any folding. Only a trailing `.md` and surrounding whitespace are removed first. This is the escape hatch: whatever else a name might fold into, typing it exactly always selects that one list.
2. **Exact match under folding.** Case, diacritics, separators, and punctuation are ignored (see the table below). A list whose file name equals the input under those rules wins next.
3. **Unique substring match.** If nothing matches exactly, a list whose name _contains_ the input (under the same folding) is accepted, but only if exactly one does.
4. **Otherwise it is an error.** No match is a "not found" error. More than one match at the winning tier is an "ambiguous" error.

Matching is against the **file name** without its `.md` extension, not the `# Title` heading or the front matter.

### What folding ignores

Tiers 2 and 3 compare both the query and each file name in a folded form. Exactly these things are ignored:

| Folded                                                                                                                                        | Example                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Case                                                                                                                                          | `goblins` resolves `Goblins.md`                                |
| Accents and other diacritics                                                                                                                  | `cafe` resolves `Café.md`, and `Café` resolves `cafe.md`       |
| Hyphens and underscores (treated as spaces)                                                                                                   | `winota-stax` resolves `Winota Stax.md`                        |
| Repeated whitespace, and leading/trailing space                                                                                               | `mono  red` resolves `Mono Red.md`                             |
| Apostrophes `'`, `’`, `` ` ``, `ʼ`                                                                                                            | `Praetors Voice` resolves `Praetors' Voice.md`                 |
| Characters a file name cannot hold: `/ \ : * ? " < > \|`                                                                                      | `Atraxa: Praetors' Voice` resolves `Atraxa Praetors' Voice.md` |
| Everything else the [file namer](/commands/new/#list-file-names) changes: runs of dots collapse to one, leading and trailing dots are dropped | `Mono-U Tron... Redux` resolves `Mono-U Tron. Redux.md`        |

The last two rows are what make a **display name round-trip**. A list created as `Atraxa: Praetors' Voice` is stored as `Atraxa Praetors' Voice.md`, because a colon cannot be in a file name, and the name you typed at creation still finds it. Resolution folds the query through the very same function the [file namer](/commands/new/#list-file-names) uses, so the two can never disagree.

Two lists whose names differ only in folded characters (`Mono Red` and `mono-red`, or `AB.md` beside `A'B.md`) are ambiguous at tiers 2 and 3. Each is still reachable by tier 1: type its full name exactly as the file spells it. A workspace can only hold such a pair if it was created before this folding existed, since creation now refuses the second name; [`rename`](/commands/rename/) will move one of them out of the way.

### Names that would collide are refused at creation

Because folding makes `Atraxa Superfriends` and `atraxa superfriends` the same name to resolve, [`new`](/commands/new/) and [`rename`](/commands/rename/) refuse a name that folds onto a list of the same type that already exists:

```
A deck named 'Atraxa Superfriends' already exists (it matches 'atraxa superfriends' under list-name folding).
```

The refusal is a usage error (exit `2`; HTTP `409` on the admin API) and names the existing list. Renaming a list to a different spelling of **its own** name, such as fixing capitalization or dropping a colon, is not a collision and is allowed.

The same rule applies wherever a list is created: the CLI, the interactive editor's in-session list creation (including a list created earlier in the same unsaved session), [`cleanup`](/commands/cleanup/)'s renames, the [importers](/commands/import/), the admin site, the MCP `create_list`/`rename_list` tools, and collection sync.

## Type flags and disambiguation

Most commands search **all three** list types at once: `add-card`, `remove-card`, `set-card`, `note`, `edit`, `history`, `price`, `sell`, `export`, `rename`, and `delete`. A name that exists in more than one type, say a deck _and_ a collection both called `staples`, is ambiguous. Resolve it with a type flag:

| Flag           | Restricts the search to |
| -------------- | ----------------------- |
| `--deck`       | Decks                   |
| `--collection` | Collections             |
| `--wanted`     | Wanted lists            |

The flags are mutually exclusive. A `deck:`/`collection:`/`wanted:` prefix on the name itself (`collection:staples`) pins the type too, and supplies it when no flag is given. A prefix that **contradicts** the flag is a usage error (exit `2`) naming both, rather than one silently winning:

```bash
ritual delete deck:"Trade Binder" --collection
#   'deck:Trade Binder' selects a deck, which conflicts with --collection.
#   Drop the 'deck:' prefix or the --collection flag.
```

Commands that take **more than one** list cannot be scoped one argument at a time by a single whole-command flag, so the prefix is the mechanism their ambiguity errors suggest. That covers [`diff`](/commands/diff/)'s two sides, [`move`](/commands/move/)'s `--from`/`--to`, and the list arguments of [`export`](/commands/export/) and [`sell`](/commands/sell/). [`lists`](/commands/lists/) does not resolve a name at all, but accepts the same three flags to filter which types it enumerates.

Single-type commands (`deck-sync`, `collection-sync`, `get-primer`, and the CSV importer) already know their type, so they never need a flag. They match names by the same case- and accent-insensitive, substring, ambiguity-aware rules, and their ambiguity errors never suggest a type selector: they take the first row of the table below, or the second when the matching names fold together.

### What the ambiguity error advises

The error always lists every match. The remedy line under it names the mechanism the command you ran actually has:

| Situation                                                                           | Advice                                                                                                  |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| All matches are the **same type** (including single-type commands)                  | `Type more of the name to narrow the match (e.g. 'burn').`                                              |
| Matches that fold together but differ byte-wise                                     | `Type one list's exact full name, spelled and capitalized as its file is (e.g. 'Atraxa Superfriends').` |
| Matches span types, command takes type flags                                        | `Disambiguate with --deck, --collection, or --wanted.`                                                  |
| Matches span types, the name takes a type prefix (`move`, `diff`, `export`, `sell`) | `Disambiguate with a type prefix, e.g. 'deck:Storm' or 'wanted:Storm'.`                                 |
| Matches span types, the caller sends a structured type field (`POST /api/export`)   | `Set the list's type to 'deck' or 'wanted'.`                                                            |
| Matches span types, no type selector exists at all                                  | `Type more of the name to narrow the match (e.g. 'Storm').`                                             |

A type selector can never break a tie between two lists of the same type, so the same-type case always asks for a longer name. A type is only suggested when it holds exactly **one** match; pinning a type that would just produce a second ambiguity error is never offered, and when no type qualifies the error asks for a longer name instead.

The suggested example name is always one that would actually resolve. When two files fold to the same name (`Storm Crow.md` and `storm-crow.md`), a longer name would not help, so the advice asks for one list's exact full name, which the byte-exact tier honors. Only when the matches are byte-identical (the same file name under two different list types) is no example offered, because no name can break that tie.

## Examples

```bash
# Exact, case- and accent-insensitive — resolves decks/Goblins.md
ritual price goblins --deck

# Unique substring — resolves decks/mono-red-burn.md
ritual price burn --deck

# Ambiguous across types — fails, asking you to disambiguate
ritual note staples "Sol Ring" --note ramp
#   'staples' is ambiguous — it matches multiple lists:
#     - Deck: staples
#     - Collection: staples
#   Disambiguate with --deck, --collection, or --wanted.

# Disambiguated with a flag
ritual note --collection staples "Sol Ring" --note ramp

# Ambiguous within one type — no flag can help, so type more of the name
ritual edit bur
#   'bur' is ambiguous — it matches multiple lists:
#     - Deck: burn
#     - Deck: burn-red
#   Type more of the name to narrow the match (e.g. 'burn').

# Two decks that fold together — each is still reachable, exactly as spelled
ritual edit "atraxa superfriends"   # resolves decks/atraxa superfriends.md
ritual edit "Atraxa Superfriends"   # resolves decks/Atraxa Superfriends.md

# The display name round-trips, colon and all
ritual delete "Atraxa: Praetors' Voice" --confirm "Atraxa: Praetors' Voice"
```
