---
sidebar_position: 13
---

# wanted-list

Interactively manage a wanted list of cards you're looking for. Alias: `wanted`.

## Usage

```bash
./ritual wanted-list [options]
```

### Options

| Flag                         | Description                                               |
| ---------------------------- | --------------------------------------------------------- |
| `-s, --sets <codes>`         | Filter by set codes (comma-separated, e.g., `"FDN, SPG"`) |
| `-f, --finish <finish>`      | Default finish: `nonfoil`, `foil`, or `etched`            |
| `--collector`                | Start in collector number mode                            |
| `--allow-digital-only-cards` | Include digital-only sets (e.g., Alchemy) in results      |

Digital-only sets (Alchemy sets, plus `OM1`) are filtered out by default since they have no paper printings.

Unlike the `collection` command, there is no `--condition` option — wanted lists track desired cards, not owned cards.

## Card States

Each card on a wanted list exists in one of three states, which determines how pricing works:

| State               | Format                          | Pricing Behavior                              |
| ------------------- | ------------------------------- | --------------------------------------------- |
| **Name only**       | `- Card Name`                   | Uses cheapest printing across all sets        |
| **Printing**        | `- Card Name (SET:CN)`          | Uses cheapest _finish_ of that exact printing |
| **Fully specified** | `- Card Name (SET:CN) [finish]` | Uses the exact printing and finish specified  |

When adding a card, you are prompted to choose the specificity level:

1. **Name only (cheapest printing)** — skips printing and finish selection entirely
2. **Choose specific printing** — enters the printing selection flow, then optionally choose a finish

## Menu Options

The following options are always available in the menu when no search text is typed:

| Option                               | Description                                         |
| ------------------------------------ | --------------------------------------------------- |
| `✅ Done — Save N addition(s)`       | Save the session changelog and exit                 |
| `🚪 Exit Without Saving`             | Exit without writing the session changelog          |
| `⚙️ Configure Session Filters`       | Adjust default set codes and finish                 |
| `🔢 Switch to Collector Number Mode` | Switch to collector number entry mode               |
| `📦 Manage Set Codes`                | Add, remove, or switch active sets (collector mode) |
| `🔤 Switch to Name Mode`             | Switch back to name entry mode (collector mode)     |
| `➕ Add Another Copy`                | Append another copy of the last added card          |
| `📝 Add Note`                        | Attach a note to the last added card                |
| `✏️ Edit Previous Card`              | Re-enter the last added card with forced prompts    |

## Entry Modes

The wanted list manager supports two entry modes that you can toggle between during a session:

### Name Mode (default)

Autocomplete-driven card name entry. Type a card name and select from suggestions.

- **Session Filters** — Configure default set codes and finish via the `⚙️ Configure Session Filters` menu option. When set, these defaults are applied automatically to each card without prompting.
- **Force Prompts** — Append `!` to a card name to override finish session filters for that entry, forcing the prompts to appear regardless of filter settings.
- **Edit Last Card** — Re-enter the most recently added card with forced prompts, useful for correcting mistakes.

### Collector Number Mode

Look up cards by collector number within one or more loaded sets.

- **Set Management** — Add, remove, and switch between multiple active set codes via the `📦 Manage Set Codes` menu.
- **Autocomplete** — Type a collector number prefix to filter the card list for the active set.

## Output Format

Each card entry is written to a markdown file in the `wanted/` directory:

```
- Card Name (SET:CN) [finish] {note} &N
```

For example:

```
- Sol Ring &1
- Lightning Bolt (LEA:161) &2
- Mana Crypt (2XM:270) [foil] &3
- Black Lotus (LEB:233) [nonfoil] {birthday present to self} &4
```

Any combination of set/collector number and finish can be omitted depending on the desired specificity level. The note is optional. The `&N` suffix is a persistent card ID used internally for change tracking and is auto-assigned.

### Sections

A wanted list can be split into named **sections** using `## Section Name` (H2) headers beneath the `# Title`. Cards are grouped under the header that precedes them; cards before the first header (or in a section-less file) belong to an implicit **Main** section that is written out explicitly the next time the file is saved.

```
# Wanted

## High Priority
- Queen Marchesa &1

## Someday
- Mana Crypt (2XM:270) [foil] &2
```

Section order is preserved as written. On the generated site, a wanted list with two or more sections defaults to grouping by section, and **Section** appears as a grouping option in the toolbar. Sections are managed from the [admin Wanted List Editor](../admin/editors.md#sections); pricing commands ignore section headers.

## Examples

Start the wanted list manager:

```bash
./ritual wanted-list
```

Pre-set finish:

```bash
./ritual wanted --finish foil
```

Start in collector number mode with sets pre-loaded:

```bash
./ritual wanted --collector --sets "FDN, SPG"
```

Filter by set in name mode:

```bash
./ritual wanted -s "MOM, ONE"
```
