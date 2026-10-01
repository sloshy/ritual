---
title: 'init-site'
---

Set up the current directory for publishing a Ritual site: a README, a `.gitignore`, the site settings in `ritual.config.json`, and, for GitHub Actions, a deploy workflow.

## Usage

```bash
ritual init-site [options]
```

| Option                                         | Description                                                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `-f, --force`                                  | Re-initialize and overwrite all generated files, ignoring the existing site config                                             |
| `--ci <system>`                                | CI system for a fresh init: `github-actions` or `manual`                                                                       |
| `--deploy <mode>`                              | Deploy mode: `publish-for-me` or `local-build` (github-actions only)                                                           |
| `--dist-dir <dir>`                             | Directory containing your locally built site (local-build deploys only)                                                        |
| `--change-detection` / `--no-change-detection` | Enable or disable automatic change detection (publish-for-me only; a usage error with `--ci manual` or `--deploy local-build`) |
| `--price-source <store>`                       | Default price store: `tcgplayer`, `cardkingdom`, `cardmarket`, or `cardhoarder`                                                |
| `--overwrite-readme` / `--no-overwrite-readme` | Overwrite or keep an existing `README.md` without prompting                                                                    |
| `--skills`                                     | Install Ritual agent skills into `.claude/skills` without prompting                                                            |
| `--no-skills`                                  | Skip installing Ritual agent skills (no prompt)                                                                                |

On a fresh init, the command asks for a CI system, a deployment strategy, and the default price store, then generates the files. Every prompt has a matching flag, listed with each prompt below. A flag skips its prompt, and invalid values are rejected before anything is written. A flag that does not apply to the chosen CI system or deploy mode is a usage error (for example `--deploy` with `--ci manual`, or `--dist-dir` with `--deploy publish-for-me`).

