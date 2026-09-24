---
title: 'skills'
---

Install [Claude Code agent skills](https://docs.claude.com/en/docs/claude-code/skills) that teach AI agents how to drive Ritual from a local workspace. Each skill is a `SKILL.md` file (YAML frontmatter plus Markdown) covering one slice of the CLI. An agent loads a skill when its description matches the task.

This is the CLI-driven counterpart to [`mcp`](/commands/mcp/). `ritual mcp` exposes Ritual to MCP clients as tool calls; the skills teach an agent to run the `ritual` CLI directly. That suits a coding agent working in the git repository that holds your lists.

## Usage

```bash
ritual skills install [names...] [options]
ritual skills update [names...] [options]
ritual skills list [options]
```

## How installed files are tracked

Every skill Ritual writes carries two extra frontmatter keys after `name` and `description`:

- `ritual-version`: the Ritual version that wrote the file.
- `ritual-content-hash`: a SHA-256 digest of the file's name, description, and body (excluding the marker lines).

Claude Code reads only `name` and `description`, so the markers do not affect loading. Ritual uses them to classify each file:

- **Machine-managed**: the stored hash matches the content. Ritual wrote it and nobody edited it. Safe to rewrite on a version change.
- **User-edited**: the hash does not match, or the markers are missing. `install` and `update` leave these alone unless you pass `--force`.
- **Absent**: no file at the skill's path.

## Subcommands

### `install`

Write skills into a `.claude/skills/<name>/SKILL.md` tree. With no names, every skill is installed.

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

The global `--base-dir <path>` option sets the default project directory when `--dir` is omitted.

Each skill reports one status:

- `written`: the file was missing, or was a machine-managed copy from another version and was rewritten.
- `up-to-date`: a machine-managed copy at the current version already exists. Nothing was written.
- `skipped`: the file has local edits and was left alone. `--force` overwrites it (your edits are lost).

`--output json` prints one report object instead of text lines (`ndjson` emits the same object on one line). Paths are absolute:

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

Errors (such as an unknown skill name) go to stderr, as a structured `{ "error": ... }` envelope in `json`/`ndjson` mode, and the command exits `2`.

### `update`

Refresh already-installed skills to the current Ritual version. Unlike `install`, `update` never adds a skill that is not present. With no names, every installed skill is refreshed.

```bash
ritual skills update                       # refresh every installed skill
ritual skills update ritual-decks         # refresh a single skill
ritual skills update --global             # refresh the ~/.claude/skills installs
ritual skills update --force              # also overwrite user-edited skill files
```

`update` takes the same options as `install` (`--global`, `--dir <path>`, `-f, --force`, `--output <format>`, `--quiet`) and reports the same statuses plus one more:

- `written`: a machine-managed install from another version was rewritten.
- `up-to-date`: the install already matches the current version.
- `skipped`: the file has local edits. Pass `--force` to overwrite it.
- `absent`: the skill is not installed (use `install` to add it).

The JSON report has the same `{ skillsDir, results }` shape as `install`.

### `list`

Print the available skills and their descriptions without installing anything.

```bash
ritual skills list
```

| Option              | Description                                | Default |
| ------------------- | ------------------------------------------ | ------- |
| `--output <format>` | Output format: `text`, `json`, or `ndjson` | `text`  |

`list` has no `--quiet`: the skill list is its entire output, and `--quiet` never suppresses a payload ([shared convention](/cli-conventions/#scripting)). Redirect stdout if you want silence.

With `--output json` each skill is one `{ name, description }` object (`ndjson` emits one object per line):

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

| Skill                | Covers                                                                                                                                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ritual`             | Overview, workspace layout, file format, global options (including `--locale`), the `ritual locale` command and its `--detect` probe, and setup.                                                                      |
| `ritual-decks`       | Create, import, sync, and price decks.                                                                                                                                                                                |
| `ritual-collections` | Manage collections, sync them with Archidekt, price them, and check them against Card Kingdom's buylist.                                                                                                              |
| `ritual-wanted`      | Manage and price wanted lists.                                                                                                                                                                                        |
| `ritual-edit`        | Card edits across any list: non-interactive commands, applying exported change bundles, card exports (CSV, JSON, plain text, Markdown), and the unified interactive editor.                                           |
| `ritual-cards`       | Card lookup and Scryfall searches.                                                                                                                                                                                    |
| `ritual-site`        | Build, serve, and administer the site (including its `--locale` / `--locales` / `--locale-file` language flags), wire up the CI publishing pipeline (cache keys, changelog change detection), and run the MCP server. |

## Skill content is always English

Installed `SKILL.md` files are never translated, whatever your [UI locale](/localization/). They are model-facing prose full of CLI flags, file paths, and tool names, and a per-locale copy would make every installed skill look user-edited to the content hash. The command's own status lines and errors do follow your UI locale. The file content, and the `description` that `skills list --output json` reports, do not.

## Keeping skills current

Skill content is generated from the CLI, so installed copies go stale when you upgrade Ritual. Run `ritual skills update` after upgrading (`--global` for a `~/.claude/skills` install). Machine-managed installs are rewritten, edited files are preserved unless you add `--force`, and skills you never installed stay absent.

If your repository was set up with [`ritual init-site`](/commands/init-site/), upgrading it also refreshes installed skills with the same rules (see below).

## Installing during `init-site`

[`ritual init-site`](/commands/init-site/) offers to install these skills when it scaffolds a repository. Answer the prompt, or pass `--skills` / `--no-skills` to decide without prompting.

When you re-run `init-site` to upgrade a repository, it refreshes already-installed skills without adding skills you never installed or overwriting files you edited (those are reported as skipped, with a pointer to `ritual skills update --force`). Use `--no-skills` to skip this, or `--skills` to (re)install the full set.

## See also

- [`init-site`](/commands/init-site/) — scaffolds a repository for publishing and can install these skills.
- [`mcp`](/commands/mcp/) — expose the same operations to MCP-native agents as tool calls.
- [`admin`](/commands/admin/) — the browser-based editor for the same lists.
- [Localization](/localization/) — what follows the UI locale, and what (skill content included) never does.
