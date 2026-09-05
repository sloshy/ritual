---
title: 'build-site'
---

Generate the [public site](/public-site/): a static website for your decks, collections, and wanted lists.

This page covers the build itself: which lists it publishes, themes and languages, where the output goes, and how the card cache is refreshed. What the finished site can do is documented in the [Public Site](/public-site/) section.

## Usage

```bash
ritual build-site [options]
```

## Options

| Option                          | Description                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-v, --verbose`                 | Show list of cards being fetched from Scryfall                                                                                                                                                                                                                                                                                                                                                                        |
| `--cache-images`                | Download deck card images into `dist/images` and use them instead of the Scryfall URLs the card data carries                                                                                                                                                                                                                                                                                                          |
| `--decks [names...]`            | Deck names (display name or file base name) or URLs to include in the site (default: the `site.includeDecks` config selection). Passing the flag with no names is a usage error, not "build everything".                                                                                                                                                                                                              |
| `--collections [names...]`      | Collection names (display name or file base name) to include in the site (default: the `site.includeCollections` config selection). Passing the flag with no names is a usage error, not "build everything".                                                                                                                                                                                                          |
| `--wanted-lists [names...]`     | Wanted list names (display name or file base name) to include in the site (default: the `site.includeWantedLists` config selection). Passing the flag with no names is a usage error, not "build everything".                                                                                                                                                                                                         |
| `--currencies <list>`           | Comma-separated currencies to include on the site: `usd`, `eur`, `tix` (default: all three)                                                                                                                                                                                                                                                                                                                           |
| `--refresh <mode>`              | Card cache refresh policy: `ask` (default — bulk-downloads an empty or stale cache **without asking**, prompts for the price and tag refreshes), `auto`, `no-bulk`, or `never`. See [Card Cache Refresh](#card-cache-refresh).                                                                                                                                                                                        |
| `--theme <name>`                | Initial theme served to first-time visitors (built-in name or a custom name from `--theme-file`). Defaults to `default`.                                                                                                                                                                                                                                                                                              |
| `--theme-file <path...>`        | Load one or more custom theme JSON files; each is added to the runtime theme list under its declared `name`.                                                                                                                                                                                                                                                                                                          |
| `--locale <tag>`                | UI locale baked into the generated site (BCP-47, e.g. `de-AT`): the `<html lang>`/`dir` and the language the site opens in. Defaults to the [`uiLocale`](/configuration/#interface-language) config value. Ritual's own text — **not** the card language. See [Localized builds](#localized-builds).                                                                                                                  |
| `--locales <tags...>`           | Which locale dictionaries to publish into `dist/locales/`, which is what the in-app language switcher offers. Default: `en`. `all` publishes every locale this build has.                                                                                                                                                                                                                                             |
| `--locale-file <path...>`       | Load one or more locale dictionary JSON files, each named for its tag (`de-AT.json`); their locales become selectable alongside the built-in ones. The locale analogue of `--theme-file`.                                                                                                                                                                                                                             |
| `--moxfield-user-agent <agent>` | Moxfield-approved unique User-Agent string (required for Moxfield deck URLs unless `MOXFIELD_USER_AGENT` is set)                                                                                                                                                                                                                                                                                                      |
| `--out-dir <path>`              | Publish into this directory instead of `dist/`. A relative path resolves against the Ritual directory. **The directory is replaced by the build**, so it is refused when it is the Ritual directory itself or any ancestor of it (`.`, `..`, `/`) — see [Output](#output). Useful for building a preview alongside the published site, which [`serve --out-dir`](/commands/serve/) can then serve without rebuilding. |
| `--sell-mode`                   | Offer [sell mode](/public-site/sell/) for this run even when [`site.sellMode`](/configuration/#offering-sell-mode-sellmode) is off: update the Card Kingdom buylist (~70 MB) and bake its buy prices into the site. Enable-only — omitting it follows the config. See [Sell mode](#sell-mode---sell-mode).                                                                                                            |

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

Build with EUR as the default price currency:

```bash
ritual build-site --currencies eur
```

Build with only USD and EUR (no TIX):

```bash
ritual build-site --currencies "usd,eur"
```

## Choosing which lists to build

When the `--decks`, `--collections`, and `--wanted-lists` flags are omitted, `build-site` falls back to the publish lists in your [site configuration](/configuration/#choosing-which-lists-to-publish): `site.includeDecks`, `site.includeCollections`, and `site.includeWantedLists`. Each defaults to the wildcard `["*"]` (build everything), so a fresh project builds all lists with no extra configuration.

Setting a list to specific **display names** publishes only those lists and filters out the rest. For example, with:

```json
"site": {
  "includeDecks": ["Izzet Storm", "Atraxa Superfriends"],
  "includeCollections": ["*"],
  "includeWantedLists": []
}
```

`build-site` publishes only those two decks, every collection, and no wanted lists. The matching flag always overrides the config for that category in a single run, bypassing both the `include*` and `exclude*` lists. `--decks "Mono Red Aggro"` builds just that deck regardless of `includeDecks` or `excludeDecks`.

Each category also has an `exclude*` list (`site.excludeDecks`, `site.excludeCollections`, `site.excludeWantedLists`) that drops lists by display name even when the `include*` list selects them. Exclusion always wins. The exclude lists default to empty and have no wildcard. For example, `"includeDecks": ["*"]` with `"excludeDecks": ["Untuned Brew"]` publishes every deck except "Untuned Brew". The admin **Manage Lists** page toggles these per list; see [publishing visibility](/admin/manage-lists/#publishing-visibility).

You can edit these lists from the admin **Settings** page, with [`config set`](/commands/config/), or by hand.

Each collection card must have a set code and collector number (`- Sol Ring (C19:221)`). Cards without this information are skipped with a warning.

## Building decks from URLs

Entries passed to `--decks` can be deck URLs instead of local deck names. URL decks are fetched at build time through the same dispatch as [`import`](/commands/import/), so all three supported services work:

- **Archidekt**: `https://archidekt.com/decks/<id>`
- **Moxfield**: `https://moxfield.com/decks/<id>`
- **MTGGoldfish**: any `mtggoldfish.com` deck URL

