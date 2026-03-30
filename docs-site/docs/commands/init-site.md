---
sidebar_position: 13
---

# init-site

Initialize the current directory for publishing a Ritual site.

## Usage

```bash
ritual init-site [options]
```

| Option          | Description                                                                  |
| --------------- | ---------------------------------------------------------------------------- |
| `-u, --upgrade` | Upgrade tracked files to the current version without prompting               |
| `-f, --force`   | Re-initialize and overwrite all generated files, ignoring `ritual-site.json` |

This interactive command creates the scaffolding files needed to publish a Ritual-built deck site. It first prompts you to choose a CI system, then a deployment strategy, and generates the appropriate files.

On subsequent runs, `init-site` compares the current Ritual version to the version recorded in `ritual-site.json`. If a newer version is detected, it prompts you to confirm before regenerating any tracked managed files.

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
4. Runs `ritual build-site -y` to build your site
5. Deploys the `dist/` directory to GitHub Pages

**Deploy my local build** generates a simpler action that deploys a pre-built directory you commit to the repository.

### Build directory (local build only)

If you choose "Deploy my local build", you'll be asked which directory contains the built site:

```
? Which directory contains your built site? (dist)
```

The default is `dist`, which is where [`build-site`](./build-site) writes its output.

## Generated Files

### GitHub Actions

| File                                | Description                                                            |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `.github/workflows/deploy-site.yml` | GitHub Actions workflow for deploying to GitHub Pages (tracked)        |
| `ritual-site.json`                  | Stores your settings and the Ritual version used — commit this file    |
| `README.md`                         | Basic setup instructions for your site                                 |
| `.gitignore`                        | Entries for `cache/` and `dist/` (appended if the file already exists) |

### Manual / None

| File               | Description                                                            |
| ------------------ | ---------------------------------------------------------------------- |
| `ritual-site.json` | Stores your settings and the Ritual version used — commit this file    |
| `README.md`        | Basic setup instructions for your site                                 |
| `.gitignore`       | Entries for `cache/` and `dist/` (appended if the file already exists) |

If any file already exists, you'll be prompted before overwriting.

## Version Tracking and Upgrade

`init-site` writes a `ritual-site.json` file recording your CI system, settings, and the current Ritual version. Examples:

```json
{
  "version": "0.1.0",
  "ciSystem": "github-actions",
  "deployMode": "publish-for-me",
  "distDir": "dist"
}
```

```json
{
  "version": "0.1.0",
  "ciSystem": "manual"
}
```

Commit this file so Ritual knows which version initialized the repository.

### Upgrading

When you run `ritual init-site` after upgrading to a newer Ritual build, it detects the version change and prompts for confirmation before regenerating tracked managed files:

```
Ritual has been upgraded (0.1.0 → 0.2.0). Regenerate tracked GitHub Actions workflows? (Y/n)
```

If you confirm, migrations run using your saved settings:

```
Upgrading from 0.1.0 to 0.2.0...
↻ Updated .github/workflows/deploy-site.yml
✓ ritual-site.json updated to 0.2.0
```

To skip the prompt and upgrade automatically (e.g. in a script), use `--upgrade`:

```bash
ritual init-site --upgrade
```

### Downgrade warning

If the current Ritual build is older than the version recorded in `ritual-site.json`, the command warns you and exits without making changes:

```
Warning: The current Ritual build (0.1.0) is older than the version last used
to initialize this repository (0.2.0).
Use --force to re-initialize with current settings, or delete ritual-site.json
if you want to use this older version.
```

### `--force`

Use `--force` (or `-f`) to bypass all version checks and re-run the full interactive init, overwriting all tracked files:

```bash
ritual init-site --force
```

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
ritual new-deck "My Commander Deck"
```

After setup with GitHub Actions, enable GitHub Pages in your repo settings:

1. Go to **Settings → Pages**
2. Under **Source**, select **GitHub Actions**
3. Push to `main` to trigger your first deploy
