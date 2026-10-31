---
title: 'Upgrading'
description: 'How to update Ritual, what happens to your workspace when you do, and how to pin the version your site builds with.'
sidebar:
  order: 2
---

Ritual is updated often. This page covers how to update it and what happens to your lists when you do.

## What "0.x" means

Ritual's version number starts with `0.`. Until 1.0, **any release may change** a command, a flag, an output format, an [MCP tool](/commands/mcp/) or a site setting. Each change that needs something from you, such as a renamed flag in a script, says so in the [changelog](/reference/changelog/).

**Your data is the exception.** Your decks, collections, wanted lists, their change histories and your `ritual.config.json` always carry forward from one version to the next. When a release changes how one of those files is written, it brings a [migration](#migrations) that updates your files for you.

## Updating Ritual

Run [`ritual self-update`](/commands/self-update/). It downloads the newest release for your computer, checks it, and replaces the running program:

```bash
ritual self-update          # update to the newest release
ritual self-update --check  # only say whether there is one
```

A release build also tells you, at most once a day, when a newer release is out. It only tells you; nothing is installed until you run `self-update`. See [Update notice](/commands/self-update/#update-notice), including how to turn it off.

If you run a prerelease (a version such as `0.2.0-rc1`), `self-update` keeps you on prereleases. `ritual self-update --stable` goes back to stable releases.

In Docker, pull the newer image instead (see [Docker](/docker/#updating)). If you built Ritual from source, pull and rebuild.

### Release downloads from 0.1.0 on

From 0.1.0, each release publishes every binary compressed (`ritual-linux-x86_64.tar.gz`, `ritual-windows-x86_64.zip`, …), which `self-update`, the install scripts and the generated deploy workflow download. The bare binaries (`ritual-linux-x86_64`, `ritual-windows-x86_64.exe`, …) are still published beside them, because a Ritual from before 0.1.0 (a `0.1.0-rc` build) updates itself by downloading those: `self-update` from such a build keeps working. A later 0.x release may stop publishing the bare binaries, and its changelog will say so; update to 0.1.0 or newer before then. A "Publish for me" deploy workflow keeps working as it is. Run `ritual migrate` and commit the refreshed workflow, which downloads the archive (and still the bare binary for a pinned release from before 0.1.0), before the bare binaries stop being published.

## Migrations

A **migration** is a one-time change a newer Ritual makes to a workspace: a setting renamed in `ritual.config.json`, or a file moved. Each one is numbered and runs once.

Right after `self-update`, Ritual shows the plan for the workspace you are in. Later, any command you run in a workspace with pending changes asks once a day whether to apply them. To do it yourself:

```bash
ritual migrate --dry-run   # show what would change
ritual migrate             # apply it
```

Before a migration changes anything, Ritual copies each file it will change into one folder in the workspace, `.backups/<time>-migration-<n>/` (named after the last migration in the run). It never deletes those copies; remove them when you no longer need them. If the updated `ritual.config.json` would be invalid, nothing is changed and Ritual says what to fix. If a migration fails part-way, the ones before it stay applied, and the next `ritual migrate` picks up at the one that failed.

`migrate` also refreshes the files Ritual generates for a published site (the deploy workflow, the `.gitignore` entries, the agent skills). See [`ritual migrate`](/commands/migrate/) for every detail. Commit the result.

Each workspace is migrated on its own. If you have several, run `ritual migrate` in each, or just use them: each one asks.

## Pinning the version your site builds with

A site set up with [`ritual init-site`](/commands/init-site/)'s "Publish for me" workflow builds with one exact Ritual release, recorded in `ritual.config.json` as `managed.version`. CI never moves to a newer Ritual by itself. To move it:

1. Update Ritual on your computer with `ritual self-update`.
2. Run `ritual migrate` in the workspace. A newer release than the pin counts as an update, so this moves the pin.
3. Commit `ritual.config.json` (and anything else `migrate` changed) and push.

To build with a different release for a while without changing the pin, set a `RITUAL_VERSION` repository variable on GitHub. See [The Pinned Ritual Release](/commands/init-site/#the-pinned-ritual-release-github-actions).

## Going back to an older release

`ritual self-update --tag v0.1.0` installs exactly that release, older ones included. An older Ritual never migrates a workspace a newer one already updated: `ritual migrate` refuses and names the release it needs, and other commands print a warning. See [A workspace from a newer Ritual](/commands/migrate/#a-workspace-from-a-newer-ritual).