Moxfield requires a unique, Moxfield-approved User-Agent string. Pass `--moxfield-user-agent <agent>` or set the `MOXFIELD_USER_AGENT` environment variable.

A URL deck comes from `--decks`, so it is a source you **named**. If it cannot be fetched (a Moxfield URL given without a User-Agent, an `http(s)` URL that matches no supported service, a dead link), the whole build fails with exit code `1` and nothing is published. See [When a list will not build](#when-a-list-will-not-build).

URL decks have no local file, so they carry no changelog and no file timestamp on the generated site.

```bash
ritual build-site --decks https://moxfield.com/decks/abc123 --moxfield-user-agent "YourName Ritual Build/1.0"
```

## Themes

The generated site ships with multiple themes that visitors can switch between at runtime. The `--theme` flag controls which theme is the **initial** one, what visitors see on first visit before they pick something. Ten Magic-flavored "guild" palettes are available alongside the default, each with a primary background color and a contrasting highlight color used for buttons, focus rings, and accents:

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

Each theme also has an inverted variant, reached by appending `-inverted` to its name (`azorius-inverted`, `boros-inverted`). Inverted themes swap the background and highlight colors so the highlight becomes the dominant background and the original background becomes the accent. Shade and intensity are adjusted so the resulting palette stays comfortable to read.

The app's flame logo, both the header icon and the browser-tab favicon, is tinted from each theme's accent, so switching themes recolors the icon to match: a vivid flame for saturated accents, a pale "white flame" for near-neutral ones.

```bash
ritual build-site --theme izzet
ritual build-site --theme boros-inverted
```

### Custom themes

The header's **Theme** button opens a picker popover listing every built-in palette with a preview swatch. Clicking a palette switches the base theme. If the visitor has in-progress customizations, the picker first asks for confirmation before discarding them. Only the chosen theme name (and any explicit overrides) is stored in `localStorage`, so when a future build ships updated built-in palettes, visitors who haven't customized see those updates automatically.

For per-variable tweaks, the picker has a **Customize theme…** entry that opens the in-browser **theme editor**. The editor exposes every CSS variable as a labeled control (OKLch sliders for colors, number inputs for sizes, and a unitless 0–1 input for opacities such as the secondary-card dimming) grouped into tabs, including a **Flame icon** group for the six gradient stops of the app logo. It lets the user start from any built-in palette, and live-previews changes across all pages (the flame logo and favicon recolor as you drag). The user's edits persist in `localStorage` so later visits restore their custom palette.

A **Download JSON** button in the editor exports the full set of variables as a `.json` file. To bake one of those palettes back into a build, pass it to `--theme-file`:

```bash
ritual build-site --theme-file ./my-palette.json
ritual build-site --theme-file ./palette-a.json --theme-file ./palette-b.json
ritual build-site --theme-file ./my-palette.json --theme my-palette
```

Each `--theme-file` adds a custom theme alongside the built-ins under the `name` field declared in the JSON. Combining `--theme-file` with `--theme <custom-name>` makes that custom theme the initial default for new visitors. The JSON shape is:

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

Theme names must be lowercase letters, digits, and hyphens, and may not collide with any built-in theme name.

## Localized builds

The site's interface language works much like its theme. Dictionaries are **data**, published beside the app rather than compiled into it, so one build can carry several languages and visitors switch between them at runtime with no reload.

Three flags control it:

| Flag                      | What it decides                                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--locale <tag>`          | The language the site **opens in**. Stamps `<html lang>` and `dir` before first paint, and sets `index.json.uiLocale`. Defaults to the `uiLocale` config value.           |
| `--locales <tags...>`     | Which dictionaries land in `dist/locales/`. Default `en`; `all` publishes every locale this build has. Populates `index.json.availableLocales`, which the switcher lists. |
| `--locale-file <path...>` | Loads a dictionary JSON from disk at build time. The **file name is the locale tag** (`de-AT.json`), matching the layout translators work in.                             |

```bash
ritual build-site --locales en de --locale de     # opens in German, English available
ritual build-site --locales all                   # every dictionary this build has
ritual build-site --locale-file ./de-AT.json --locales en de-AT
```

`--locales` is variadic, so its tags are **space-separated**, like `--decks` and `--theme-file` (unlike `--currencies`, which takes one comma-separated value). English is always emitted whether or not you list it.

`--locale-file` is the locale analogue of `--theme-file`, and it is how a **released binary publishes a language it was never built with**. Hand it a validated dictionary and that locale becomes selectable like any built-in one.

Details worth knowing:

- **The baked locale is always published.** A site whose shell says `lang="de"` must be able to fetch the German dictionary it names, so `--locale de` implies `de` in the emitted set.
- **A baked locale with no dictionary is a warning, not a failure.** A catalog with zero coverage is just the degenerate case of a partial one, and messages fall back to English key by key. The build says so and continues. A tag named by `--locales` that has _no_ dictionary is an error, because naming files to emit is that flag's entire job.
- **The language switcher appears only when more than one locale was published.** A picker with one option is noise, so an English-only build shows none.
- Everything is written into the build's scratch directory and swapped in atomically like the rest of the site, so a failed locale build leaves the previously published site standing. See [Output](#the-output-directory-is-replaced-never-half-written).

Per-locale URL prefixes (for SEO or CDN path routing) are just a loop. No special mode exists:

```sh
for tag in en de ja; do
  ritual build-site --locale "$tag" --locales "$tag" --out-dir "dist/$tag"
done
```

This is **not** the card language. `--locale` changes what language Ritual's own text is in; which printing of a card is shown is [`defaultLanguage`](/configuration/#default-language)'s job. See [Localization](/localization/) for the full picture, including that no translations ship yet.

## Output

The build generates a single-page application in the `dist/` directory (or the `--out-dir` directory) containing:

- `index.html`: the SPA shell that loads the application
- `app.js`: the bundled SPA with client-side routing
- `index.json`: the deck and collection listing used by the index page. It also carries the baked config: [`site.apiBaseUrl`](/configuration/#pointing-a-static-build-at-a-live-backend-apibaseurl) when a [live backend](/public-site/hosted/) is configured, whether [sell mode](#sell-mode---sell-mode) is offered, the [`priceSources`](/configuration/#price-stores-pricesources) store list, the [`defaultCategories`](/configuration/#default-categories) vocabulary that seeds the site editors' category suggestions, plus `uiLocale` and `availableLocales` from [the locale flags](#localized-builds)
- `boot.js`: a tiny same-origin bootstrap that applies the stored theme and stamps `<html lang>`/`dir` before first paint
- `locales/{tag}.json`: one message dictionary per published locale, fetched on demand when the visitor switches language
- `decks/{slug}.json`: full deck data loaded on demand
- `collections/{slug}.json`: full collection data with pricing loaded on demand
- `wanted/{slug}.json`: full wanted list data with pricing loaded on demand
- `art/{path}`: [custom card art](/custom-art/) files referenced by any published list, copied out of the configured art directory under their art-dir-relative path (once per unique path, so lists sharing an image share the file). A referenced file that is not on disk is a build warning and is left out of the baked data, so the card falls back to its normal art
- `styles.css`: the bundled CSS

The three list files carry more than cards. Each of these three also carries that list's baked Card Kingdom quotes (buy **and** NM retail prices), plus Card Kingdom's own [printing picks](/public-site/prices/#which-printing-a-card-is-priced-at) for its name-only lines, when [sell mode](#sell-mode---sell-mode) is on or [`priceSources`](/configuration/#price-stores-pricesources) includes `cardkingdom`. Under the `cardkingdom` price store the quotes cover every printing the list _carries_, at every finish, not just the ones its tiles display, so the card modal's other-printings grid and the printing pickers can price them with no backend. Each list's detail also carries that list's [categories](/commands/categories/): the build reads its `.categories.json` sidecar, bakes the vocabulary and per-name assignments into the JSON alongside each card's own categories, and prints the sidecar's warnings (unreadable file, entries naming cards the list no longer holds) with that list's other warnings.

The site is responsive for desktop and mobile, supports dark mode, uses client-side hash routing (`#/` for the index, `#/deck/{slug}`, `#/collection/{slug}`, and `#/wanted/{slug}` for list pages), keeps a navigation bar with "Decks", "Collections", and "Wanted" links always visible, and animates page transitions.

### The output directory is replaced, never half-written

Every build (the CLI, the admin site's "Build Site" page, and the `build_site` MCP tool) writes into a scratch directory beside the target and renames it into place only once the build has succeeded. The output directory therefore holds either the previous site or the new one at every instant. A build that fails partway (an unusable card cache, a cold network, a list that will not load) leaves the site you already published exactly as it was.

Because a successful build **replaces** its output directory, `--out-dir` is still a destructive flag. It is refused with exit code 2 when the path it resolves to is blank, is the Ritual directory itself, or **contains** the Ritual directory. `--out-dir .` would otherwise delete your decks, collections, and `.git`.

```
$ ritual build-site --out-dir .
--out-dir may not be the Ritual directory itself (/home/you/ritual) — it is the
site's output directory: a build replaces it wholesale, and serving it would
publish your lists.
```

### Scratch directories beside the output

The mechanism above is why you will occasionally see directories named `.dist-build-XXXXXX` and `.dist-old-<pid>-<timestamp>` sitting next to `dist/`. They are build scratch, never part of the published site, and always safe to delete by hand:

| Directory                     | What it is                                                                                                                                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.dist-build-XXXXXX`          | The directory the build is writing into, before it is renamed onto `dist/`. The random suffix lets several builds — a CLI build, the admin server, `ritual mcp` — run beside the same output without colliding. |
| `.dist-old-<pid>-<timestamp>` | The **previous** site, parked aside for the width of two renames so it can be restored if the swap fails. It is removed as soon as the new site is in place.                                                    |

A build that runs to completion, success or failure, removes its own scratch directory. One left behind means a build was killed before it could clean up: `Ctrl-C`, a crash, or cancelling a build from the admin site or the `build_site` MCP tool. An admin-triggered build leaves up to two, because the admin server creates a scratch directory and the `ritual build-site` child process it spawns creates its own inside the same parent.

Leftovers are reclaimed automatically, but not immediately. The next build sweeps abandoned scratch directories **older than six hours** before it starts. The delay is deliberate: a sweep cannot tell its own debris from a scratch directory another build is using right now, so it goes by age rather than by name and never touches anything a concurrent build could still be holding. If you build less often than that, deleting them yourself is fine.

`ritual init-site` adds both patterns to `.gitignore`, so they stay out of your repository even under a [local-build deploy](/commands/init-site/#generated-files) that commits its built site.

## When a list will not build

A list named on the command line that cannot be loaded **fails the build**. Every such source is listed in a closing summary, the exit code is `1`, and nothing is published. The previous site stays up.

```
$ ritual build-site --decks "Nonexistant Deck"
Failed to load deck 'Nonexistant Deck': no deck named that in /home/you/ritual/decks

⚠️  1 source could not be built:
  - deck 'Nonexistant Deck': no deck named that in /home/you/ritual/decks
The published site was left unchanged.
```

This covers every way a named source can fail: no such list, a list that exists but cannot be read (broken front matter, bad permissions), a name more than one list answers to, and a deck URL that could not be fetched. The reason printed is the real one. A file that is present but unreadable reports _why_, not "no deck named that".

A source the build **discovered for itself**, one selected by `site.include*` rather than named on the command line, is treated differently. It is reported the same way, but the rest of the site is published without it and the build exits `0`.

```
$ ritual build-site
Failed to load deck 'winota': unexpected end of the stream within a flow collection

⚠️  1 source could not be built:
  - deck 'winota': unexpected end of the stream within a flow collection
The site was published without them.
```

Names given to `--decks`, `--collections` and `--wanted-lists` are matched against both the list's **display name** (its `# Title` heading) and its **file base name**, ignoring case, accents, and `-`/`_` separators, the same matching every other list-taking command uses, so `--decks winota-stax` finds a deck titled `Winota Stax`. A trailing `.md` is accepted. A name that two lists answer to is reported rather than resolved to an arbitrary one:

```
Failed to load deck 'Burn': matches 2 decks (Burn, Burn) — name one exactly
```

The `site.include*` config lists match on the **display name, exactly**, with no folding. Config is written once and deliberately, so a name that has drifted is reported rather than quietly resolved to a near neighbour.

A `site.include*` entry that matches no list is a **warning**, not a failure. Config drifts when a list is renamed, so the build continues without it and says so:

```
⚠️  site.includeDecks lists 'Old Name', which matches no deck in /home/you/ritual/decks — it may have been renamed or removed.
```

A workspace with no lists at all (including one where `decks/`, `collections/`, and `wanted/` do not exist yet) is reported as such and exits `1`:

```
Nothing to build: no decks, collections, or wanted lists were found. Create one
with `ritual new deck "My Deck"` (or run `ritual edit`), then build again.
```

If nothing was priced, the build says which of the two causes it was and exits `1`. When the selected lists are all empty there is nothing to price: `No cards to price: every selected list is empty, so there is nothing to build.` When they hold cards but the cache has no prices for them, it names the remedy: `No price data found in the card cache. Run \`ritual cache preload-all\` first, or re-run with --refresh auto to download it.`

## Card Cache Refresh

A build gets card data and prices in four steps, in order:

1. **Automatic bulk download**: if the cache is empty, more than a week old, or missing more than 100 of the requested cards, the full Scryfall bulk dataset is downloaded first (equivalent to `ritual cache preload-all`).
2. **Bulk price-refresh prompt**: otherwise, if more than 100 cards have prices older than 24 hours, `build-site` offers a bulk redownload (fresh prices for everything in one request) instead of refreshing each card individually:

   ```
   287 of 320 card(s) have prices older than 24 hours.
   Redownloading the Scryfall bulk card cache (includes fresh prices) would be faster than refreshing each card individually.
   Redownload the latest Scryfall card cache now? [y/N]
   ```

3. **Per-card fetch**: every card whose cached price is stale (>24h) is then refetched individually. Cards with fresh prices are reused from cache.
4. **Tag download**: if none of the build's cards carry oracle/art tags (needed by the site's [tag filters](/public-site/filtering/)), `build-site` offers to download them and bake them into the cache. It is gated by the same `--refresh` mode as the bulk download (`auto` accepts it and `no-bulk` / `never` skip it, leaving the tag filters empty for that build), but its prompt defaults to **Yes**, since the filters are unusable without it.

When prompts are unavailable (stdin is not a TTY, or the global `--no-input` flag / `RITUAL_NO_INPUT` is in force), every prompt is **declined**, never resolved to its on-screen default. That covers steps 2 and 4, which are prompts.

Step 1 is **not** a prompt. Under `ask` (the default) and `auto`, an empty, week-old, or badly incomplete cache is bulk-downloaded automatically, headless or not. A build has no usable card data otherwise, and filling the gap card by card is far slower than the one bulk request. A run that must never make that download should pass `--refresh no-bulk` or `--refresh never`, which suppress it.

### The `--refresh` mode

The shared `--refresh <mode>` option answers the prompts non-interactively and controls the bulk download:

| Mode                | Automatic bulk download (step 1) | Bulk price-refresh prompt (step 2)   | Per-card refresh of stale prices (step 3) | Tag download (step 4)                | Symbology download                   |
| ------------------- | -------------------------------- | ------------------------------------ | ----------------------------------------- | ------------------------------------ | ------------------------------------ |
| `ask` (the default) | Runs automatically               | Prompts (declined when unanswerable) | Yes                                       | Prompts (declined when unanswerable) | Yes, when not cached                 |
| `auto`              | Runs automatically               | Yes, without prompting               | Yes                                       | Yes, without prompting               | Yes, when not cached                 |
| `no-bulk`           | **Suppressed**                   | **Skipped**                          | Yes                                       | **Skipped**                          | Yes, when not cached                 |
| `never`             | **Suppressed**                   | **Skipped**                          | **No** (uses cached prices as-is)         | **Skipped**                          | **Skipped** (warns; symbols missing) |

[`serve --api`](/commands/serve/#live-api-mode---api) runs steps 1, 2, and 4 of this table at startup, over the cards its served lists reference. It never runs step 3, since a live server answers requests from the cache and never fetches from Scryfall, so on a warm cache, `no-bulk` and `never` behave the same.

```bash
ritual build-site --refresh auto     # fastest full refresh, no prompts
ritual build-site --refresh no-bulk  # refresh prices without the big download
ritual build-site --refresh never    # build from the existing cache
```

> **Note on `never`:** it makes no bulk, price, tag, or symbology request, but a card the cache does not hold is still fetched individually by step 3's per-card loop, since a card with no data cannot be rendered at all. With no cached symbology, the build prints a warning and the site renders without mana symbols. Re-run with `--refresh auto` to download them.

> **Note:** `--refresh no-bulk` and `--refresh never` also suppress the _automatic_ bulk download (step 1). On an empty or very stale cache this forces every card to be fetched individually, which is slow and can hit Scryfall rate limits. Use them when you already have a populated cache.

An explicit `--refresh` mode is also what `bun run dev serve` requires. See [Development → Dev Workflow](/development/#dev-workflow).

## Sell mode (`--sell-mode`)

[Sell mode](/public-site/sell/) (Card Kingdom buylist prices beside each card, the buylist filters, buylist grouping and sorting, and the sell-cart export) is **off by default**. Turn it on for a workspace with [`ritual config set site.sellMode true`](/configuration/#offering-sell-mode-sellmode), or for a single build with `--sell-mode`:

```bash
ritual build-site --sell-mode
```

The flag is enable-only (there is no `--no-sell-mode`). Omit it and the build follows the config.

When sell mode is on for the run, or [`priceSources`](/configuration/#price-stores-pricesources) includes `cardkingdom` (whose retail prices ride on the same feed), `build-site` does three extra things:

1. **Refreshes the Card Kingdom buylist**, before the card data is fetched, under this run's `--refresh` mode, the same policy the card cache answered to. A cached feed less than a day old is used as-is. A day-old one is redownloaded under `ask`/`auto` and left alone under `no-bulk`/`never`. A **missing** feed is downloaded under `auto` and prompted for under `ask` (default yes, ~70 MB). See [`sell` → Feed freshness](/commands/sell/#feed-freshness).
2. **Picks Card Kingdom's own printings**, as each card is fetched, when `priceSources` includes `cardkingdom`. A card line naming no printing gets a representative and a cheapest printing chosen from Card Kingdom's catalog at Card Kingdom's prices, baked beside the Scryfall picks so the site can switch stores without a rebuild. See [Which printing a card is priced at](/public-site/prices/#which-printing-a-card-is-priced-at).
3. **Bakes the buy prices into each list's JSON**, after the card data is assembled and before the per-list JSON is written. Every printing a list displays is quoted from the feed and written into that list's detail file, so the published site shows sell mode with **no backend at all**. A static host on a CDN offers it exactly as a [live one](/public-site/hosted/) does. Non-English copies are never quoted (Card Kingdom's feed is English-only).

   With `priceSources` including `cardkingdom` this widens: every printing each list _carries_ is quoted, at every finish it is published in, because the card modal's other-printings grid and the [printing pickers](/public-site/prices/#the-prices-selector) price printings no tile displays and a static client cannot fetch a quote it was not given. The extra bytes therefore land only on builds that offer Card Kingdom prices. A sell-mode-only build still quotes the displayed printings alone.

It reports what it baked:

```
Card Kingdom buylist ready (61948 items).
```

**A buylist problem never fails the build.** A refused prompt, a `--refresh never` run with no cached feed, or a failed download warns and the site is built without buy prices:

```
⚠️  Sell mode is on but the Card Kingdom buylist is unavailable, so the site is built without buy
prices. No Card Kingdom buylist has been downloaded yet. Re-run with --refresh auto to download it (~70 MB).
```

Such a site still advertises sell mode (`index.json` carries the flag), and turning the toggle on shows the "buylist prices are unavailable" notice rather than empty prices. Rebuild once a feed exists to fill them in.

With sell mode **off**, no Card Kingdom work happens at all: no download, no quoting, and the detail files carry no buylist field.

## Serving the Site

After building, use the [`serve`](/commands/serve/) command to preview locally:

```bash
ritual serve
```

To build and serve in a single step, pass `--build` to [`serve`](/commands/serve/):

```bash
ritual serve --build
```
