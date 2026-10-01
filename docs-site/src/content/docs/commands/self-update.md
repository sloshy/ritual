---
title: 'self-update'
---

Replace the running Ritual binary with a newer release from GitHub. `self-update` downloads the binary for your platform, checks it against the release's published SHA-256 checksum, runs it once to confirm it reports the expected version, and only then swaps it into place. Ritual never updates itself on its own; this command is the only way it does.

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

1. The release's `.sha256` file for your platform's binary (`ritual-linux-x86_64`, `ritual-macos-arm64`, `ritual-windows-x86_64.exe`, …) is downloaded first. A release without a binary for your platform, or without its checksum file, is refused before anything is written.
2. The binary is downloaded straight into a temporary file next to the current one (`.ritual.<random>.new`). The download must match the size GitHub lists and the published checksum; a download that runs past the listed size is cut off. The file is flushed to disk and given the current binary's permissions.
3. The new binary is run once with `--version`, from a temporary directory, and must report exactly the release's version.
4. It replaces the current binary. On macOS and Linux this is a single atomic rename. Windows cannot overwrite a running program, so the current binary is renamed to `ritual.exe.old` first and the new one takes its name; the next Ritual run deletes the `.old` file. If an earlier `ritual.exe.old` is still running (a `ritual serve` started before the last update), the current binary steps aside to `ritual.exe.<random>.old` instead, and later runs delete every such file once it is no longer in use. Ctrl+C is ignored for the moment the two renames take.

If any step fails, the temporary file is deleted and the current Ritual is left exactly as it was. When the executable is a symbolic link (for example `~/.local/bin/ritual` pointing elsewhere), the file it points to is replaced and the link stays. A temporary file left by an interrupted run (Ctrl+C during the download) is removed by the next `self-update` once it is an hour old.

On Windows, if the new binary cannot take the old one's name and the old one cannot be moved back either (rare; usually antivirus holding a file), `self-update` keeps both and says where they are. Rename either one to `ritual.exe` to recover.

Without a terminal (see [When prompts are unavailable](/cli-conventions/#when-prompts-are-unavailable)), installing needs `--yes`. Without it the run is a usage error (exit `2`) and nothing is downloaded.

## After an update: workspace changes

A newer Ritual may have [migrations or regenerated files](/commands/migrate/) for your workspace, and only the new release knows what they are. So when you run `self-update` in a directory with a `ritual.config.json` (or with `--base-dir` pointing at one), the newly installed Ritual runs `ritual migrate --dry-run` right away and prints its plan. Nothing is applied: run `ritual migrate` when you are ready, then commit `ritual.config.json` so CI builds with the new release. If the new binary cannot be started for the preview, or the preview fails, `self-update` prints a warning and still succeeds; run `ritual migrate --dry-run` yourself.

## When `self-update` refuses

| Situation                                                                         | Exit | What to do instead                                                                                                     |
| --------------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------- |
| Ritual is not a release binary (run with `bun run`, or built locally from source) | `2`  | Install a release with the [installer](/#installation), or pull and rebuild your checkout.                             |
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

| Code | Meaning                                                                                                                                                                                                                                           |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Updated, already up to date, or the named release is already installed                                                                                                                                                                            |
| `1`  | The download, verification, or swap failed (nothing was changed); the release has no binary or checksum for this platform; no binary exists for this OS/CPU; GitHub could not be reached or answered with an error; or the directory is read-only |
| `2`  | Not a release build, inside Docker, the prompt was declined, `--yes` was needed, a bad `--tag`, or conflicting flags                                                                                                                              |
| `3`  | No release matches: no stable release yet, no release published at all (prerelease channel), or no release has the `--tag` tag                                                                                                                    |
| `4`  | `--check` found an update                                                                                                                                                                                                                         |
