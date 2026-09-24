---
title: 'build-site'
---

Generate the [public site](/public-site/): a static website for your decks, collections, and wanted lists.

This page covers the build: which lists it publishes, themes and languages, where the output goes, and how the card cache is refreshed. What the finished site can do is documented in the [Public Site](/public-site/) section.

## Usage

```bash
ritual build-site [options]
```

## Options

| Option                          | Description                                                                                                                                                                                                                                                                                               |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-v, --verbose`                 | Show the cards being fetched from Scryfall                                                                                                                                                                                                                                                                |
| `--cache-images`                | Download deck card images into `images/` under the output directory (`dist/` by default, or `--out-dir`) and use them instead of Scryfall URLs                                                                                                                                                            |
| `--decks [names...]`            | Decks (display name or file base name) or deck URLs to include. Default: the `site.includeDecks` config selection. The flag with no names is a usage error.                                                                                                                                               |
| `--collections [names...]`      | Collections (display name or file base name) to include. Default: the `site.includeCollections` config selection. The flag with no names is a usage error.                                                                                                                                                |
| `--wanted-lists [names...]`     | Wanted lists (display name or file base name) to include. Default: the `site.includeWantedLists` config selection. The flag with no names is a usage error.                                                                                                                                               |
| `--currencies <list>`           | Comma-separated currencies to offer: `usd`, `eur`, `tix`. Default: the currencies of the enabled [`priceSources`](/configuration/#price-stores-pricesources). Narrows that set, never adds to it.                                                                                                         |
| `--refresh <mode>`              | Card cache refresh policy: `ask` (default), `auto`, `no-bulk`, or `never`. See [Card Cache Refresh](#card-cache-refresh).                                                                                                                                                                                 |
| `--theme <name>`                | Initial theme for first-time visitors: a built-in name or a custom name from `--theme-file`. Default: `default`.                                                                                                                                                                                          |
| `--theme-file <path...>`        | Load custom theme JSON files. Each is added to the theme list under its declared `name`.                                                                                                                                                                                                                  |
| `--locale <tag>`                | Interface language the site opens in (BCP-47, e.g. `de-AT`). Default: the [`uiLocale`](/configuration/#interface-language) config value. This is Ritual's own text, **not** the card language. See [Localized builds](#localized-builds).                                                                 |
| `--locales <tags...>`           | Locale dictionaries to publish into `dist/locales/` for the in-app language switcher. Default: `en`. `all` publishes every locale this build has.                                                                                                                                                         |
| `--locale-file <path...>`       | Load locale dictionary JSON files, each named for its tag (`de-AT.json`). Their locales become selectable alongside the built-in ones.                                                                                                                                                                    |
| `--moxfield-user-agent <agent>` | Moxfield-approved unique User-Agent string. Required for Moxfield deck URLs unless `MOXFIELD_USER_AGENT` is set.                                                                                                                                                                                          |
| `--out-dir <path>`              | Publish into this directory instead of `dist/`. A relative path resolves against the Ritual directory. **The build replaces the directory**, so the Ritual directory itself or any ancestor of it (`.`, `..`, `/`) is refused. See [Output](#output).                                                     |
| `--sell-mode`                   | Offer [sell mode](/public-site/sell/) for this run even when [`site.sellMode`](/configuration/#offering-sell-mode-sellmode) is off. Refreshes the Card Kingdom buylist (~70 MB) if it is missing or stale, and writes its buy prices into the site. Enable-only. See [Sell mode](#sell-mode---sell-mode). |

`--out-dir` is useful for building a preview beside the published site. [`serve --out-dir`](/commands/serve/) can then serve it without rebuilding.

## Examples

Build the site for every published list:

```bash
ritual build-site
```

Build the site for specific decks:

```bash
ritual build-site --decks "Atraxa Superfriends" "Mono Red Aggro"
```

Build with verbose output:

```bash
ritual build-site --verbose
```

Build with downloaded local deck card images:

```bash
ritual build-site --cache-images
```

Build directly from a URL (see [Building decks from URLs](#building-decks-from-urls)):

```bash
ritual build-site --decks https://archidekt.com/decks/12345
```

Build with specific collections:

```bash
ritual build-site --collections "Red Binder" "ECL"
```

Build with specific wanted lists:

```bash
ritual build-site --wanted-lists "High Priority" "Trade Targets"
```

Without `--currencies`, the site offers the currencies its enabled [price stores](/configuration/#price-stores-pricesources) quote in: USD for `tcgplayer` and `cardkingdom`, EUR for `cardmarket`, TIX for `cardhoarder`. The default `["tcgplayer"]` builds a USD-only site. `--currencies` narrows and reorders that set for one build; the first listed currency is the default. A currency with no enabled store behind it is dropped, and a list that keeps none is refused with exit code `2`. To offer TIX, add `cardhoarder` to `priceSources`.

Build with EUR only:

```bash
ritual build-site --currencies eur
```

Build with USD and EUR, USD first:

```bash
ritual build-site --currencies "usd,eur"
```

## Choosing which lists to build

Without `--decks`, `--collections`, or `--wanted-lists`, the build uses the publish lists in your [site configuration](/configuration/#choosing-which-lists-to-publish): `site.includeDecks`, `site.includeCollections`, and `site.includeWantedLists`. Each defaults to `["*"]` (everything), so a fresh project builds all lists.

Set a list to specific **display names** to publish only those lists:

```json
"site": {
  "includeDecks": ["Izzet Storm", "Atraxa Superfriends"],
  "includeCollections": ["*"],
  "includeWantedLists": []
}
```

This publishes those two decks, every collection, and no wanted lists.

Each category also has an `exclude*` list (`site.excludeDecks`, `site.excludeCollections`, `site.excludeWantedLists`). It drops lists by display name even when the `include*` list selects them; exclusion always wins. Exclude lists default to empty and have no wildcard. For example, `"includeDecks": ["*"]` with `"excludeDecks": ["Untuned Brew"]` publishes every deck except "Untuned Brew".

A flag overrides both the `include*` and `exclude*` lists for its category in that run. `--decks "Mono Red Aggro"` builds just that deck regardless of config.

Edit these lists from the admin **Settings** page, the admin **Manage Lists** page ([publishing visibility](/admin/manage-lists/#publishing-visibility)), [`config set`](/commands/config/), or by hand.

Each collection card must have a set code and collector number (`- Sol Ring (C19:221)`). Cards without one are skipped with a warning.

## Building decks from URLs

`--decks` also accepts deck URLs. They are fetched at build time through the same services as [`import`](/commands/import/):

- **Archidekt**: `https://archidekt.com/decks/<id>`
- **Moxfield**: `https://moxfield.com/decks/<id>`
- **MTGGoldfish**: any `mtggoldfish.com` deck URL

