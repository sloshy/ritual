---
title: 'dep-license'
---

Show the license for a dependency bundled with Ritual.

Without a package name, it opens an interactive list of all bundled dependencies. Primary dependencies (direct entries in `package.json`) are listed first, followed by transitive dependencies. Type to search and filter across both sections.

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

The listing (or a package's license text) is the command's entire output, so there is no `--quiet` ([shared convention](/cli-conventions/#scripting)).

`--list` cannot be combined with a package name argument. It never prompts, so it also works outside a TTY. Without either a package name or `--list`, an invocation that cannot open the picker is a usage error (exit `2`). That covers a non-TTY stdout and every case where [prompts are unavailable](/cli-conventions/#when-prompts-are-unavailable), including `--no-input`.

A license printed for a named package is paged the same way [`license`](/commands/license/) is: `less` only when both ends are a terminal and prompts are available, plain stdout otherwise.

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

`--list --output json` emits one `{ name, version, license, isPrimary }` object per dependency (`ndjson` emits the same rows one object per line). The payload excludes the full license text, which is large. Run `ritual dep-license <package>` to see a package's complete license text.

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
