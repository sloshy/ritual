---
title: 'dep-license'
---

Show the license for a dependency bundled with Ritual.

Without a package name, the command opens an interactive list of every bundled dependency. Primary dependencies (direct entries in `package.json`) come first, then transitive ones. Type to search both sections.

## Usage

```bash
ritual dep-license [package] [options]
```

## Arguments

| Argument    | Description                                    |
| ----------- | ---------------------------------------------- |
| `[package]` | Name of the package to display the license for |

## Options

| Option              | Description                                                | Default |
| ------------------- | ---------------------------------------------------------- | ------- |
| `--list`            | List every bundled dependency with its version and license | `false` |
| `--plain`           | Output license text directly to stdout                     | `false` |
| `--output <format>` | Output format for `--list`: `text`, `json`, or `ndjson`    | `text`  |

There is no `--quiet`: the listing or license text is the command's entire output ([shared convention](/cli-conventions/#scripting)).

Rules:

- `--list` cannot be combined with a package name. It never prompts, so it works outside a TTY.
- With neither a package name nor `--list`, the command needs to open the picker. If it cannot (stdout is not a TTY, or [prompts are unavailable](/cli-conventions/#when-prompts-are-unavailable), including `--no-input`), that is a usage error (exit `2`).
- A named package's license is paged like [`license`](/commands/license/): `less` when both ends are a terminal and prompts are available, plain stdout otherwise.

## Examples

Open the interactive dependency picker:

```bash
ritual dep-license
```

View a specific package license directly:

```bash
ritual dep-license commander
```

View a scoped package license:

```bash
ritual dep-license prompts
```

Print a license to stdout:

```bash
ritual dep-license prompts --plain
```

List every dependency (primary first, then transitive) as `name version license` lines:

```bash
ritual dep-license --list
```

```text
Primary:
  commander 15.0.0 MIT
  prompts 2.4.2 MIT
Transitive:
  kleur 3.0.3 MIT
```

## Scripted Output

`--list --output json` emits one `{ name, version, license, isPrimary }` object per dependency (`ndjson` emits one object per line). The full license text is not included; run `ritual dep-license <package>` for it.

```bash
ritual dep-license --list --output json
```

```json
[
  { "name": "commander", "version": "15.0.0", "license": "MIT", "isPrimary": true },
  { "name": "kleur", "version": "3.0.3", "license": "MIT", "isPrimary": false }
]
```

## Exit Codes

| Code | Meaning                                                                                                                                                            |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `0`  | Success                                                                                                                                                            |
| `2`  | Usage error (no package name and no `--list` when [prompts are unavailable](/cli-conventions/#when-prompts-are-unavailable) or stdout is not a TTY, or both given) |
| `3`  | Package not found                                                                                                                                                  |
