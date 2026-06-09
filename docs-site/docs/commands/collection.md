---
sidebar_position: 11
---

# collection

Interactively manage a collection of cards. Alias: `collect`.

## Usage

```bash
./ritual collection [options]
```

### Options

| Flag                          | Description                                               |
| ----------------------------- | --------------------------------------------------------- |
| `-s, --sets <codes>`          | Filter by set codes (comma-separated, e.g., `"FDN, SPG"`) |
| `-f, --finish <finish>`       | Default finish: `nonfoil`, `foil`, or `etched`            |
| `-c, --condition <condition>` | Default condition: `NM`, `LP`, `MP`, `HP`, or `DMG`       |
| `--collector`                 | Start in collector number mode                            |
| `--allow-digital-only-cards`  | Include digital-only sets (e.g., Alchemy) in results      |

Digital-only sets (Alchemy sets, plus `OM1`) are filtered out by default since they have no paper printings.

Options can be combined. When `--collector` is used with `--sets`, the set card data is pre-loaded automatically.

## Menu Options

The following options are always available in the menu when no search text is typed:

| Option                               | Description                                                                 |
| ------------------------------------ | --------------------------------------------------------------------------- |
| `✅ Done — Save N change(s)`         | Save the session changelog and exit                                         |
| `🚪 Exit Without Saving Changelog`   | Exit without writing the session changelog (card changes are already saved) |
| `⚙️ Configure Session Filters`       | Adjust default set codes, finish, and condition                             |
| `🔢 Switch to Collector Number Mode` | Switch to collector number entry mode                                       |
| `📦 Manage Set Codes`                | Add, remove, or switch active sets (collector mode)                         |
| `🔤 Switch to Name Mode`             | Switch back to name entry mode (collector mode)                             |
| `➕ Add Another Copy`                | Append another copy of the last added card                                  |
| `📝 Add Note`                        | Attach a note to the last added card                                        |
| `✏️ Edit Previous Card`              | Re-enter the last added card with forced prompts                            |

## Entry Modes

The collection manager supports two entry modes that you can toggle between during a session:

### Name Mode (default)

Autocomplete-driven card name entry. Type a card name and select from suggestions.

- **Session Filters** — Configure default set codes, finish, and condition via the `⚙️ Configure Session Filters` menu option. When set, these defaults are applied automatically to each card without prompting.
- **Force Prompts** — Append `!` to a card name to override finish and condition session filters for that entry, forcing the prompts to appear regardless of filter settings.
- **Edit Last Card** — Re-enter the most recently added card with forced prompts, useful for correcting mistakes.

### Collector Number Mode

Look up cards by collector number within one or more loaded sets.

- **Set Management** — Add, remove, and switch between multiple active set codes via the `📦 Manage Set Codes` menu.
- **Autocomplete** — Type a collector number prefix to filter the card list for the active set.

## Output Format

Each card entry is written to a markdown collection file in the `collections/` directory:

```
- Card Name (SET:CN) [finish] [condition] {note} &N
```

For example:

```
- Sol Ring (C19:221) [foil] [NM] &1
- Lightning Bolt (LEA:161) [NM] &2
- Mana Crypt (2XM:270) [foil] [NM] {Japanese language, ignore pricing} &3
```

Non-foil finish is omitted for brevity; the condition is always written (a "Don't Care" choice is stored as `[NM]`, matching the admin Collection Editor). The note is optional and can be added after entry via the `📝 Add Note` menu option. Notes are displayed in the card detail modal on the generated site. The `&N` suffix is a persistent card ID used internally for change tracking and is auto-assigned.

### Sections

A collection can be split into named **sections** using `## Section Name` (H2) headers beneath the `# Title`. Cards are grouped under the header that precedes them; cards before the first header (or in a section-less file) belong to an implicit **Main** section that is written out explicitly the next time the file is saved.

```
# My Binder

## Trade Binder
- Sol Ring (C19:221) [foil] [NM] &1

## Keep
- Lightning Bolt (LEA:161) &2
```

Section order is preserved as written. Cards added by this command go to the file's **last** section. On the generated site, a collection with two or more sections defaults to grouping by section, and **Section** appears as a grouping option in the toolbar. Sections are managed from the [admin Collection Editor](../admin/editors.md#sections); pricing commands ignore section headers.

## Examples

Start the collection manager:

```bash
./ritual collection
```

Pre-set condition and finish:

```bash
./ritual collect --condition NM --finish foil
```

Start in collector number mode with sets pre-loaded:

```bash
./ritual collect --collector --sets "FDN, SPG"
```

Filter by set in name mode:

```bash
./ritual collect -s "MOM, ONE" -c NM
```
