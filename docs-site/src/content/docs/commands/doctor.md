---
title: 'doctor'
---

Check your Ritual setup and print a short report you can paste into a bug report: which Ritual is running, the workspace, its configuration and pending updates, the card cache, and the last update check. Each check is `ok`, `warn` or `fail`, and a check that found something to do says how to fix it in one line.

`doctor` only reads. It never writes a file, refreshes the cache, or makes a network call, and it runs even when `ritual.config.json` is broken (which every other command refuses).

## Usage

```bash
ritual doctor [options]
```

## Options

| Option                          | Description                               |
| ------------------------------- | ----------------------------------------- |
| `--output <text\|json\|ndjson>` | Output format (default `text`); see below |

## What it checks

| Check          | What it reports                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Ritual**     | Version, whether it is a release or a development build, how it runs (installed binary, from source, or the [Docker image](/docker/)), the platform, and the Bun runtime version                                                                                                                                                                                                                                                                                         |
| **Workspace**  | The base directory and how many decks, collections and wanted lists it holds. A folder with no `decks/`, `collections/` or `wanted/` folder and no `ritual.config.json` is a `warn`: Ritual is probably running in the wrong folder (pass [`--base-dir`](/cli-conventions/#--base-dir))                                                                                                                                                                                  |
| **Config**     | Whether `ritual.config.json` is valid. Every setting the strict validator refuses is listed (Ritual uses each one's default instead, and refuses to publish a site while the `site` block is invalid), and a file that is not JSON is reported with the parser's reason. Either is a `fail`; a missing file is fine                                                                                                                                                      |
| **Migrations** | What [`ritual migrate --check`](/commands/migrate/#previewing-and-scripting) would find: pending workspace updates (`warn`), a workspace a newer Ritual already updated (`warn`), or updates that would leave an invalid config (`fail`). Skipped (`warn`) when `ritual.config.json` cannot be read, or when the config's own invalid settings are what the migrated config would trip on — fix the config first. A check that could not run is a `warn` that says why   |
| **Cache**      | Where the [card cache](/commands/cache/#where-the-cache-lives) lives, how many cards it holds and when it was last refreshed. A cache that cannot be read, an empty cache, a cache that has never had a full refresh, prices older than a day, a cache built for another `defaultLanguage`, or a workspace's old `cache/` folder awaiting `ritual migrate` is a `warn`. With a [cache server](/commands/cache/) configured, `doctor` names it without asking it anything |
| **Update**     | The answer of the last [update check](/commands/self-update/#update-notice): a newer release (`warn`), up to date, no check yet, checks turned off (`updateCheck: false` or `RITUAL_NO_UPDATE_CHECK`), or not applicable (a development build, or the Docker image, whose summary names the `docker pull` command). Read from Ritual's state file, never looked up                                                                                                       |

Paths under your home folder are shown as `~/…` in the text report, so it can be pasted into a public issue as it is. No login, token or account name is ever part of it.

## Output

```text
ok    Ritual 0.1.0 (release build, installed binary) on linux x64, Bun 1.4.4
ok    Workspace ~/mtg: 12 decks, 2 collections, 1 wanted list
fail  ritual.config.json has 1 invalid setting
      - updateCheck: "updateCheck" must be a boolean
      Fix: Ritual uses the default instead of each one, and will not publish a site with an invalid site block: correct them in ritual.config.json, or reset one with `ritual config unset <key>`.
ok    The workspace is up to date with this Ritual
warn  The card cache at ~/.cache/ritual holds 31240 cards, refreshed 2 days, 5 hours ago, so its prices are out of date
      Fix: Run `ritual cache preload-all` to refresh it.
ok    Up to date as of the last update check, 3 hours, 12 minutes ago

Paste this into a bug report: https://github.com/sloshy/ritual/issues
```

`--output json` prints the same report as one JSON document: the facts each check read (`ritual`, `workspace`, `config`, `migrations`, `cache`, `update`, with absolute paths), the verdicts as `checks` (each with `id`, `status`, `summary`, `hint` and `details`, every text an English `message`, plus its `messageKey`/`messageParams` when it has a catalog entry), and `ok`. `cache.status` is the [`cache status`](/commands/cache/) report, or `null` with a cache server or when the cache could not be read (`cache.problem` then says why, and the cache check is a `warn`). The same report is [`GET /api/doctor`](/admin/api/site/#setup-diagnostics) on the admin server and the [`get_diagnostics`](/commands/mcp/) MCP tool.

## Exit codes

`doctor` exits `1` when any check is a `fail`, and `0` otherwise, warnings included.

## Reporting a bug

The bug-report form on the issue tracker asks for the `ritual doctor` output: run it in the workspace where the problem happens and paste the text report.

When Ritual fails in a way it did not anticipate (a bug, not a refusal such as an unknown list or a bad flag), it prints the error and one more line:

```text
undefined is not an object (evaluating 'card.name')
This looks like a bug in Ritual. Run the command again with RITUAL_DEBUG=1 for details, and please report it at https://github.com/sloshy/ritual/issues
```

Run the command again with `RITUAL_DEBUG=1` to print the full stack trace (and the failure that caused it, if any) instead of the bare message, and include it in the report. A released binary carries its source map, so the trace names Ritual's source files. Under `--output json`, the [error envelope](/cli-conventions/#--output-always-means-the-scripting-format) says the same as data: `details.kind` is `bug` or `environment`, `details.issuesUrl` is the tracker, and `RITUAL_DEBUG` adds the trace as `details.stack`.

A failure of the machine around Ritual, such as a permission denied or a refused network connection, prints only its message: it is not a Ritual bug.

A build made from a fork with `RITUAL_SOURCE_URL` set points both the line above and `doctor` at the fork's own issue tracker.