The site settings are stored under the `site` key of [`ritual.config.json`](/configuration/). On later runs, `init-site` changes nothing: it reports whether the workspace is current or needs [`ritual migrate`](#after-upgrading-ritual). The fresh-init flags apply only to a fresh init (or `--force`); passing them on an already-initialized repository is a usage error.

## Headless Runs

When prompts are unavailable (see [When prompts are unavailable](/cli-conventions/#when-prompts-are-unavailable)), any prompt whose flag was not provided is a usage error (exit 2) of the form `Input required: pass --ci <system> (…)`, raised before anything is written. This includes the closing agent-skills question, which needs `--skills` or `--no-skills`. A fully-flagged headless init:

```bash
ritual init-site \
  --ci github-actions \
  --deploy publish-for-me \
  --change-detection \
  --price-source tcgplayer \
  --no-skills
```

Overwrite decisions work the same way. An existing `README.md` needs `--overwrite-readme`, `--no-overwrite-readme`, or `--force`; and an existing generated workflow needs `--force`.

## Prompts

### CI system

Flag: `--ci <system>`

```
? Which CI system are you using?
❯ GitHub Actions — Generate a GitHub Actions workflow that builds and deploys automatically
  Manual / None — No CI integration — build and deploy manually
```

**GitHub Actions** (`--ci github-actions`) generates a workflow in `.github/workflows/` that deploys for you.

**Manual / None** (`--ci manual`) generates no CI file. You build and deploy the site yourself.

### Deploy mode (GitHub Actions only)

Flag: `--deploy <mode>`

```
? How would you like to deploy your site?
❯ Publish for me — Generate a GitHub Action that builds your site and deploys it automatically
  Deploy my local build — Generate a GitHub Action that deploys a directory you build locally with build-site
```

**Publish for me** (`--deploy publish-for-me`) generates a GitHub Action that:

1. Resolves the Ritual version — the release [pinned in `ritual.config.json`](#the-pinned-ritual-release-github-actions), unless the `RITUAL_VERSION` variable says otherwise — and restores the Ritual binary from cache if the version has not changed
2. Downloads the Ritual binary only when the resolved version is not cached
3. Restores the Scryfall card cache from a previous run (GitHub Actions caching)
4. Runs `ritual build-site --refresh auto`
5. Deploys the `dist/` directory to GitHub Pages

**Deploy my local build** (`--deploy local-build`) generates a simpler action that deploys a pre-built directory you commit to the repository. Because that directory is committed, the generated `.gitignore` does not ignore it and appends an explicit `!<distDir>/` un-ignore, so a `dist/` line from an earlier init stops covering it. The generated README tells you to commit it. If another pattern in your `.gitignore` still covers the directory (a wildcard the un-ignore cannot undo, such as `di*`, `dist/*` or `dist/**`), `init-site` names the offending lines so you can remove or narrow them.

### Build directory (local build only)

Flag: `--dist-dir <dir>`

With "Deploy my local build", you are asked which directory holds the built site:

```
? Which directory contains your built site? (dist)
```

The default is `dist`, where [`build-site`](/commands/build-site/) writes its output. Any other directory needs [`--out-dir`](/commands/build-site/), so the README, the "next steps" summary, and the preview command all read `ritual build-site --out-dir <dir>` / `ritual serve --build --out-dir <dir>`.

### Automatic change detection (publish for me only)

Flags: `--change-detection` / `--no-change-detection`

With "Publish for me", you are asked whether to enable automatic change detection:

```
? Enable automatic change detection? (commits changelogs when list files change) (y/N)
```

When enabled, the workflow runs [`detect-changes`](/commands/detect-changes/) before building, diffing against `github.event.before` (or `HEAD~1` when that is empty or the all-zeros SHA, as on the first push to a branch). If any deck, collection, or wanted list files changed in the push, it generates changelog entries and commits them. The site build is skipped for that run, since the new commit triggers a fresh build with the updated changelogs. If `detect-changes` exits nonzero, the step commits and pushes what it wrote and then fails.

This is useful when you edit list files directly, outside the admin UI or CLI, and want changelogs to stay current.

Detection is **hash-aware**, so it is safe to leave enabled even if you also edit with Ritual locally. Files whose contents still match their `.sha256` hash file (meaning Ritual wrote them and already recorded a changelog) are skipped; only hand-edited files are processed. See [Hash-aware detection](/commands/detect-changes/#hash-aware-detection).

### Default price store

Flag: `--price-source <store>`

```
? Default price store?
❯   TCGplayer (current) - Prices in USD
    Cardmarket - Prices in EUR
    Card Kingdom - Prices in USD
    Cardhoarder - Prices in TIX
```

Sets the root-level [`defaultPriceSource`](/configuration/#default-price-store) key: the store (and so the currency) the [price](/commands/price/) command, the editor price displays, and the sites default to. The store currently in effect is preselected. A store missing from [`priceSources`](/configuration/#price-stores-pricesources) is added to it, since the sites can only open on a store they offer. Change it later with `config set defaultPriceSource <store>`.

### Agent skills

After the site files are written, `init-site` offers to install the [Ritual agent skills](/commands/skills/):

```
? Install Ritual agent skills into .claude/skills so coding agents can work with this repository? (Y/n)
```

If you work in this repository with a coding agent (such as Claude Code), answering yes writes the skill files into `.claude/skills/` so the agent can drive Ritual here. Pass `--skills` or `--no-skills` to skip the prompt; a headless run requires one of them. With `--force`, existing skill files are overwritten; otherwise customized skill files are kept. After you upgrade Ritual, [`ritual migrate`](/commands/migrate/) refreshes the installed skills. You can also install or refresh them at any time with [`ritual skills install`](/commands/skills/), or refresh only the already-installed ones with [`ritual skills update`](/commands/skills/#update).

## Generated Files

### GitHub Actions

| File                                | Description                                                                                                                                                                                              |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/deploy-site.yml` | GitHub Actions workflow for deploying to GitHub Pages (tracked)                                                                                                                                          |
| `ritual.config.json`                | Your settings (`site` key) and Ritual's bookkeeping (`managed` key). Commit this file.                                                                                                                   |
| `README.md`                         | Basic setup instructions for your site                                                                                                                                                                   |
| `.gitignore`                        | Entries for `cache/`, `dist/`, `exports/`, the [`.dist-build-*`/`.dist-old-*` build scratch directories](/commands/build-site/#scratch-directories-beside-the-output), etc. Appended if the file exists. |

A local-build deploy leaves its built-site directory out of `.gitignore` and un-ignores it instead.

### Manual / None

| File                 | Description                                                                  |
| -------------------- | ---------------------------------------------------------------------------- |
| `ritual.config.json` | Your settings (`site`) and Ritual's bookkeeping (`managed`). Commit it.      |
| `README.md`          | Basic setup instructions for your site                                       |
| `.gitignore`         | Entries for `cache/`, `dist/`, `exports/`, etc. Appended if the file exists. |

If a generated file already exists, you are prompted before it is overwritten; `--force` overwrites without asking. For `README.md`, `--overwrite-readme` / `--no-overwrite-readme` decide without a prompt and take precedence over `--force`. In a headless run, an existing file with no decision flag is a usage error.

## Site Settings and Upgrades

`init-site` writes a `site` block into `ritual.config.json` recording your CI system and settings. It also seeds the [publish lists](/configuration/#choosing-which-lists-to-publish) (`includeDecks`, `includeCollections`, `includeWantedLists`) with `["*"]`, "publish everything", which you can narrow later from the admin **Settings** page or with `config set`. Examples:

```json
{
  "site": {
    "ciSystem": "github-actions",
    "deployMode": "publish-for-me",
    "distDir": "dist",
    "detectChanges": false,
    "includeDecks": ["*"],
    "includeCollections": ["*"],
    "includeWantedLists": ["*"]
  }
}
```

```json
{
  "site": {
    "ciSystem": "manual"
  }
}
```

It also stamps the [`managed` block](/configuration/#ritual-bookkeeping-managed-key): the latest migration this Ritual knows (a fresh workspace needs none of them), a hash of the files it just generated, and, on a release build, the Ritual version — the [CI pin](#the-pinned-ritual-release-github-actions). Commit `ritual.config.json` along with the generated files.

### After upgrading Ritual

Re-running `init-site` on an initialized repository never changes it. It prints `Already initialized and up to date; nothing to do.` when nothing is pending, or tells you to run [`ritual migrate`](/commands/migrate/) when the new Ritual has migrations or regenerated files for the workspace, or, for a "Publish for me" workspace, is a newer release than the [CI pin](#the-pinned-ritual-release-github-actions). Either way it exits `0`, so an "ensure initialized" script can run it unconditionally. A workspace a newer Ritual already updated, or whose config cannot be made valid, is refused with exit `1` and the same message `ritual migrate` gives.

A fresh init or a `--force` re-init also refuses such a workspace. Otherwise it applies any pending migrations before writing its files. If you keep an existing workflow at the overwrite prompt, the generated-files hash is left unrecorded, so `ritual migrate` later offers to regenerate it.

`ritual migrate` is what brings the workspace up to date: it rewrites the workflow from your saved settings (so older workflows pick up template changes), appends `.gitignore` entries added by newer versions (for a **local-build** deploy, this is how an older scaffold gets the `!<distDir>/` un-ignore), and refreshes installed [agent skills](/commands/skills/). Preview it with `ritual migrate --dry-run`. You rarely need to remember it: every other command [offers to migrate, or prints a one-line notice](/commands/migrate/#when-ritual-offers-to-migrate), when updates are pending. The generated GitHub Actions workflow runs with `CI` set, so its `build-site` step only prints the notice and never prompts.

### `--force`

`--force` (or `-f`) ignores the existing site settings and re-runs the full init, overwriting all generated files including an existing `README.md` (pass `--no-overwrite-readme` to keep it). The fresh-init flags work here too, so a fully-flagged `--force` run never prompts:

```bash
ritual init-site --force --ci github-actions --deploy publish-for-me --no-change-detection --price-source tcgplayer --no-skills
```

## Exit Codes

| Code | Meaning                                                                                                                                                                                  |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Files generated, or the repository was already initialized (whether or not `ritual migrate` has updates for it)                                                                          |
| `1`  | Failed to write `ritual.config.json`, or the workspace was updated by a newer Ritual or its config cannot be made valid (see [`migrate`](/commands/migrate/))                            |
| `2`  | A prompt was cancelled or declined, a flag was invalid or contradictory (including fresh-init flags on an already-initialized repository), or a headless run was missing a required flag |

## The Pinned Ritual Release (GitHub Actions)

The "Publish for me" workflow builds with exactly one Ritual release: the one recorded as `managed.version` in `ritual.config.json` (read with `jq`). Release tags carry a `v` prefix (`v1.2.0`) and the pin does not (`1.2.0`), so the workflow adds it. The binary is cached between runs by version, so an unchanged pin means no download.

Only a Ritual **release** build writes the pin, when it runs `init-site` or [`ritual migrate`](/commands/migrate/). CI therefore never jumps to a newer Ritual by itself. To move it forward, install the newer release, run `ritual migrate` (a newer release than the pin [counts as pending work](/commands/migrate/#the-ci-pin) for this deploy mode), and commit `ritual.config.json`. A development build never writes the pin, and warns when it applies migrations that the pinned release does not know.

A workspace with no pin (one only ever set up by development builds) builds with the latest stable release, or, while Ritual has only prereleases, with the newest release (prereleases included). Each run logs a GitHub Actions warning naming the release it picked. If no release can be resolved at all, the step fails.

### Overriding the pin

To build with a different release without touching the pin:

1. Go to your repository on GitHub
2. Navigate to **Settings → Secrets and variables → Actions → Variables**
3. Create a repository variable named `RITUAL_VERSION`
4. Set it to a release tag, such as `v1.0.0` (a missing `v` is added)

The workflow checks this variable on each run, and when it is set, downloads that release instead of the pinned one. Delete the variable to go back to the pin.

## Examples

Initialize a new site project:

```bash
mkdir my-decks && cd my-decks
git init
ritual init-site
ritual edit
```

The generated `README.md` walks new visitors through creating decks, collections, and wanted lists with [`ritual edit`](/commands/edit/), and links to this documentation site.

After setup with GitHub Actions, enable GitHub Pages in your repo settings:

1. Go to **Settings → Pages**
2. Under **Source**, select **GitHub Actions**
3. Push to `main` to trigger your first deploy
