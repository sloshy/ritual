---
title: 'Publish Your Deck Site'
description: 'Put your workspace in a GitHub repository, set it up with init-site, and let GitHub Actions build and publish your lists to GitHub Pages on every push. Or build locally and host the files anywhere.'
---

This guide takes a workspace of lists and publishes it as a website. The main path uses GitHub: your lists live in a repository, and a GitHub Actions workflow builds the site and deploys it to GitHub Pages each time you push. At the end there is a second path for building on your own machine and hosting the files anywhere.

It assumes you already have some lists. If not, start with [Your first deck](/start/first-deck/) or the [quick tour](/start/tour/). The [live demo](https://ritual.rpeters.dev/demo/) shows what the finished site looks like.

## 1. Preview the Site Locally

Before publishing anything, look at it:

```bash
ritual serve --build
```

This builds the site into `dist/` and serves it at <http://localhost:3000>. Stop it with `Ctrl-C`. Run it again whenever you want to check a change. See [`serve`](/commands/serve/) and [`build-site`](/commands/build-site/) for every option.

## 2. Put the Workspace in a Git Repository

Turn the workspace folder into a git repository and create an empty repository for it on GitHub:

```bash
git init -b main
git remote add origin git@github.com:<you>/<repo>.git
```

The generated workflow deploys on pushes to the `main` branch, so use `main` as your default branch.

## 3. Run `init-site`

```bash
ritual init-site
```

It asks four questions:

1. **CI system.** Choose **GitHub Actions**. (**Manual / None** writes no workflow; see [Build Locally and Host Anywhere](#build-locally-and-host-anywhere).)
2. **Deploy mode.** Choose **Publish for me**: GitHub builds the site from your lists. **Deploy my local build** instead publishes a `dist/` folder you build and commit yourself.
3. **Automatic change detection.** Say yes if you sometimes edit list files by hand (in a text editor or on github.com). The workflow then writes changelog entries for those edits and commits them. Edits made with Ritual already have their entries and are skipped. Details: [automatic change detection](/commands/init-site/#automatic-change-detection-publish-for-me-only).
4. **Default price store.** The store, and so the currency, the site opens on. See [Choose Price Stores](#4-choose-price-stores) below.

Finally it offers to install the Ritual [agent skills](/commands/skills/) into `.claude/skills/`. Say no unless you use a coding agent in this repository.

Every prompt has a flag, so the same setup runs without questions:

```bash
ritual init-site --ci github-actions --deploy publish-for-me \
  --change-detection --price-source tcgplayer --no-skills --no-overwrite-readme
```

Without prompts, `init-site` stops with exit code `2` if a `README.md` already exists (as it does when you create the GitHub repository with one) until you say what to do with it: `--no-overwrite-readme` keeps yours, `--overwrite-readme` replaces it.

### What it writes

| File                                | What it is                                                                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `.github/workflows/deploy-site.yml` | The workflow: downloads Ritual, restores the card cache, runs `ritual build-site --refresh auto`, deploys `dist/`.                         |
| `ritual.config.json`                | Your `site` settings, plus the `managed` block Ritual keeps for itself. Its `managed.version` is the **CI pin** (below).                   |
| `README.md`                         | Short setup notes for the repository. You are asked before an existing one is replaced.                                                    |
| `.gitignore`                        | Ignores `cache/`, `dist/`, `.admin-dist/`, `exports/`, `.logins/`, `.trash/`, `.backups/`, `all-cards.md` and the CI binary, among others. |

The `.gitignore` keeps the card cache, built output and your saved [logins](/commands/login/) out of the repository. Existing lines in your `.gitignore` are kept; Ritual only appends.

### The CI pin

The workflow always builds with one exact Ritual release: the one recorded in `managed.version`. It is written when a release build of Ritual runs `init-site` or `ritual migrate`. CI never moves to a newer Ritual on its own; you move it when you upgrade (see [Upgrade Ritual Later](#upgrade-ritual-later)). To try another release in CI without changing the pin, set a `RITUAL_VERSION` repository variable; see [Overriding the pin](/commands/init-site/#overriding-the-pin).

## 4. Choose Price Stores

Two settings decide prices on the site:

- [`priceSources`](/configuration/#price-stores-pricesources): the stores the site offers. Default `["tcgplayer"]` (USD).
- [`defaultPriceSource`](/configuration/#default-price-store): the store it opens on. This is what `init-site` asked for, and it adds that store to `priceSources` if needed.

Visitors switch between the offered stores from the header. To offer more:

```bash
ritual config set priceSources tcgplayer cardmarket
```

`cardmarket` (EUR) and `cardhoarder` (MTGO tix) come from the card cache at no extra cost. `cardkingdom` makes every build download Card Kingdom's daily pricelist, about 70 MB. See [Prices on the site](/public-site/prices/).

## 5. Choose Which Lists to Publish

By default every deck, collection and wanted list is published. `init-site` writes this as `["*"]` in three settings: `site.includeDecks`, `site.includeCollections` and `site.includeWantedLists`.

To publish only some lists, set the matching setting to their display names (the `# Title` of each file, matched exactly):

```bash
ritual config set site.includeDecks "Izzet Storm" "Atraxa Superfriends"
```

To publish everything except a few, leave the `include*` setting at `["*"]` and add those lists to the `exclude*` setting. Exclusion always wins:

```bash
ritual config set --add site.excludeDecks "Untuned Brew"
ritual config set --add site.excludeWantedLists "Secret Upgrades"
```

The admin site can do the same: the **Settings** page edits these lists, and the [**Manage Lists**](/admin/manage-lists/#publishing-visibility) page has a visibility toggle per list. See [Choosing which lists to publish](/configuration/#choosing-which-lists-to-publish).

Run `ritual serve --build` again to check the result.

## 6. Turn On GitHub Pages and Push

Commit everything `init-site` wrote, including `ritual.config.json`:

```bash
git add .
git commit -m "Set up Ritual site"
git push -u origin main
```

On GitHub, open the repository's **Settings → Pages** and under **Source** select **GitHub Actions**. The push starts the workflow; when it finishes, the site is at `https://<you>.github.io/<repo>/` (the **Actions** tab shows progress, and you can re-run it from there).

The first run downloads the full Scryfall card data, so it takes a few minutes. Later runs restore the card cache and the Ritual binary from GitHub's cache.

## 7. Themes

The site ships with eleven color palettes (each with an `-inverted` variant) and a theme editor. Each visitor picks a theme from the header's **Theme** button, and the choice stays in their browser.

What a first-time visitor sees is the `default` theme unless you pick another in `site.theme`. Every build reads that setting, including the one the "Publish for me" workflow runs, so set it once and commit `ritual.config.json` (do not edit flags into the workflow file: [`ritual migrate`](/commands/migrate/#generated-files) rewrites it on upgrades):

```bash
ritual config set site.theme izzet
```

The admin [Settings](/admin/dashboard/#settings) page's **Site theme** select writes the same key. To open on a [custom theme](/commands/build-site/#custom-themes) you made in the theme editor, commit its JSON file to the repository, list it in `site.themeFiles` (paths relative to the workspace), and name it in `site.theme`:

```bash
ritual config set site.themeFiles themes/my-palette.json
ritual config set site.theme my-palette
```

A local build can still override both for one run with `--theme` / `--theme-file`. See [Themes](/commands/build-site/#themes) for the full list.

## 8. Use a Custom Domain

A custom domain is a GitHub Pages setting, not a Ritual one. Enter the domain under **Settings → Pages → Custom domain** and set up DNS as GitHub's documentation describes. Because the workflow deploys through GitHub Actions, no `CNAME` file is needed in the repository.

## How Updates Flow

Once set up, publishing is part of editing:

1. Edit your lists: [`ritual edit`](/commands/edit/), the [admin site](/admin/), one-shot commands such as [`add-card`](/commands/add-card/), a sync, or a text editor.
2. Commit the list files and their `.changes.md` and `.sha256` files.
3. Push to `main`. The workflow builds and deploys the new site.

The admin site and the MCP server can commit and push for you: set [`admin.gitEnabled`, `admin.gitAutoCommit` and `admin.gitAutoPush`](/configuration/#git-integration). CLI commands never commit.

Each build refreshes card prices that are more than a day old, so pushing (or re-running the workflow from the **Actions** tab) a day or more after the last build updates the prices on the site. When more than 100 cards' prices are that old, `--refresh auto` downloads the Scryfall bulk data again instead of refreshing card by card.

## Upgrade Ritual Later

When a new Ritual release comes out:

```bash
ritual self-update     # install the new release; it previews pending workspace updates
ritual migrate         # apply them and move the CI pin to the new release
git add -A && git commit -m "Upgrade Ritual" && git push
```

`ritual migrate` applies any one-time migrations, rewrites the workflow and `.gitignore` entries from your saved settings, refreshes installed agent skills, and records the new release in `managed.version`. Preview with `ritual migrate --dry-run`. Once you push `ritual.config.json`, CI builds with the new release.

You rarely need to remember this: other commands offer to migrate when updates are pending. If CI or another machine is on an older release than the workspace needs, Ritual names the release to install with [`ritual self-update --tag`](/commands/self-update/#installing-a-specific-release). Details: [`migrate`](/commands/migrate/) and [the CI pin](/commands/migrate/#the-ci-pin).

## Build Locally and Host Anywhere

The site is plain static files, so any web host works: your own server, an object store, or any static hosting service.

```bash
ritual build-site
```

This writes the site into `dist/`. Upload the contents of `dist/` to your host. The site uses hash routing (`#/deck/…`), so it needs no server rewrites and works under a subpath. Check it first with:

```bash
ritual serve            # serve the existing dist/ at http://localhost:3000
ritual serve --build    # or rebuild first; takes the same flags as build-site
```

A few `build-site` flags matter most for hand-built sites:

- `--decks`, `--collections`, `--wanted-lists`: publish only these lists for this build, overriding the `site.*` settings.
- `--theme`, `--theme-file`: the opening theme and custom themes for this build, overriding `site.theme` / `site.themeFiles`.
- `--price-sources`: narrow the offered stores for this build.
- `--refresh auto`: refresh card data and prices without prompts. See [Card Cache Refresh](/commands/build-site/#card-cache-refresh).
- `--out-dir`: build somewhere other than `dist/`. The build replaces that directory.

To keep using GitHub Pages with a build you made yourself, run `init-site` and choose **Deploy my local build**. The workflow then deploys the committed `dist/` folder as-is, and `.gitignore` is set up so `dist/` is committed. Rebuild, commit `dist/` and push to publish.

To keep the workspace with no workflow at all, choose **Manual / None**: `init-site` writes only the config, README and `.gitignore`.

:::note
`ritual serve --api` serves the site with a live, read-only backend instead of static files. It is in beta. See [Hosting with a Live Backend](/public-site/hosted/).
:::
