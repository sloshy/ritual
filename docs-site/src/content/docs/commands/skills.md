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
ritual skills update [names...] [options]
ritual skills list [options]
```

## How installed files are tracked

Every skill Ritual writes carries two extra frontmatter keys after `name` and `description`:

- `ritual-version` — the Ritual version that wrote the file.
- `ritual-content-hash` — a SHA-256 digest of the file's name, description, and body
  (the marker lines themselves are excluded).

Claude Code only reads `name` and `description`, so the markers don't affect how agents load
the skill. Ritual uses them to tell three kinds of files apart:

- **Machine-managed** — the stored hash matches the file's content: Ritual wrote it and
  nobody edited it since. Safe to rewrite when the version changes.
- **User-edited** — the hash doesn't match (or the markers are missing): you customized the
  file, or it predates the markers. `install` and `update` leave these untouched unless you
  pass `--force`.
- **Absent** — no file at the skill's path.

## Subcommands

### `install`

Write the skills into a `.claude/skills/<name>/SKILL.md` tree. With no names, every skill is
installed; otherwise only the named skills are.

```bash
ritual skills install                      # install all skills into ./.claude/skills
ritual skills install ritual-decks         # install a single skill
ritual skills install --global             # install into ~/.claude/skills
ritual skills install --dir ../my-repo     # target another project directory
ritual skills install --force              # overwrite even user-edited skill files
```

| Option              | Description                                                | Default      |
| ------------------- | ---------------------------------------------------------- | ------------ |
| `--global`          | Target `~/.claude/skills` instead of the project directory |              |
| `--dir <path>`      | Project directory that should contain `.claude/skills`     | the base dir |
| `-f, --force`       | Overwrite skill files even when they have local edits      | `false`      |
| `--output <format>` | Output format: `text`, `json`, or `ndjson`                 | `text`       |
| `--quiet`           | Suppress the per-skill and summary lines in text mode      | `false`      |

Each skill reports one of three statuses:

- `written` — the file was missing, or was a machine-managed copy from another Ritual
  version and got rewritten.
- `up-to-date` — a machine-managed copy at the current version is already installed;
  nothing was written.
- `skipped` — the file has local edits and was left untouched. Pass `--force` to overwrite
  it with the current version (your edits are lost).

The global `--base-dir <path>` option sets the default project directory when `--dir` is
omitted.

With `--output json` the command prints a single report object instead of the text lines
(`--output ndjson` emits the same object on one line). Paths are absolute, and `status` is
`written`, `up-to-date`, or `skipped`:

```bash
ritual skills install ritual-decks --output json
```

```json
{
  "skillsDir": "/home/me/mtg/.claude/skills",
  "results": [
    {
      "name": "ritual-decks",
      "path": "/home/me/mtg/.claude/skills/ritual-decks/SKILL.md",
      "status": "written"
    }
  ]
}
```

Errors (such as an unknown skill name) go to stderr — as a structured `{ "error": ... }`
envelope in `json`/`ndjson` mode — and the command exits `2`.

### `update`

Refresh already-installed skills to the current Ritual version. Unlike `install`, `update`
never adds a skill that isn't present: a skill without an installed file is reported as
`absent` and left uninstalled. With no names, every installed skill is refreshed.

```bash
ritual skills update                       # refresh every installed skill
ritual skills update ritual-decks         # refresh a single skill
ritual skills update --global             # refresh the ~/.claude/skills installs
ritual skills update --force              # also overwrite user-edited skill files
```

`update` takes the same options as `install` (`--global`, `--dir <path>`, `-f, --force`,
`--output <format>`, `--quiet`) and reports the same statuses plus `absent`:

- `written` — a machine-managed install from another version was rewritten.
- `up-to-date` — the install already matches the current version.
- `skipped` — the file has local edits; pass `--force` to overwrite it.
- `absent` — the skill is not installed (use `install` to add it).

The JSON report has the same `{ skillsDir, results }` shape as `install`.

### `list`

Print the available skills and their descriptions without installing anything.

```bash
ritual skills list
```

| Option              | Description                                | Default |
| ------------------- | ------------------------------------------ | ------- |
| `--output <format>` | Output format: `text`, `json`, or `ndjson` | `text`  |

`list` deliberately has **no `--quiet`**: its entire output is the skill list itself, and the [shared convention](/#scripting-conventions) is that `--quiet` never suppresses the payload — so there would be nothing for the flag to do. Redirect stdout if you want silence.

With `--output json` each skill is one `{ name, description }` object
(`ndjson` emits the same rows one object per line):

```bash
ritual skills list --output json
```

```json
[
  {
    "name": "ritual-decks",
    "description": "Create, import, sync, and price Magic: The Gathering decks with the ritual CLI..."
  }
]
```

## The skills

| Skill                | Covers                                                                                                                                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ritual`             | Overview, workspace layout, file format, global options, and setup.                                                                                                         |
| `ritual-decks`       | Create, import, sync, and price decks.                                                                                                                                      |
| `ritual-collections` | Manage collections, sync them with Archidekt, price them, and check them against Card Kingdom's buylist.                                                                    |
| `ritual-wanted`      | Manage and price wanted lists.                                                                                                                                              |
| `ritual-edit`        | Card edits across any list: non-interactive commands, applying exported change bundles, card exports (CSV, JSON, plain text, Markdown), and the unified interactive editor. |
| `ritual-cards`       | Card lookup and Scryfall searches.                                                                                                                                          |
| `ritual-site`        | Build, serve, and administer the site, wire up the CI publishing pipeline (cache keys, changelog change detection), and run the MCP server.                                 |

## Keeping skills current

The skill content is generated from the CLI, so installed copies go stale when you upgrade
Ritual. Run `ritual skills update` after upgrading to refresh them: machine-managed installs
from an older version are rewritten, files you edited are preserved (add `--force` to
overwrite those too), and skills you never installed stay absent. Use
`ritual skills update --global` to refresh a `~/.claude/skills` install.

If your repository was set up with [`ritual init-site`](/commands/init-site/), upgrading it
also refreshes any installed skills automatically with the same rules (see below).

## Installing during `init-site`

When you scaffold a repository for publishing with [`ritual init-site`](/commands/init-site/), it offers to
install these skills for you — answer the prompt, or pass `--skills` / `--no-skills` to decide without
prompting. This is the easiest way to make sure a freshly initialized repository ships with the skills
its agents need.

When you later re-run `init-site` to upgrade the repository to a newer Ritual version, it also
**refreshes any already-installed skills** so they track the new version — without introducing skills you
never installed, and without overwriting skill files you edited (it reports those as skipped and points
at `ritual skills update --force`). Use `--no-skills` to skip that, or `--skills` to (re)install the
full set.

## See also

- [`init-site`](/commands/init-site/) — scaffolds a repository for publishing and can install these skills.
- [`mcp`](/commands/mcp/) — expose the same operations to MCP-native agents as tool calls.
- [`admin`](/commands/admin/) — the browser-based editor for the same lists.
