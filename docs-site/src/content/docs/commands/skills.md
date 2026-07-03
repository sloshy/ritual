---
title: 'skills'
---

Install [Claude Code agent skills](https://docs.claude.com/en/docs/claude-code/skills) that
teach AI agents how to drive Ritual from a local workspace. Each skill is a `SKILL.md` file
(YAML frontmatter + Markdown) describing a slice of the CLI; an agent loads a skill when its
description matches the task at hand.

This is the **CLI-driven** counterpart to the [`mcp`](/commands/mcp/) command: where `ritual mcp`
exposes Ritual to MCP-native clients as tool calls, the skills teach an agent to run the
`ritual` CLI directly — useful when you keep your decks, collections, and wanted lists in a
local git repository and want your coding agent to work with them.

## Usage

```bash
ritual skills install [names...] [options]
ritual skills list
```

## Subcommands

### `install`

Write the skills into a `.claude/skills/<name>/SKILL.md` tree. With no names, every skill is
installed; otherwise only the named skills are.

```bash
ritual skills install                      # install all skills into ./.claude/skills
ritual skills install ritual-decks         # install a single skill
ritual skills install --global             # install into ~/.claude/skills
ritual skills install --dir ../my-repo     # target another project directory
ritual skills install --force              # overwrite existing skill files
```

| Option         | Description                                                      | Default      |
| -------------- | ---------------------------------------------------------------- | ------------ |
| `--global`     | Install into `~/.claude/skills` instead of the project directory |              |
| `--dir <path>` | Project directory that should contain `.claude/skills`           | the base dir |
| `-f, --force`  | Overwrite skill files that already exist                         | `false`      |

Existing files are left untouched (and reported as skipped) unless `--force` is given, so
re-installing never clobbers local edits without consent. The global `--base-dir <path>`
option sets the default project directory when `--dir` is omitted.

### `list`

Print the available skills and their descriptions without installing anything.

```bash
ritual skills list
```

## The skills

| Skill                | Covers                                                                                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `ritual`             | Overview, workspace layout, file format, global options, and setup.                                                         |
| `ritual-decks`       | Create, import, sync, and price decks.                                                                                      |
| `ritual-collections` | Manage and price collections.                                                                                               |
| `ritual-wanted`      | Manage and price wanted lists.                                                                                              |
| `ritual-edit`        | Card edits across any list: non-interactive commands, applying exported change bundles, and the unified interactive editor. |
| `ritual-cards`       | Card lookup and Scryfall searches.                                                                                          |
| `ritual-site`        | Build, serve, and administer the site, plus the MCP server.                                                                 |

## Keeping skills current

The skill content is generated from the CLI, so re-run `ritual skills install --force` after
upgrading Ritual to refresh the installed copies with the latest commands and flags. If your
repository was set up with [`ritual init-site`](/commands/init-site/), upgrading it also refreshes any
installed skills automatically (see below).

## Installing during `init-site`

When you scaffold a repository for publishing with [`ritual init-site`](/commands/init-site/), it offers to
install these skills for you — answer the prompt, or pass `--skills` / `--no-skills` to decide without
prompting. This is the easiest way to make sure a freshly initialized repository ships with the skills
its agents need.

When you later re-run `init-site` to upgrade the repository to a newer Ritual version, it also
**refreshes any already-installed skills** so they track the new version (without introducing skills you
never installed). Use `--no-skills` to skip that, or `--skills` to (re)install the full set.

## See also

- [`init-site`](/commands/init-site/) — scaffolds a repository for publishing and can install these skills.
- [`mcp`](/commands/mcp/) — expose the same operations to MCP-native agents as tool calls.
- [`admin`](/commands/admin/) — the browser-based editor for the same lists.
