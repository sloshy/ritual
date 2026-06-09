---
sidebar_position: 1
---

# deck

Interactively build a deck by adding cards to named **sections**. This is the deck-building
counterpart to the [`collection`](./collection.md) and [`wanted`](./wanted.md) managers: it
shares the same name/collector entry modes, session filters, and menu actions, and adds
deck-specific section targeting.

## Usage

```bash
./ritual deck [options]
```

### Options

| Flag                          | Description                                                 |
| ----------------------------- | ----------------------------------------------------------- |
| `-s, --sets <codes>`          | Filter by set codes (comma-separated, e.g., `"FDN, SPG"`)   |
| `-f, --finish <finish>`       | Default finish: `nonfoil`, `foil`, or `etched`              |
| `-c, --condition <condition>` | Default condition: `NM`, `LP`, `MP`, `HP`, or `DMG`         |
| `--section <name>`            | Add every card to this section (otherwise you are prompted) |
| `--collector`                 | Start in collector number mode                              |
| `--allow-digital-only-cards`  | Include digital-only sets (e.g., Alchemy) in results        |

When `--section` is omitted, the **target section** defaults to "prompt every time": you choose
a section (or create one) for each card. You can change the target section at any time from the
menu or via `⚙️ Configure Session Filters`.

On startup you select an existing deck or create a new one. Existing decks are listed by their
display name (the `name:` front matter field), not their slugified file name, sorted
alphabetically. A new deck is created with the same YAML front matter as
[`new-deck`](./new-deck.md) (display name preserved, file name slugified, default `commander`
format).

## Menu Options

The following options are available in the menu when no search text is typed:

| Option                               | Description                                                                 |
| ------------------------------------ | --------------------------------------------------------------------------- |
| `✅ Done — Save N change(s)`         | Save the session changelog and exit                                         |
| `🚪 Exit Without Saving Changelog`   | Exit without writing the session changelog (card changes are already saved) |
| `🗂️ Set Target Section`              | Pin a section, create a new one, or prompt for each card                    |
| `⚙️ Configure Session Filters`       | Adjust default sets, finish, condition, and target section                  |
| `🔢 Switch to Collector Number Mode` | Switch to collector number entry mode                                       |
| `📦 Manage Set Codes`                | Add, remove, or switch active sets (collector mode)                         |
| `🔤 Switch to Name Mode`             | Switch back to name entry mode (collector mode)                             |
| `➕ Add Another Copy`                | Increment the quantity of the last added card                               |
| `📝 Add Note`                        | Attach a note to the last added card                                        |
| `✏️ Edit Previous Card`              | Re-pick the printing/finish/condition for the last card                     |

## Sections

Every card is added under a `## Section Name` (H2) header. The **target section** controls where
new cards land:

- **Prompt every time** (default) — you pick an existing section or create a new one per card.
- **A pinned section** — set with `--section`, the `🗂️ Set Target Section` menu, or the session
  filters. All subsequent cards go there until you change it.

Adding a card whose **printing already exists anywhere in the deck** increments that entry's
quantity instead of creating a new line (matching the admin Deck Editor and the
[`add-card`](./add-card.md) command). A different printing of the same card is kept as its own
entry.

## Entry Modes

Like the collection manager, the deck manager supports two entry modes you can toggle during a
session:

### Name Mode (default)

Autocomplete-driven card name entry. Session filters (sets, finish, condition) are applied
automatically; append `!` to a card name to force the finish/condition prompts for that entry.
If no printings can be found for a chosen card, it is added name-only rather than dropped.

### Collector Number Mode

Look up cards by collector number within one or more loaded sets, managed via `📦 Manage Set Codes`.

## Output Format

Cards are written to a markdown deck file in the `decks/` directory under their section headers:

```
---
name: "Winota Stax"
format: "commander"
---

## Commander
1 Winota, Joiner of Forces (IKO:215) &1

## Main
1 Sol Ring (LTC:284) &2
4 Lightning Bolt (LEA:161) &3
```

The leading number is the card quantity. Non-foil finish and `NM` condition are omitted for
brevity. The `&N` suffix is a persistent card ID used internally for change tracking and is
auto-assigned. Decrementing a quantity keeps the ID; only removing the whole line releases it.

## Examples

Start the deck manager:

```bash
./ritual deck
```

Add everything to a specific section without per-card prompts:

```bash
./ritual deck --section Sideboard
```

Start in collector number mode with sets pre-loaded:

```bash
./ritual deck --collector --sets "FDN, SPG"
```
