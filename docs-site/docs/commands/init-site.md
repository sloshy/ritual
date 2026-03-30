---
sidebar_position: 13
---

# init-site

Initialize the current directory for publishing a Ritual site to GitHub Pages.

## Usage

```bash
ritual init-site
```

This interactive command creates the scaffolding files needed to deploy a Ritual-built deck site to GitHub Pages. It prompts you to choose a deployment strategy and then generates the appropriate files.

## Prompts

### Deploy mode

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

| File                                | Description                                                            |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `.github/workflows/deploy-site.yml` | GitHub Actions workflow for deploying to GitHub Pages                  |
| `README.md`                         | Basic setup instructions for your site                                 |
| `.gitignore`                        | Entries for `cache/` and `dist/` (appended if the file already exists) |

If any file already exists, you'll be prompted before overwriting.

## Customizing the Ritual Version

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

After setup, enable GitHub Pages in your repo settings:

1. Go to **Settings → Pages**
2. Under **Source**, select **GitHub Actions**
3. Push to `main` to trigger your first deploy
