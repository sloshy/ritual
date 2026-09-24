---
title: 'license'
---

Display the Ritual project license (AGPLv3).

## Usage

```bash
ritual license [options]
```

## Options

| Option    | Description                            |
| --------- | -------------------------------------- |
| `--plain` | Output license text directly to stdout |

## Examples

View the license in an interactive pager (press `q` or `ESC` to exit):

```bash
ritual license
```

The pager opens only when it can run interactively. If stdout is not a terminal, or [prompts are unavailable](/cli-conventions/#when-prompts-are-unavailable) (`--no-input` / `RITUAL_NO_INPUT`, or stdin is not a terminal), the text goes straight to stdout as if you had passed `--plain`.

Print the license text to stdout (useful for piping or scripting):

```bash
ritual license --plain
```

Save the license to a file:

```bash
ritual license --plain > LICENSE.txt
```
