---
title: 'migrate'
---

Bring a workspace up to date after upgrading Ritual. `migrate` applies the one-time **migrations** a newer Ritual needs (config keys removed or renamed, files moved) and **refreshes the files Ritual generates** for a site set up with [`init-site`](/commands/init-site/): the deploy workflow, the `.gitignore` entries, and the installed [agent skills](/commands/skills/).

## Usage

```bash
ritual migrate [options]
```

| Option          | Description                                                                            |
| --------------- | -------------------------------------------------------------------------------------- |
| `-y, --yes`     | Apply without asking for confirmation                                                  |
| `-n, --dry-run` | Print what would change and write nothing                                              |
| `--check`       | Write nothing; exit `4` when updates are pending and `0` when the workspace is current |

`migrate` first prints its plan, then asks before applying it:

```
Pending workspace updates:
Migration 1: Remove site.version from ritual.config.json (the managed block replaces it)
  remove site.version from ritual.config.json
Refresh generated files:
  write .github/workflows/deploy-site.yml
  add dist/, .dist-build-* to .gitignore
  overwrite agent skill ritual-site
? Apply these updates? (Y/n)
```

When nothing is pending it prints `This workspace is already up to date; nothing to do.` and exits `0`. A directory without a `ritual.config.json` has nothing to migrate and also exits `0`.

## Previewing and scripting

- `--dry-run` prints the same plan, then `Dry run: nothing was written.`, and exits `0`.
- `--check` prints nothing when the workspace is current (exit `0`). When updates are pending, it prints one line telling you to run `ritual migrate` and exits `4`, a code of its own, so a script or CI job can tell an out-of-date workspace from a failure. `--check` cannot be combined with `--yes` or `--dry-run`.
- When prompts are unavailable (see [When prompts are unavailable](/cli-conventions/#when-prompts-are-unavailable)), applying needs `--yes`. Without it the run is a usage error (exit `2`) and nothing is written.

## What gets migrated

### Numbered migrations

Each migration is a numbered, one-time change. `migrate` records the highest one applied as `managed.migration` in `ritual.config.json` (see [the `managed` block](/configuration/#ritual-bookkeeping-managed-key)). Every migration checks the workspace itself rather than trusting that counter, so one whose change is already in place does nothing.

| Migration | What it does                                                                                        |
| --------- | --------------------------------------------------------------------------------------------------- |
| 1         | Removes `site.version`. The `managed` block replaced it as the record of what set up the workspace. |

The counter is written after each migration that changed something, so a run that fails part-way resumes at the failed migration next time.

`migrate` reads `ritual.config.json` without the usual validation, because a migration's job is to fix keys the current Ritual no longer accepts. The migrated result is validated **before anything is written**. If it would still be invalid, `migrate` stops with the validation error and changes nothing. Fix the file and run it again.

### Generated files

For a workspace set up with `init-site`, `migrate` compares a hash of what this Ritual would generate with `managed.output`. When they differ, the refresh:

- rewrites the deploy workflow when it differs from what this Ritual generates (GitHub Actions only),
- appends any missing `.gitignore` entries (existing lines are never removed),
- **overwrites every installed Ritual agent skill** with the current version (local edits to them are not kept), and deletes installed Ritual skills that this version no longer ships.

Skills you never installed stay uninstalled, and skill folders Ritual did not write are left alone.

## A workspace from a newer Ritual

A newer Ritual may already have updated the workspace: `managed.migration` is higher than any migration this build knows, or, on a release build, `managed.version` names a newer release than the one running. `migrate` refuses (exit `1`) rather than move the workspace backwards, and names the release to install when one was recorded:

```
This workspace was last updated by a newer Ritual (0.3.0). Install Ritual 0.3.0 or newer and try again.
```

`init-site` refuses such a workspace the same way.

## Development builds

Only a release build (one built by Ritual's release workflow, exactly at a release tag) records itself as `managed.version`. Any other build, including a local or Docker build, can apply migrations but leaves `managed.version` unchanged, and warns that a CI build pinned to that release will not know those migrations.

## Not an MCP tool

Workspace migration is maintenance, like logging in. It is deliberately not exposed through the [MCP server](/commands/mcp/). Agents drive it through the CLI: see the `ritual-site` [skill](/commands/skills/), which runs `--check` or `--dry-run` first and asks before applying.

If `ritual.config.json` changes between planning and applying (another process wrote it while the prompt was open), `migrate` stops without writing anything; run it again.

## Exit codes

| Code | Meaning                                                                                                                            |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Updates applied, nothing pending, no config file, or a `--dry-run`                                                                 |
| `1`  | The workspace was updated by a newer Ritual, the migrated config would be invalid, the config changed mid-run, or a write failed   |
| `2`  | The prompt was declined, applying needed `--yes` when prompts were unavailable, or `--check` was combined with `--yes`/`--dry-run` |
| `4`  | `--check` found pending updates                                                                                                    |
