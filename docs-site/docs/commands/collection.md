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
- Lightning Bolt (LEA:161) &2
- Mana Crypt (2XM:270) [foil] [NM] {Japanese language, ignore pricing} &3
```

Non-foil finish and no-preference condition are omitted for brevity. The note is optional and can be added after entry via the `📝 Add Note` menu option. Notes are displayed in the card detail modal on the generated site. The `&N` suffix is a persistent card ID used internally for change tracking and is auto-assigned.

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
