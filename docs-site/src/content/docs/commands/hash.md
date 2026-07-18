---
title: 'hash'
---

Compute and save SHA-256 hashes for all deck, collection, and wanted list files.

Ritual stores a `.sha256` sidecar file alongside each list file so that content hashes do not need to be recomputed on every request. Hashes are automatically updated whenever a file is saved through the CLI or admin UI. Use this command to recompute and persist hashes for all lists at once — for example after editing files externally or restoring from a backup.

## Usage

```bash
./ritual hash [options]
```

## Options

| Option              | Description                                           | Default |
| ------------------- | ----------------------------------------------------- | ------- |
| `-n, --dry-run`     | Print computed hashes without writing `.sha256` files | `false` |
| `--output <format>` | Output format: `text`, `json`, or `ndjson`            | `text`  |
| `--quiet`           | Suppress the per-file hash lines and summary          | `false` |

## Scripted Output

With `--output json` (or `ndjson`), stdout carries only the payload: an array
with one entry per hashed list file. File paths are absolute. The shape is the
same under `--dry-run` — only the sidecar writes are skipped.

```json
[
  {
    "file": "/path/to/site/decks/Winota Stax.md",
    "hash": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
  },
  {
    "file": "/path/to/site/collections/Binder.md",
    "hash": "60303ae22b998861bce3b28f33eec1be758a213c86c93c076dbe9f558c11c752"
  }
]
```

In text mode, `--quiet` suppresses all output — the hashes are still written,
so scripts can rely on the exit code alone.

## Exit Codes

| Code | Meaning                                                    |
| ---- | ---------------------------------------------------------- |
| `0`  | Hashes computed (and written) successfully                 |
| `1`  | Runtime error (e.g. a list read or a sidecar write failed) |
| `2`  | Usage error (e.g. an invalid `--output` format)            |

## Examples

Recompute and save hashes for all lists:

```bash
./ritual hash
```

Preview what would be written without making changes:

```bash
./ritual hash --dry-run
```

Emit the hashes as JSON for scripting:

```bash
./ritual hash --output json
```

Use a custom base directory:

```bash
./ritual --base-dir /path/to/site hash
```
