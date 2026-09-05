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

A local deck name is matched case- and accent-insensitively, with a unique-substring fallback. An ambiguous name is rejected. See [List Names](/list-resolution/).

## Options

| Option                          | Description                                                                               |
| ------------------------------- | ----------------------------------------------------------------------------------------- |
| `--moxfield-user-agent <agent>` | Moxfield-approved unique User-Agent string (required for Moxfield URLs unless env is set) |

## Description

Given a **local deck name**, `get-primer` reads the deck's `.primer.md` sidecar from the `decks/` directory (for example `decks/winota-snowball-stax.primer.md`) and prints it to stdout.

Given a **Moxfield URL**, `get-primer` fetches the primer from the Moxfield API, converts it from Moxfield's custom format into markdown, and prints the result. This requires a valid `MOXFIELD_USER_AGENT` environment variable or the `--moxfield-user-agent` option.

The conversion handles these Moxfield features:

- `===panel: Heading Text` / `===endpanel` become markdown headings (H2, H3, … based on nesting depth).
- `===accordion` / `===endaccordion` wrapper lines are stripped. Collapsible sections are not currently implemented.
- `[[Card Name]]` and `[[youtube:videoId]]` tokens are preserved as-is, for the built site to render.

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

A deck with no primer is a **missing resource**, not a failure. It exits `3`, so a script can tell "this deck has no primer" from "fetching the primer broke".

## Site Integration

When a deck has a primer sidecar (`<deck>.primer.md`, written automatically by the `import` command for Moxfield decks), the built site renders it with:

- Formatted headings and a table of contents sidebar
- `[[Card Name]]` tokens rendered as clickable links that open the card detail modal
- `[[youtube:videoId]]` tokens rendered as embedded YouTube videos
