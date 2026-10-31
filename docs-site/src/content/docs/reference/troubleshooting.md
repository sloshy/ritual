---
title: 'Troubleshooting'
description: 'Fixes for common problems, how to check your setup with ritual doctor, and how to report a bug.'
sidebar:
  order: 4
---

## First, run `ritual doctor`

[`ritual doctor`](/commands/doctor/) checks your setup and says what to fix: which Ritual is running, the workspace, `ritual.config.json`, pending updates, the card cache, and the last update check. It only reads; it changes nothing. Run it in the workspace where the problem happens:

```bash
ritual doctor
```

Each line is `ok`, `warn` or `fail`. A line that found a problem ends with a one-line fix.

## Installing

**macOS says Ritual "cannot be opened", or Windows warns about an "unrecognized app".** Ritual's binaries are not code-signed, so a binary downloaded in a web browser is blocked the first time it runs. On macOS, run `xattr -d com.apple.quarantine ./ritual`. On Windows, choose **More info**, then **Run anyway**. The [install scripts](/start/install/) download in a way that does not trigger either warning, so use them if you can.

**`ritual: command not found` after installing.** The install script puts Ritual in `~/.local/bin` on macOS and Linux, and in `%LOCALAPPDATA%\Programs\ritual\bin` on Windows; make sure that folder is on your `PATH`, or open a new terminal. See [Install](/start/install/).

## Running commands

**Ritual finds no lists.** Ritual works in the current directory. Run it from your [workspace](/workspace/), or pass `--base-dir <path>` (or set `RITUAL_BASE_DIR`). `ritual doctor` warns when the folder looks like no workspace at all.

**A command can't tell which list you mean.** A name can match a deck and a collection, or several lists. See [List Names](/list-resolution/) for how names are matched and how to pick one.

**Ritual keeps asking whether to migrate.** A newer Ritual has updates for this workspace. Answer yes, or run `ritual migrate` yourself, and the question stops. If you answer no, Ritual asks again at most once a day. In scripts and CI it never asks; it prints a one-line notice instead. See [Upgrading](/reference/upgrading/#migrations).

**"This workspace was last updated by a newer Ritual."** Someone ran a newer Ritual on this workspace. Install that release with the `ritual self-update --tag …` command the message names. See [A workspace from a newer Ritual](/commands/migrate/#a-workspace-from-a-newer-ritual).

**The admin says "Refused a request sent from another site."** The request came from a page that is not the admin site itself: a bookmarklet, another local app, the admin opened under a different address or port. Use the admin site directly. Behind a reverse proxy that rewrites the `Host` header, turn on `admin.trustProxy`. See [Cross-site requests](/commands/admin/#cross-site-requests).

**`ritual.config.json` is broken.** A file that is not valid JSON stops every command except `ritual doctor`, which shows the parser's complaint. A setting with a wrong value is ignored with a warning, and its default is used. Fix the file, or reset one setting with `ritual config unset <key>`.

## The card cache

**Prices are old, or a new card is missing.** Refresh the [card cache](/card-cache/): `ritual cache preload-all`. Commands that show prices also offer to refresh when the cache is more than a day old.

**Where is the cache, and how big is it?** `ritual cache status` shows the folder and what chose it. The English card data takes about 450 MB on disk. See [Card Cache](/card-cache/#where-it-lives).

**A second workspace downloads the card data again.** Workspaces share one cache unless `cacheDir` or `RITUAL_CACHE_DIR` gives one its own. An older workspace keeps reading its own `cache/` folder until you run `ritual migrate`, which moves it into the shared one.

**A refresh says the cache is locked.** Another Ritual program is refreshing the same cache, perhaps in another workspace. Wait for it to finish. A lock left by a program that crashed is cleared on its own. See [Cache lock timeout](/configuration/#cache-lock-timeout).

**The cache file is damaged.** If `cache.json` cannot be read, Ritual treats the cache as empty and refuses to overwrite it card by card. `ritual cache preload-all` replaces the whole cache and repairs it.

**Working without a network.** Pass `--refresh never` so Ritual uses the cache as it is and skips refresh downloads. See [Offline use](/card-cache/#offline-use).

## Lists and history

**My hand edit shows up in a list's history.** That is on purpose. When you edit a list file by hand, Ritual records the edit in the list's `.changes.md` the next time [`ritual detect-changes`](/commands/detect-changes/) runs, so the history stays complete. (With [automatic change detection](/commands/init-site/#automatic-change-detection-publish-for-me-only) on, the deploy workflow runs it on each push.) Ritual tells its own edits from yours with the `.sha256` file beside each list. See [The `.sha256` files](/list-format/#the-sha256-files).

**Every list looks hand-edited.** The `.sha256` files are missing, probably because they were not committed. Commit them with your lists. To mark the files as they are now as recorded, without history entries for what changed, run `ritual detect-changes --hash-only`.

**A line in a list could not be read.** Ritual warns and names the line. It never deletes it quietly: commands that rewrite the whole file refuse instead. Fix the line by hand; [Read tolerances](/list-format/#read-tolerances) lists what the reader accepts. Then [`ritual cleanup`](/commands/cleanup/) can rewrite the list in its standard form (run it with `--dry-run` first).

**I deleted a list by mistake.** Deleted lists go to `.trash/` in the workspace. See [Restoring a deleted list](/commands/delete/#restoring-a-deleted-list).

## Reporting a bug

If Ritual says **"This looks like a bug in Ritual"**:

1. Run the same command again with `RITUAL_DEBUG=1` set, for example `RITUAL_DEBUG=1 ritual price "My Deck"`. This prints the full error.
2. Run `ritual doctor` in the same workspace.
3. Open an issue at [github.com/sloshy/ritual/issues](https://github.com/sloshy/ritual/issues) with both outputs and what you were doing.

The `doctor` report shows paths under your home folder as `~/…` and never includes a login, token or account name, so it is safe to paste in public. See [Reporting a bug](/commands/doctor/#reporting-a-bug).

For a security problem, do not open a public issue; see [Security and Privacy](/reference/security/#reporting-a-security-problem).
