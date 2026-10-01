---
title: 'migrate'
---

Bring a workspace up to date after upgrading Ritual (for example with [`ritual self-update`](/commands/self-update/), which previews this command's plan right after installing). `migrate` applies the one-time **migrations** a newer Ritual needs (config keys removed or renamed, files moved), **refreshes the files Ritual generates** for a site set up with [`init-site`](/commands/init-site/) (the deploy workflow, the `.gitignore` entries, and the installed [agent skills](/commands/skills/)), and, on a release build, moves the [CI pin](#the-ci-pin) to the running release.

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
Pin CI to Ritual 0.3.0 (was 0.2.0)
? Apply these updates? (Y/n)
```

When nothing is pending it prints `This workspace is already up to date; nothing to do.` and exits `0`. A directory without a `ritual.config.json` has nothing to migrate and also exits `0`.

## Previewing and scripting

- `--dry-run` prints the same plan, then `Dry run: nothing was written.`, and exits `0`.
- `--check` prints nothing when the workspace is current (exit `0`). When updates are pending, it prints one line telling you to run `ritual migrate` and exits `4`, a code of its own, so a script or CI job can tell an out-of-date workspace from a failure. `--check` cannot be combined with `--yes` or `--dry-run`.
- When prompts are unavailable (see [When prompts are unavailable](/cli-conventions/#when-prompts-are-unavailable)), applying needs `--yes`. Without it the run is a usage error (exit `2`) and nothing is written.

## When Ritual offers to migrate

You rarely need to remember `migrate`. Before every other command, Ritual checks whether the workspace has pending updates. When nothing is pending, the check reads only `ritual.config.json`, so it costs nothing noticeable. When updates are pending:

- **In an interactive terminal**, Ritual prints the same plan and asks ``Run `ritual migrate` now?``. Yes applies it exactly as `ritual migrate --yes` would, then your command runs against the updated workspace. If applying fails, Ritual reports the error the way `ritual migrate` would and still runs your command; run `ritual migrate` again to finish. No leaves the workspace alone and runs your command. Either way, Ritual asks **at most once a day per workspace**; commands in the next 24 hours only print the one-line notice below.
- **Otherwise**, it prints one line to stderr and runs the command:

  ```
  This workspace has pending updates. Run `ritual migrate --dry-run` to see them, then `ritual migrate` to apply them.
  ```

  "Otherwise" means prompts are unavailable (no terminal, or `--no-input` / `RITUAL_NO_INPUT`; see [When prompts are unavailable](/cli-conventions/#when-prompts-are-unavailable)), stdout is not a terminal, the command writes `--output json`, `ndjson`, or `csv`, it is a `--dry-run`, `--yes` was passed (the run is meant to be unattended), or the `CI` environment variable is set (`CI=false` and the other off spellings count as unset). When `ritual.config.json` also loads with warnings that the updates fix, the line says so. When the updates cannot be applied because the migrated config would be invalid, Ritual prints only the notice, even in a terminal; `ritual migrate` explains what to fix.

A workspace [from a newer Ritual](#a-workspace-from-a-newer-ritual) gets a one-line warning on stderr instead, naming the release to install with [`ritual self-update --tag`](/commands/self-update/#installing-a-specific-release) when one was recorded. The command still runs: CI pinned to an older release, for example, keeps building a workspace that a development build migrated further.

The notice and the warning never change a command's exit code, and nothing in the workspace is written unless you answer yes. `migrate`, `self-update`, `init-site`, `config` (all its subcommands), `help`, `mcp`, and `detect-changes` (which must see the workspace exactly as committed) skip the check entirely, as does a directory with no `ritual.config.json`.

The once-a-day memory lives in a small per-user state file, not in the workspace:

| Platform | State file                                                                                    |
| -------- | --------------------------------------------------------------------------------------------- |
| Linux    | `$XDG_STATE_HOME/ritual/state.json`, or `~/.local/state/ritual/state.json` when that is unset |
| macOS    | `~/Library/Application Support/ritual/state.json`                                             |
| Windows  | `%LOCALAPPDATA%\ritual\state.json`, or `~\AppData\Local\ritual\state.json` when that is unset |

Set `RITUAL_STATE_DIR` to use another directory. Deleting the file is harmless: Ritual just asks again. If the file cannot be read or written, the command runs anyway.

## What gets migrated

### Numbered migrations

Each migration is a numbered, one-time change. `migrate` records the highest one applied as `managed.migration` in `ritual.config.json` (see [the `managed` block](/configuration/#ritual-bookkeeping-managed-key)). Every migration checks the workspace itself rather than trusting that counter, so one whose change is already in place does nothing.

| Migration | What it does                                                                                        |
| --------- | --------------------------------------------------------------------------------------------------- |
| 1         | Removes `site.version`. The `managed` block replaced it as the record of what set up the workspace. |
| 2         | Removes `site.prerelease`. The deploy workflow now downloads the [pinned release](#the-ci-pin).     |

The counter is written after each migration that changed something, so a run that fails part-way resumes at the failed migration next time.

`migrate` reads `ritual.config.json` without the usual validation, because a migration's job is to fix keys the current Ritual no longer accepts. The migrated result is validated **before anything is written**. If it would still be invalid, `migrate` stops with the validation error and changes nothing. Fix the file and run it again.

### Generated files

For a workspace set up with `init-site`, `migrate` compares a hash of what this Ritual would generate with `managed.output`. When they differ, the refresh:

- rewrites the deploy workflow when it differs from what this Ritual generates (GitHub Actions only),
- appends any missing `.gitignore` entries (existing lines are never removed),
- **overwrites every installed Ritual agent skill** with the current version (local edits to them are not kept), and deletes installed Ritual skills that this version no longer ships.

Skills you never installed stay uninstalled, and skill folders Ritual did not write are left alone.

### The CI pin

`managed.version` is the release a ["Publish for me"](/commands/init-site/#the-pinned-ritual-release-github-actions) workflow downloads. For such a workspace, running a release **newer than the pin** (or a release when there is no pin yet) is pending work on its own, even when no migration or generated file changed: the plan shows `Pin CI to Ritual <new> (was <old>)` (or `(no release pinned yet)`), `--check` exits `4`, and applying only updates `managed.version`. Commit `ritual.config.json` afterwards, and CI builds with the new release from the next push.

Other workspaces (local-build, manual, or no `init-site`) run no Ritual in CI, so a newer release is not reported as pending for them. Their pin is still updated whenever `migrate` runs for another reason. A development build never moves the pin (see [Development builds](#development-builds)).

## A workspace from a newer Ritual

A newer Ritual may already have updated the workspace: `managed.migration` is higher than any migration this build knows, or, on a release build, `managed.version` names a newer release than the one running. `migrate` refuses (exit `1`) rather than move the workspace backwards, and names the release to install when one was recorded:

```
This workspace was last updated by a newer Ritual (0.3.0). Run `ritual self-update --tag 0.3.0` and try again.
```

When no release was recorded (a development build migrated the workspace), the message suggests plain [`ritual self-update`](/commands/self-update/) instead.

`init-site` refuses such a workspace the same way. Other commands [only warn](#when-ritual-offers-to-migrate).

## Development builds

Only a release build (one built by Ritual's release workflow, exactly at a release tag) records itself as `managed.version`. Any other build, including a local or Docker build, can apply migrations but leaves `managed.version` unchanged. When it applies a migration, it warns that CI keeps building with the pinned release, which does not know those migrations (or, when there is no pin, with the newest release: the latest stable one, or the newest prerelease while no stable release exists). Run `migrate` again with a release build and commit to move the pin.

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
