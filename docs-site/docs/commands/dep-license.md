---
sidebar_position: 21
---

# dep-license

Show the license for a dependency bundled with Ritual.

Without a package name, opens an interactive list showing all bundled dependencies. Primary dependencies (direct entries in `package.json`) are listed first, followed by transitive dependencies. Type to search and filter across both sections.

## Usage

```bash
./ritual dep-license [package] [options]
```

## Arguments

| Argument    | Description                                    |
| ----------- | ---------------------------------------------- |
| `[package]` | Name of the package to display the license for |

## Options

| Option    | Description                            |
| --------- | -------------------------------------- |
| `--plain` | Output license text directly to stdout |

## Examples

Open the interactive dependency picker:

```bash
./ritual dep-license
```

View a specific package license directly:

```bash
./ritual dep-license commander
```

View a scoped package license:

```bash
./ritual dep-license @tailwindcss/cli
```

Print a license to stdout:

```bash
./ritual dep-license prompts --plain
```
