---
title: 'init-site'
---

Initialize the current directory for publishing a Ritual site.

## Usage

```bash
ritual init-site [options]
```

| Option          | Description                                                                        |
| --------------- | ---------------------------------------------------------------------------------- |
| `-u, --upgrade` | Upgrade tracked workflows to the current version without prompting                 |
| `-f, --force`   | Re-initialize and overwrite all generated files, ignoring the existing site config |
| `--skills`      | Install Ritual agent skills into `.claude/skills` without prompting                |
| `--no-skills`   | Skip installing Ritual agent skills (no prompt)                                    |

This interactive command creates the scaffolding files needed to publish a Ritual-built deck and collection site. It first prompts you to choose a CI system, then a deployment strategy, then the default price currency (`usd`, `eur`, or `tix` — defaulting to USD, stored as the root-level [`defaultCurrency`](/configuration/#default-currency) key), and generates the appropriate files.

The site settings are stored under the `site` key of [`ritual.config.json`](/configuration/). On subsequent runs, `init-site` compares the current Ritual version to the version recorded there. If a newer version is detected, it prompts you to confirm before regenerating any tracked managed files.

## Prompts

### CI system

```
? Which CI system are you using?
❯ GitHub Actions — Generate a GitHub Actions workflow that builds and deploys automatically
  Manual / None — No CI integration — build and deploy manually
```

**GitHub Actions** generates a workflow file in `.github/workflows/` to automate your deployments.

**Manual / None** skips any CI file generation. You build and deploy the site yourself.

### Deploy mode (GitHub Actions only)

```
? How would you like to deploy your site?
❯ Publish for me — Generate a GitHub Action that builds your site and deploys it automatically
  Deploy my local build — Generate a GitHub Action that deploys a directory you build locally with build-site
```

**Publish for me** generates a GitHub Action that:

1. Resolves the Ritual version (or uses the pinned `RITUAL_VERSION` variable) and restores the Ritual binary from cache if the version hasn't changed
2. Downloads the Ritual binary only when the resolved version is not already cached
3. Restores the Scryfall card cache from a previous run (using GitHub Actions caching)
4. Runs `ritual build-site --allow-refresh` to build your site
5. Deploys the `dist/` directory to GitHub Pages

**Deploy my local build** generates a simpler action that deploys a pre-built directory you commit to the repository.

### Build directory (local build only)

If you choose "Deploy my local build", you'll be asked which directory contains the built site:

```
? Which directory contains your built site? (dist)
```

The default is `dist`, which is where [`build-site`](/commands/build-site/) writes its output.

### Automatic change detection (publish for me only)

If you choose "Publish for me", you'll be asked whether to enable automatic change detection:

```
? Enable automatic change detection? (commits changelogs when list files change) (y/N)
```

When enabled, the generated workflow runs [`git-detect-changes`](/commands/git-detect-changes/) before building the site. If any deck, collection, or wanted list files were modified in the push, it generates changelog entries and commits them automatically. The site build is skipped for that run since the new commit will trigger a fresh build with the updated changelogs.

This is useful when you edit list files directly (outside the admin UI or CLI) and want changelogs to stay up to date without manual intervention.

Detection is **hash-aware**, so it's safe to leave enabled even if you also edit with Ritual locally: files whose contents still match their `.sha256` sidecar (i.e. Ritual itself wrote them and already recorded a changelog) are skipped, and only hand-edited files are processed. See [Hash-aware detection](/commands/git-detect-changes/#hash-aware-detection) for details.

### Default currency

```
? Default price currency?
❯   USD (current) - US Dollars (TCGplayer)
    EUR - Euros (Cardmarket)
    TIX - MTGO tickets
```

Sets the root-level [`defaultCurrency`](/configuration/#default-currency) key — the currency the [price](/commands/price/) command, editor price displays, and the public site default to. USD is the default; the currently configured value is preselected. Change it later with `config-set defaultCurrency <usd|eur|tix>`.

### Agent skills

After the site files are written, `init-site` offers to install the [Ritual agent skills](/commands/skills/):

```
? Install Ritual agent skills into .claude/skills so coding agents can work with this repository? (Y/n)
```

If you keep your decks, collections, and wanted lists in a git repository and work in it with a coding agent (e.g. Claude Code), answering yes writes the skill files into `.claude/skills/` so the agent can drive Ritual in this repository's context. Pass `--skills` or `--no-skills` to make the choice without prompting (handy for scripted setups). With `--force`, existing skill files are overwritten; otherwise customized skill files are preserved. (During [upgrades](#upgrading), already-installed skills are refreshed automatically — no `--force` needed.) You can also install or refresh them at any time with [`ritual skills install`](/commands/skills/).

## Generated Files

### GitHub Actions

| File                                | Description                                                               |
| ----------------------------------- | ------------------------------------------------------------------------- |
| `.github/workflows/deploy-site.yml` | GitHub Actions workflow for deploying to GitHub Pages (tracked)           |
| `ritual.config.json` (`site` key)   | Stores your settings and the Ritual version used — commit this file       |
| `README.md`                         | Basic setup instructions for your site                                    |
| `.gitignore`                        | Entries for `cache/`, `dist/`, etc. (appended if the file already exists) |

### Manual / None

| File                              | Description                                                               |
| --------------------------------- | ------------------------------------------------------------------------- |
| `ritual.config.json` (`site` key) | Stores your settings and the Ritual version used — commit this file       |
| `README.md`                       | Basic setup instructions for your site                                    |
| `.gitignore`                      | Entries for `cache/`, `dist/`, etc. (appended if the file already exists) |

If any file already exists, you'll be prompted before overwriting.

## Version Tracking and Upgrade

`init-site` writes a `site` block into `ritual.config.json` recording your CI system, settings, and the current Ritual version. It also seeds the [publish lists](/configuration/#choosing-which-lists-to-publish) (`includeDecks`, `includeCollections`, `includeWantedLists`) with the `["*"]` default — "publish everything" — which you can later narrow from the admin **Settings** page or with `config-set`. Examples:

```json
{
  "site": {
    "version": "0.1.0",
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
    "version": "0.1.0",
    "ciSystem": "github-actions",
    "deployMode": "publish-for-me",
    "distDir": "dist",
    "detectChanges": true
  }
}
```

```json
{
  "site": {
    "version": "0.1.0",
    "ciSystem": "manual"
  }
}
```

Commit `ritual.config.json` so Ritual knows which version initialized the repository.

### Upgrading

When you run `ritual init-site` after upgrading to a newer Ritual build, it detects the version change and prompts for confirmation before regenerating tracked managed files:

```
Ritual has been upgraded (0.1.0 → 0.2.0). Regenerate tracked managed files? (Y/n)
```

If you confirm, migrations run using your saved settings:

```
Upgrading from 0.1.0 to 0.2.0...
↻ Updated .github/workflows/deploy-site.yml
✓ ritual.config.json site section updated to 0.2.0
✓ Updated 7 Ritual agent skills in .claude/skills
```

Upgrades also **refresh any [agent skills](/commands/skills/) already installed** in `.claude/skills` so they
track the new version. Only skills that are already present are rewritten — an upgrade never introduces
skills you didn't install. Pass `--no-skills` to leave them untouched, or `--skills` to (re)install the
full set.

To skip the prompt and upgrade automatically (e.g. in a script), use `--upgrade`:

```bash
ritual init-site --upgrade
```

### Downgrade warning

If the current Ritual build is older than the version recorded in the `site` config, the command warns you and exits with a failure status without making changes:

```
Warning: The current Ritual build (0.1.0) is older than the version last used
to initialize this repository (0.2.0).
Use --force to re-initialize with current settings, or remove the "site" key
from ritual.config.json if you want to use this older version.
```

### `--force`

Use `--force` (or `-f`) to bypass all version checks and re-run the full interactive init, overwriting all tracked files:

```bash
ritual init-site --force
```

## Exit Codes

| Code | Meaning                                                                                                              |
| ---- | -------------------------------------------------------------------------------------------------------------------- |
| `0`  | Files generated, or the upgrade was applied                                                                          |
| `1`  | Failed to write `ritual.config.json`, or the current build is older than the version that initialized the repository |
| `2`  | A prompt was cancelled or declined, or the repository is already initialized with the current version                |

## Customizing the Ritual Version (GitHub Actions)

When using the "Publish for me" workflow, the action downloads the latest Ritual release by default. To pin a specific version:

1. Go to your repository on GitHub
2. Navigate to **Settings → Secrets and variables → Actions → Variables**
3. Create a repository variable named `RITUAL_VERSION`
4. Set it to the desired release tag (e.g. `v1.0.0`)

The workflow checks this variable on each run and downloads the specified version instead of the latest. The binary is cached between runs using GitHub Actions caching, keyed by version — so if the version hasn't changed since the last run, no download occurs.

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
