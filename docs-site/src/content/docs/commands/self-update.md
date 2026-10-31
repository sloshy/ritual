---
title: 'ritual self-update'
description: 'Update Ritual to a newer release, or check whether one exists.'
sidebar:
  label: 'self-update'
---

Replace the running Ritual binary with a newer release from GitHub. `self-update` downloads the compressed binary for your platform, checks it against the release's published SHA-256 checksum, unpacks it, runs it once to confirm it reports the expected version, and only then swaps it into place. Ritual never updates itself on its own; this command is the only way it does.

## Usage

```bash
ritual self-update [options]
```

| Option         | Description                                                                           |
| -------------- | ------------------------------------------------------------------------------------- |
| `--prerelease` | Include prereleases when looking for the newest release                               |
| `--stable`     | Only consider stable releases                                                         |
| `--tag <tag>`  | Install this exact release (`v1.2.0` or `1.2.0`), even one older than the running one |
| `--check`      | Write nothing; exit `4` when an update is available and `0` when up to date           |
| `-y, --yes`    | Install without asking for confirmation                                               |

`--prerelease`, `--stable` and `--tag` cannot be combined with one another, and `--check` cannot be combined with `--yes`.

```
$ ritual self-update
? Update Ritual 0.2.0 → 0.3.0? (Y/n) yes
Downloading Ritual v0.3.0…
✓ Updated Ritual 0.2.0 → 0.3.0 (/home/you/.local/bin/ritual)
```

When nothing newer exists it prints `Ritual 0.3.0 is up to date (the newest release on this channel is 0.3.0).` and exits `0`.

## Channels

By default, `self-update` follows the **channel of the build you are running**: a prerelease build (such as `0.3.0-beta2`) looks for the newest release including prereleases, and a stable build looks only at stable releases. `--prerelease` and `--stable` switch channels for one run; after that, the installed build's own channel applies again.

- **Stable** reads GitHub's "latest release". While no stable release exists (or GitHub's latest release is marked as a prerelease), the stable channel refuses with exit `3` and suggests `--prerelease`.
- **Prerelease** picks the highest version among the 30 most recently published releases, stable or not. Drafts are never installed.

## Installing a specific release