Moxfield requires a unique, Moxfield-approved User-Agent string. Pass `--moxfield-user-agent <agent>` or set the `MOXFIELD_USER_AGENT` environment variable.

A URL deck is a source you named, so a URL that cannot be fetched fails the whole build with exit code `1`. This includes a Moxfield URL without a User-Agent, an `http(s)` URL that matches no supported service, and a dead link. See [When a list will not build](#when-a-list-will-not-build).

URL decks have no local file, so the site shows no changelog and no file timestamp for them.

```bash
ritual build-site --decks https://moxfield.com/decks/abc123 --moxfield-user-agent "YourName Ritual Build/1.0"
```

## Themes

Visitors can switch themes at runtime. `--theme` sets the **initial** theme, what a first-time visitor sees. Ten Magic "guild" palettes are available alongside the default. Each has a background color and a contrasting highlight color for buttons, focus rings, and accents:

| Theme      | Background  | Highlight |
| ---------- | ----------- | --------- |
| `default`  | dark violet | violet    |
| `orzhov`   | dark gray   | white     |
| `izzet`    | dark blue   | red       |
| `gruul`    | dark green  | red       |
| `rakdos`   | dark gray   | red       |
| `selesnya` | off-white   | green     |
| `azorius`  | off-white   | blue      |
| `boros`    | off-white   | red       |
| `dimir`    | dark gray   | blue      |
| `simic`    | dark blue   | green     |
| `golgari`  | dark gray   | green     |

Append `-inverted` to any name (`azorius-inverted`, `boros-inverted`) for a variant that swaps background and highlight, with shades adjusted to stay readable.

The flame logo (header icon and favicon) is tinted from the theme's accent, so it recolors with the theme.

```bash
ritual build-site --theme izzet
ritual build-site --theme boros-inverted
```

### Custom themes

The header's **Theme** button opens a picker listing every built-in palette with a preview swatch. Clicking one switches the theme. If the visitor has unsaved customizations, the picker asks before discarding them. Only the chosen theme name and any explicit overrides are stored in `localStorage`, so visitors who have not customized pick up updated built-in palettes on the next build.

The picker's **Customize theme…** entry opens the in-browser **theme editor**. It exposes every CSS variable as a labeled control, grouped into tabs: OKLch sliders for colors, number inputs for sizes, a 0–1 input for opacities, and a **Flame icon** group for the logo's six gradient stops. You can start from any built-in palette, and changes preview live across all pages. Edits persist in `localStorage`.

The editor's **Download JSON** button exports the variables as a `.json` file. Pass that file to `--theme-file` to build it into the site:

```bash
ritual build-site --theme-file ./my-palette.json
ritual build-site --theme-file ./palette-a.json --theme-file ./palette-b.json
ritual build-site --theme-file ./my-palette.json --theme my-palette
```

Each `--theme-file` adds a theme under the `name` declared in the JSON. Combine it with `--theme <custom-name>` to make that theme the initial one. The JSON shape is:

```json
{
  "name": "my-palette",
  "description": "Optional human-readable description",
  "variables": {
    "--bg-body": "oklch(20% 0.02 260)",
    "--accent": "oklch(60% 0.15 320)"
  }
}
```

Theme names must be lowercase letters, digits, and hyphens, and may not match a built-in theme name.

## Localized builds

The interface language works like the theme. Dictionaries are published as data files beside the app, so one build can carry several languages and visitors switch between them without a reload.

| Flag                      | What it decides                                                                                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--locale <tag>`          | The language the site **opens in**. Sets `<html lang>` and `dir` before first paint and `index.json.uiLocale`. Default: `uiLocale` config.                            |
| `--locales <tags...>`     | Which dictionaries land in `dist/locales/` and in `index.json.availableLocales`, which the switcher lists. Default `en`; `all` publishes every locale this build has. |
| `--locale-file <path...>` | Loads a dictionary JSON from disk. The **file name is the locale tag** (`de-AT.json`).                                                                                |

```bash
ritual build-site --locales en de --locale de     # opens in German, English available
ritual build-site --locales all                   # every dictionary this build has
ritual build-site --locale-file ./de-AT.json --locales en de-AT
```

`--locales` tags are **space-separated**, like `--decks` and `--theme-file`. (`--currencies` is the one comma-separated flag.) English is always published whether or not you list it.

`--locale-file` lets a released binary publish a language it was never built with. Hand it a validated dictionary and that locale becomes selectable like a built-in one.

Details:

- **The `--locale` language is always published.** `--locale de` implies `de` in the emitted set.
- **A `--locale` with no dictionary is a warning, not a failure.** Messages fall back to English key by key and the build continues. A tag named by `--locales` with no dictionary **is** an error.
- **The language switcher appears only when more than one locale was published.** An English-only build shows none.
- A failed locale build leaves the previously published site standing, like any other build failure. See [Output](#the-output-directory-is-replaced-never-half-written).

For per-locale URL prefixes (SEO or CDN path routing), build once per locale:

```sh
for tag in en de ja; do
  ritual build-site --locale "$tag" --locales "$tag" --out-dir "dist/$tag"
done
```

`--locale` changes Ritual's own text, **not** the card language. Which printing of a card is shown is [`defaultLanguage`](/configuration/#default-language)'s job. See [Localization](/localization/), including the note that no translations ship yet.

## Output

The build writes a single-page application into `dist/` (or `--out-dir`):

- `index.html`: the app shell
- `app.js`: the bundled app with client-side routing
- `index.json`: the list index, plus the build's config: [`site.apiBaseUrl`](/configuration/#pointing-a-static-build-at-a-live-backend-apibaseurl) when a [live backend](/public-site/hosted/) is configured, whether [sell mode](#sell-mode---sell-mode) is offered, the [`priceSources`](/configuration/#price-stores-pricesources) store list, the [`defaultCategories`](/configuration/#default-categories) vocabulary for the editors' category suggestions, and `uiLocale` and `availableLocales` from [the locale flags](#localized-builds)
- `boot.js`: a small bootstrap that applies the stored theme and sets `<html lang>`/`dir` before first paint
- `locales/{tag}.json`: one message dictionary per published locale, fetched when a visitor switches language
- `decks/{slug}.json`, `collections/{slug}.json`, `wanted/{slug}.json`: full list data with pricing, loaded on demand
- `art/{path}`: [custom card art](/custom-art/) referenced by any published list, copied from the art directory under the same relative path. A referenced file that is missing on disk is a build warning; the card falls back to its normal art
- `styles.css`: the bundled CSS

Each list file also carries:

- That list's [categories](/commands/categories/): the vocabulary and per-name assignments from its `.categories.json` file. Problems with that file (unreadable, or entries naming cards the list no longer holds) are printed with the list's other warnings.
- Its Card Kingdom quotes (buy and NM retail prices) and Card Kingdom's own [printing picks](/public-site/prices/#which-printing-a-card-is-priced-at) for name-only lines, when [sell mode](#sell-mode---sell-mode) is on or `priceSources` includes `cardkingdom`. With the `cardkingdom` store, the quotes cover every printing the list carries at every finish, so the card modal's other-printings grid and the printing pickers work with no backend.

The site is responsive, supports dark mode, and uses hash routing: `#/` for the index, `#/deck/{slug}`, `#/collection/{slug}`, and `#/wanted/{slug}`. A navigation bar with "Decks", "Collections", and "Wanted" links stays visible on every page.

### The output directory is replaced, never half-written

Every build (CLI, the admin site's "Build Site" page, and the `build_site` MCP tool) writes into a scratch directory beside the target and renames it into place only after the build succeeds. The output directory always holds either the previous site or the new one. A build that fails partway leaves the published site untouched.

Because a successful build **replaces** its output directory, `--out-dir` is refused with exit code 2 when the path is blank, is the Ritual directory itself, or **contains** the Ritual directory. `--out-dir .` would otherwise delete your decks, collections, and `.git`.

```
$ ritual build-site --out-dir .
--out-dir may not be the Ritual directory itself (/home/you/ritual) — it is the
site's output directory: a build replaces it wholesale, and serving it would
publish your lists.
```

### Scratch directories beside the output

You may see directories named `.dist-build-XXXXXX` and `.dist-old-<pid>-<timestamp>` next to `dist/`. They are build scratch, not part of the site, and always safe to delete:

| Directory                     | What it is                                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `.dist-build-XXXXXX`          | The directory a build writes into before renaming it onto `dist/`. The random suffix lets several builds run side by side.      |
| `.dist-old-<pid>-<timestamp>` | The **previous** site, parked briefly during the swap so it can be restored if the swap fails. Removed once the new site is in. |

A build that runs to completion, whether it succeeds or fails, removes its own scratch directory. A leftover means a build was killed first: `Ctrl-C`, a crash, or a cancelled build from the admin site or the `build_site` MCP tool. An admin-triggered build can leave two, one from the admin server and one from the `ritual build-site` process it spawns.

The next build removes leftovers **older than six hours**. Younger ones are left alone because they could belong to a build still running. Deleting them by hand is fine.

`ritual init-site` adds both patterns to `.gitignore`, so they stay out of your repository even under a [local-build deploy](/commands/init-site/#generated-files) that commits its built site.

## When a list will not build

A list named on the command line that cannot be loaded **fails the build**. Every such source is listed in a closing summary, the exit code is `1`, and nothing is published.

```
$ ritual build-site --decks "Nonexistant Deck"
Failed to load deck 'Nonexistant Deck': no deck named that in /home/you/ritual/decks

⚠️  1 source could not be built:
  - deck 'Nonexistant Deck': no deck named that in /home/you/ritual/decks
The published site was left unchanged.
```

This covers every way a named source can fail: no such list, a list that cannot be read (broken front matter, bad permissions), a name more than one list matches, and a deck URL that could not be fetched. The printed reason is the real one; an unreadable file reports why, not "no deck named that".

A source selected by `site.include*` rather than named on the command line is reported the same way, but the rest of the site is published without it and the build exits `0`.

```
$ ritual build-site
Failed to load deck 'winota': unexpected end of the stream within a flow collection

⚠️  1 source could not be built:
  - deck 'winota': unexpected end of the stream within a flow collection
The site was published without them.
```

Names given to `--decks`, `--collections`, and `--wanted-lists` match a list's display name or file base name, ignoring case, accents, and `-`/`_` (the folding described in [list resolution](/list-resolution/#what-folding-ignores)), with a trailing `.md` accepted. Unlike other commands, a build never accepts a partial (substring) name, since it publishes whatever it resolves. A name that matches two lists is reported rather than resolved to either:

```
Failed to load deck 'Burn': matches 2 decks (Burn, Burn) — name one exactly
```

The `site.include*` config lists match the **display name exactly**. An entry that matches no list is a **warning**, not a failure, since config drifts when a list is renamed:

```
⚠️  site.includeDecks lists 'Old Name', which matches no deck in /home/you/ritual/decks — it may have been renamed or removed.
```

A workspace with no lists at all (including one where `decks/`, `collections/`, and `wanted/` do not exist yet) exits `1`:

```
Nothing to build: no decks, collections, or wanted lists were found. Create one
with `ritual new deck "My Deck"` (or run `ritual edit`), then build again.
```

If nothing was priced, the build exits `1` and says why. When every selected list is empty: `No cards to price: every selected list is empty, so there is nothing to build.` When the lists hold cards but the cache has no prices for them: `No price data found in the card cache. Run \`ritual cache preload-all\` first, or re-run with --refresh auto to download it.`

## Card Cache Refresh

A build gets card data and prices in four steps, in order:

1. **Automatic bulk download**: if the cache is empty, more than a week old, or missing more than 100 of the requested cards, the full Scryfall bulk dataset is downloaded first (the same as `ritual cache preload-all`).
2. **Bulk price-refresh prompt**: otherwise, if more than 100 cards have prices older than 24 hours, the build offers a bulk redownload instead of refreshing each card individually:

   ```
   287 of 320 card(s) have prices older than 24 hours.
   Redownloading the Scryfall bulk card cache (includes fresh prices) would be faster than refreshing each card individually.
   Redownload the latest Scryfall card cache now? [y/N]
   ```

3. **Per-card fetch**: every card whose cached price is older than 24 hours is refetched individually. Cards with fresh prices come from the cache.
4. **Tag download**: if none of the build's cards carry oracle/art tags (needed by the site's [tag filters](/public-site/filtering/)), the build offers to download them into the cache. The prompt defaults to **Yes**. Under `no-bulk` or `never` the download is skipped and the tag filters stay empty for that build.

When prompts are unavailable (stdin is not a TTY, or `--no-input` / `RITUAL_NO_INPUT` is set; see [When prompts are unavailable](/cli-conventions/#when-prompts-are-unavailable)), every prompt is **declined**, never answered with its default. This covers steps 2 and 4.

Step 1 is **not** a prompt. Under `ask` (the default) and `auto`, an empty, week-old, or badly incomplete cache is downloaded automatically, headless or not, because the build has no usable card data otherwise. Pass `--refresh no-bulk` or `--refresh never` to suppress it.

### The `--refresh` mode

`--refresh <mode>` answers the prompts non-interactively and controls the bulk download:

| Mode                | Automatic bulk download (step 1) | Bulk price-refresh prompt (step 2)   | Per-card refresh of stale prices (step 3) | Tag download (step 4)                | Symbology download                   |
| ------------------- | -------------------------------- | ------------------------------------ | ----------------------------------------- | ------------------------------------ | ------------------------------------ |
| `ask` (the default) | Runs automatically               | Prompts (declined when unanswerable) | Yes                                       | Prompts (declined when unanswerable) | Yes, when not cached                 |
| `auto`              | Runs automatically               | Yes, without prompting               | Yes                                       | Yes, without prompting               | Yes, when not cached                 |
| `no-bulk`           | **Suppressed**                   | **Skipped**                          | Yes                                       | **Skipped**                          | Yes, when not cached                 |
| `never`             | **Suppressed**                   | **Skipped**                          | **No** (uses cached prices as-is)         | **Skipped**                          | **Skipped** (warns; symbols missing) |

[`serve --api`](/commands/serve/#live-api-mode---api) runs steps 1, 2, and 4 at startup over the cards its served lists reference. It never runs step 3, since a live server only reads the cache, so on a warm cache `no-bulk` and `never` behave the same.

```bash
ritual build-site --refresh auto     # fastest full refresh, no prompts
ritual build-site --refresh no-bulk  # refresh prices without the big download
ritual build-site --refresh never    # build from the existing cache
```

> **Note on `never`:** a card the cache does not hold at all is still fetched individually in step 3, since a card with no data cannot be rendered. With no cached symbology, the build warns and the site renders without mana symbols. Re-run with `--refresh auto` to download them.

> **Note:** `no-bulk` and `never` suppress the automatic bulk download (step 1). On an empty or very stale cache every card is then fetched individually, which is slow and can hit Scryfall rate limits. Use them when you already have a populated cache.

`bun run dev serve` requires an explicit `--refresh` mode. See [Development → Dev Workflow](/development/#dev-workflow).

## Sell mode (`--sell-mode`)

[Sell mode](/public-site/sell/) adds Card Kingdom buylist prices beside each card, buylist filters, grouping and sorting, and a sell-cart export. It is **off by default**. Turn it on for the workspace with [`ritual config set site.sellMode true`](/configuration/#offering-sell-mode-sellmode), or for one build:

```bash
ritual build-site --sell-mode
```

The flag is enable-only (there is no `--no-sell-mode`). Without it, the build follows the config.

When sell mode is on, or [`priceSources`](/configuration/#price-stores-pricesources) includes `cardkingdom` (whose retail prices come from the same feed), the build does three extra things:

1. **Refreshes the Card Kingdom buylist** before fetching card data, under this run's `--refresh` mode. A feed less than a day old is used as-is. A day-old feed is redownloaded under `ask`/`auto` and kept under `no-bulk`/`never`. A **missing** feed is downloaded under `auto` and prompted for under `ask` (default yes, ~70 MB). See [`sell` → Feed freshness](/commands/sell/#feed-freshness).
2. **Picks Card Kingdom's own printings** when `priceSources` includes `cardkingdom`. A card line with no printing gets a representative and a cheapest printing chosen from Card Kingdom's catalog at Card Kingdom's prices, stored beside the Scryfall picks so the site can switch stores without a rebuild. See [Which printing a card is priced at](/public-site/prices/#which-printing-a-card-is-priced-at).
3. **Writes the buy prices into each list's JSON.** Every printing a list displays is quoted from the feed, so the published site offers sell mode with **no backend**. A static host on a CDN offers it exactly as a [live one](/public-site/hosted/) does. Non-English copies are never quoted; Card Kingdom's feed is English-only.

   With `priceSources` including `cardkingdom`, every printing each list carries is quoted at every finish, so the card modal's other-printings grid and the [printing pickers](/public-site/prices/#the-prices-selector) can price printings no tile displays. A sell-mode-only build quotes the displayed printings alone.

The build reports what it used:

```
Card Kingdom buylist ready (61948 items).
```

**A buylist problem never fails the build.** A declined prompt, a `--refresh never` run with no cached feed, or a failed download warns and builds the site without buy prices:

```
⚠️  Sell mode is on but the Card Kingdom buylist is unavailable, so the site is built without buy
prices. No Card Kingdom buylist has been downloaded yet. Re-run with --refresh auto to download it (~70 MB).
```

Such a site still offers the sell mode toggle (`index.json` carries the flag). Turning it on shows a "buylist prices are unavailable" notice. Rebuild once a feed exists to fill the prices in.

With sell mode **off** and no `cardkingdom` store, no Card Kingdom work happens: no download, no quoting, and the list files carry no buylist field.

## Serving the Site

After building, preview the site locally with [`serve`](/commands/serve/):

```bash
ritual serve
```

To build and serve in one step, pass `--build`:

```bash
ritual serve --build
```
