---
sidebar_position: 24
---

# hash

Compute and save SHA-256 hashes for all deck, collection, and wanted list files.

Ritual stores a `.sha256` sidecar file alongside each list file so that content hashes do not need to be recomputed on every request. Hashes are automatically updated whenever a file is saved through the CLI or admin UI. Use this command to recompute and persist hashes for all lists at once — for example after editing files externally or restoring from a backup.

## Usage

```bash
./ritual hash [options]
```

## Options

| Option      | Description                                           | Default |
| ----------- | ----------------------------------------------------- | ------- |
| `--dry-run` | Print computed hashes without writing `.sha256` files | `false` |

## Examples

Recompute and save hashes for all lists:

```bash
./ritual hash
```

Preview what would be written without making changes:

```bash
./ritual hash --dry-run
```

Use a custom base directory:

```bash
./ritual --base-dir /path/to/site hash
```
