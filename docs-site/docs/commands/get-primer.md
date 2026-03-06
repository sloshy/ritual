---
sidebar_position: 15
---

# get-primer

Extract and output the primer for a deck as Markdown.

## Usage

```bash
./ritual get-primer <source>
```

## Arguments

| Argument   | Description                                                   | Required |
| ---------- | ------------------------------------------------------------- | -------- |
| `<source>` | Local deck name (e.g. `winota-snowball-stax`) or Moxfield URL | Yes      |

## Options

| Option                          | Description                                                                               |
| ------------------------------- | ----------------------------------------------------------------------------------------- |
| `--moxfield-user-agent <agent>` | Moxfield-approved unique User-Agent string (required for Moxfield URLs unless env is set) |

## Description

When given a **local deck name**, `get-primer` reads the corresponding `.primer.md` sidecar file from the `decks/` directory (e.g. `decks/winota-snowball-stax.primer.md`) and outputs it to stdout.

When given a **Moxfield URL**, `get-primer` fetches the primer content from the Moxfield API, parses it from Moxfield's custom format into Markdown, and outputs the result. This requires a valid `MOXFIELD_USER_AGENT` environment variable or the `--moxfield-user-agent` option.

The Moxfield primer format supports the following features which are transformed:

- `===panel: Heading Text` / `===endpanel` → Markdown headings (H2, H3, … based on nesting depth)
- `===accordion` / `===endaccordion` wrapper lines are stripped (collapsible section support is not currently implemented)
- `[[Card Name]]` and `[[youtube:videoId]]` tokens are preserved as-is for runtime rendering by the built site

## Examples

Output the primer for a local deck:

```bash
./ritual get-primer winota-snowball-stax
```

Fetch and parse a primer from Moxfield:

```bash
./ritual get-primer https://moxfield.com/decks/j-0aJlxuOUm9FnKRvJcfZw \
  --moxfield-user-agent "MyApp/1.0"
```

Save the parsed primer to a file:

```bash
./ritual get-primer winota-snowball-stax > primer.md
```

## Site Integration

When a deck has a primer sidecar file (`<deck>.primer.md`, written automatically by the `import` command for Moxfield decks), the built site renders it with:

- Formatted headings and a table of contents sidebar
- `[[Card Name]]` tokens rendered as clickable links that open the card detail modal
- `[[youtube:videoId]]` tokens rendered as embedded YouTube videos