`--tag <tag>` installs exactly that release, newer or older. (It is not `--version`: `ritual --version` always prints the running version, wherever it appears on the command line.) Use it to match the release a workspace is [pinned to](/commands/migrate/#the-ci-pin), or the one a [newer-workspace warning](/commands/migrate/#a-workspace-from-a-newer-ritual) names:

```bash
ritual self-update --tag v0.3.0
```

Installing an older release asks `Downgrade Ritual 0.3.0 → 0.2.0?` instead (default no). Naming the release that is already running prints `Ritual 0.3.0 is already installed.` and changes nothing.

## Checking without installing

`--check` looks up the release a run would install and reports it without downloading anything:

```
$ ritual self-update --check
Ritual 0.3.0 is available (installed: 0.2.0).
```

It exits `4` when an update is available (with `--tag`, whenever that release differs from the running one, older or newer; the same "updates pending" code [`migrate --check`](/commands/migrate/#previewing-and-scripting) uses) and `0` when up to date, so a script can test for updates. `--check` never prompts. When `--tag` names an older release, the line says so instead:

```
$ ritual self-update --check --tag v0.2.0
Ritual 0.2.0 is older than the installed 0.3.0; installing it would downgrade 0.3.0 → 0.2.0.
```

## What happens when it installs

1. The release's `.sha256` file for your platform's archive (`ritual-linux-x86_64.tar.gz`, `ritual-macos-arm64.tar.gz`, `ritual-windows-x86_64.zip`, …) is downloaded first. A release without the archive for your platform, or without its checksum file, is refused before anything is written. Releases before 0.1.0-rc4 published only uncompressed binaries, so `self-update --tag` cannot install them.
2. The archive is downloaded into memory. It must match the size GitHub lists and the published checksum, which covers the archive file itself; a download that runs past the listed size is cut off. Only then is it unpacked: it must hold exactly one file, a regular file named `ritual` (`ritual.exe` on Windows). Anything else (another file, a directory, a link, a path such as `../ritual`) is refused, so nothing the archive names is ever written, and a damaged archive is caught by the tarball's header checksums or the zip's CRC-32.
3. The binary is written to a temporary file next to the current one (`.ritual.<random>.new`), flushed to disk, and given the current binary's permissions.
4. The new binary is run once with `--version`, from a temporary directory, and must report exactly the release's version.
5. It replaces the current binary. On macOS and Linux this is a single atomic rename. Windows cannot overwrite a running program, so the current binary is renamed to `ritual.exe.old` first and the new one takes its name; the next Ritual run deletes the `.old` file. If an earlier `ritual.exe.old` is still running (a `ritual serve` started before the last update), the current binary steps aside to `ritual.exe.<random>.old` instead, and later runs delete every such file once it is no longer in use. Ctrl+C is ignored for the moment the two renames take.

If any step fails, the temporary file is deleted and the current Ritual is left exactly as it was. When the executable is a symbolic link (for example `~/.local/bin/ritual` pointing elsewhere), the file it points to is replaced and the link stays. A temporary file left by an interrupted run (Ctrl+C while the new binary is being written) is removed by the next `self-update` once it is an hour old.

On Windows, if the new binary cannot take the old one's name and the old one cannot be moved back either (rare; usually antivirus holding a file), `self-update` keeps both and says where they are. Rename either one to `ritual.exe` to recover.

Without a terminal (see [When prompts are unavailable](/cli-conventions/#when-prompts-are-unavailable)), installing needs `--yes`. Without it the run is a usage error (exit `2`) and nothing is downloaded.

## After an update: workspace changes

A newer Ritual may have [migrations or regenerated files](/commands/migrate/) for your workspace, and only the new release knows what they are. So when you run `self-update` in a directory with a `ritual.config.json` (or with `--base-dir` pointing at one), the newly installed Ritual runs `ritual migrate --dry-run` right away and prints its plan. Nothing is applied: run `ritual migrate` when you are ready, then commit `ritual.config.json` so CI builds with the new release. If the new binary cannot be started for the preview, or the preview fails, `self-update` prints a warning and still succeeds; run `ritual migrate --dry-run` yourself.

## Update notice

A release build tells you when a newer release is out. After a command's own output, it prints one line on stderr:

```
Ritual 0.3.0 is available (you have 0.2.0). Run `ritual self-update` to update.
```

The notice only informs; nothing is installed until you run `self-update`. It follows the same [channel](#channels) `self-update` would, and appears **at most once a day per release**: a newer release than the one last announced is shown right away.

The answer comes from a small cache in the per-user [state file](/commands/migrate/#when-ritual-offers-to-migrate) (its `updateCheck` section). Whether a notice shows is decided from that cache, never from how fast the network is:

- When the cache is more than a day old (or was filled for the other channel), Ritual looks up the newest release on GitHub **while your command runs**. If the answer arrives before the command finishes, the cache is updated and this run's notice uses it. Otherwise the lookup is abandoned when the command finishes; it never delays the command or its exit. A lookup gives up after 5 seconds.
- A lookup that fails is not retried for an hour, so an offline machine does not try on every command. One abandoned because the command finished first is retried after 10 minutes, so a later, longer command can catch the answer. Failures are silent.
- [`serve`](/commands/serve/) and [`admin`](/commands/admin/) keep running, so they (but not subcommands such as `admin setup`) print the notice at startup from the cache alone and refresh the cache in the background for next time. The refresh is cancelled if the server fails to start.

Lookups use the same GitHub API as `self-update` (including `GITHUB_TOKEN`, see [GitHub API limits](#github-api-limits)). There is no notice, and no lookup at all, when:

- the build is not a release (`bun run`, a local build) or runs in the [Docker image](/docker/);
- `RITUAL_NO_UPDATE_CHECK` is set (`1`, `true`, …; `0`/`false`/`no`/`off` count as unset, as for [`RITUAL_NO_INPUT`](/cli-conventions/#--no-input));
- the workspace sets [`updateCheck: false`](/configuration/#update-check) (`ritual config set updateCheck false`);
- the `CI` environment variable is set, or stderr is not a terminal;
- the command writes `--output json`, `ndjson`, or `csv`, or runs with `--quiet`;
- the command is `self-update`, `mcp`, `help`, or [`doctor`](/commands/doctor/) (which reports the last check's answer instead).

The notice never changes a command's exit code. A command that fails (exit `1`–`3`) still gets it; only one that crashes outright does not.

## When `self-update` refuses

| Situation                                                                         | Exit | What to do instead                                                                                                     |
| --------------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------- |
| Ritual is not a release binary (run with `bun run`, or built locally from source) | `2`  | Install a release with the [installer](/start/install/), or pull and rebuild your checkout.                            |
| Ritual runs inside its [Docker image](/docker/)                                   | `2`  | Pull the newer image (`docker pull ghcr.io/sloshy/ritual`). The image sets `RITUAL_INSTALL=docker`, which this checks. |
| The directory holding the binary is not writable                                  | `1`  | Re-run with permission to write there, or reinstall with the installer.                                                |
| No release binary exists for your operating system or CPU                         | `1`  | Build from source.                                                                                                     |

`self-update --check` is refused in the same cases except the read-only directory: a non-release build has no release version to compare against, and inside Docker the image is what you update.

## GitHub API limits

Release lookups use GitHub's public API, which allows a limited number of anonymous requests per hour. If you hit the limit, `self-update` says so; wait, or set the `GITHUB_TOKEN` environment variable to a GitHub token and Ritual sends it with its API requests (only those: the binary downloads are public and never carry it). An authenticated request follows redirects only within `api.github.com`; a redirect anywhere else is refused (exit `1`) rather than forward the token. A lookup that gets no answer within 30 seconds, or a download that takes over 10 minutes, fails with exit `1`.

## Not an MCP tool

Replacing the Ritual binary is maintenance, like logging in or migrating a workspace. It is deliberately not exposed through the [MCP server](/commands/mcp/). Agents using the [skills](/commands/skills/) check with `ritual self-update --check` and ask before installing.

`self-update` also skips the [pending-updates check](/commands/migrate/#when-ritual-offers-to-migrate) other commands run, since it previews the new release's own plan afterwards.

## Exit codes

| Code | Meaning                                                                                                                                                                                                                                                                                             |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Updated, already up to date, or the named release is already installed                                                                                                                                                                                                                              |
| `1`  | The download, verification, unpacking, or swap failed (nothing was changed); the release has no archive or checksum for this platform (as for any release before 0.1.0-rc4); no binary exists for this OS/CPU; GitHub could not be reached or answered with an error; or the directory is read-only |
| `2`  | Not a release build, inside Docker, the prompt was declined, `--yes` was needed, a bad `--tag`, or conflicting flags                                                                                                                                                                                |
| `3`  | No release matches: no stable release yet, no release published at all (prerelease channel), or no release has the `--tag` tag                                                                                                                                                                      |
| `4`  | `--check` found an update                                                                                                                                                                                                                                                                           |
