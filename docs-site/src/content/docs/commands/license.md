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

The pager only opens when it can be driven interactively. When stdout is not a terminal, or [prompts are unavailable](/cli-conventions/#when-prompts-are-unavailable) (`--no-input` / `RITUAL_NO_INPUT`, or stdin is not a terminal), the text is printed straight to stdout as if `--plain` were passed, instead of blocking in `less`.

Print the license text to stdout (useful for piping or scripting):

```bash
ritual license --plain
```

Save the license to a file:

```bash
ritual license --plain > LICENSE.txt
```
