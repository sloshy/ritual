---
title: 'get-primer'
---

Print a deck's primer as markdown, from a local deck or a Moxfield URL.

## Usage

```bash
ritual get-primer <source>
```

## Arguments

| Argument   | Description                                                   | Required |
| ---------- | ------------------------------------------------------------- | -------- |
| `<source>` | Local deck name (e.g. `winota-snowball-stax`) or Moxfield URL | Yes      |

Local deck names resolve as described in [List Names](/list-resolution/). An ambiguous name is rejected.

## Options

| Option                          | Description                                                                               |
| ------------------------------- | ----------------------------------------------------------------------------------------- |
| `--moxfield-user-agent <agent>` | Moxfield-approved unique User-Agent string (required for Moxfield URLs unless env is set) |

## Description

For a **local deck name**, the command reads the deck's `.primer.md` file from `decks/` (for example `decks/winota-snowball-stax.primer.md`) and prints it to stdout.

For a **Moxfield URL**, it fetches the primer from the Moxfield API, converts it to markdown, and prints the result. This needs the `MOXFIELD_USER_AGENT` environment variable or the `--moxfield-user-agent` option.

The conversion handles these Moxfield features:

- `===panel: Heading Text` / `===endpanel` become markdown headings (H2, H3, … by nesting depth).
- `===accordion` / `===endaccordion` wrapper lines are stripped. Collapsible sections are not implemented.
- `[[Card Name]]` and `[[youtube:videoId]]` tokens are kept as-is for the built site to render.

## Examples

Print the primer for a local deck:

```bash
ritual get-primer winota-snowball-stax
```

Fetch and convert a primer from Moxfield:

```bash
ritual get-primer https://moxfield.com/decks/j-0aJlxuOUm9FnKRvJcfZw \
  --moxfield-user-agent "MyApp/1.0"
```

Save the primer to a file:

```bash
ritual get-primer winota-snowball-stax > primer.md
```

## Exit Codes

| Code | Meaning                                                                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | The primer was printed                                                                                                                      |
| `1`  | Runtime error (the Moxfield request failed, or the deck file could not be read)                                                             |
| `2`  | Usage error (an ambiguous deck name, or a Moxfield URL with no user agent configured)                                                       |
| `3`  | Not found — no deck matched the name, the local deck has no primer (its `.primer.md` sidecar is absent), or the Moxfield deck has no primer |

A deck with no primer is a missing resource, not a failure, so it exits `3`. A script can tell "no primer" from "fetching broke".

## Site Integration

When a deck has a primer file (`<deck>.primer.md`, written automatically by `import` for Moxfield decks), the built site renders it with:

- Formatted headings and a table of contents sidebar
- `[[Card Name]]` tokens as clickable links that open the card detail modal
- `[[youtube:videoId]]` tokens as embedded YouTube videos
