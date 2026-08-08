---
title: 'build-site'
---

Generate a website for your decks, collections, and wanted lists.

## Usage

```bash
./ritual build-site [options]
```

## Options

By default, deck card images use Scryfall URLs from card data. This can be overridden with the `--cache-images` option to download and use local images instead.

| Option                          | Description                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-v, --verbose`                 | Show list of cards being fetched from Scryfall                                                                                                                                                                                                                                                                                                                                                                        |
| `--cache-images`                | Download and use local deck card images in `dist/images` instead of URLs                                                                                                                                                                                                                                                                                                                                              |
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

## Examples

Build site for all decks and collections:

```bash
./ritual build-site
```

Build site for specific decks:

```bash
./ritual build-site --decks "Atraxa Superfriends" "Mono Red Aggro"
```

Build with verbose output:

```bash
./ritual build-site --verbose
```

Build with downloaded local deck card images:

```bash
./ritual build-site --cache-images
```

Build directly from a URL (see [Building decks from URLs](#building-decks-from-urls)):

```bash
./ritual build-site --decks https://archidekt.com/decks/12345
```

Build with specific collections:

```bash
./ritual build-site --collections "Red Binder" "ECL"
```

Build with specific wanted lists:

```bash
./ritual build-site --wanted-lists "High Priority" "Trade Targets"
```

Build with EUR as the default price currency:

```bash
./ritual build-site --currencies eur
```

Build with only USD and EUR (no TIX):

```bash
./ritual build-site --currencies "usd,eur"
```

## Choosing which lists to build

When the `--decks`, `--collections`, and `--wanted-lists` flags are omitted, `build-site` falls back to the publish lists in your [site configuration](/configuration/#choosing-which-lists-to-publish) — `site.includeDecks`, `site.includeCollections`, and `site.includeWantedLists`. Each defaults to the wildcard `["*"]` (build everything), so a fresh project builds all lists with no extra configuration.

Setting a list to specific **display names** publishes only those lists and filters out the rest. For example, with:

```json
"site": {
  "includeDecks": ["Izzet Storm", "Atraxa Superfriends"],
  "includeCollections": ["*"],
  "includeWantedLists": []
}
```

`build-site` publishes only those two decks, every collection, and no wanted lists. The matching flag always overrides the config for that category in a single run, bypassing both the `include*` and `exclude*` lists — `--decks "Mono Red Aggro"` builds just that deck regardless of `includeDecks` or `excludeDecks`.

Each category also has an `exclude*` list (`site.excludeDecks`, `site.excludeCollections`, `site.excludeWantedLists`) that drops lists by display name even when the `include*` list selects them — exclusion always wins. The exclude lists default to empty and have no wildcard. For example, `"includeDecks": ["*"]` with `"excludeDecks": ["Untuned Brew"]` publishes every deck except "Untuned Brew". The admin **Manage Lists** page toggles these per list; see [publishing visibility](/admin/manage-lists/#publishing-visibility).

You can edit these lists from the admin **Settings** page, with [`config set`](/commands/config/), or by hand.

## Building decks from URLs

Entries passed to `--decks` can be deck URLs instead of local deck names. URL decks are fetched at build time through the same dispatch as [`import`](/commands/import/), so all three supported services work:

- **Archidekt** — `https://archidekt.com/decks/<id>`
- **Moxfield** — `https://moxfield.com/decks/<id>`
- **MTGGoldfish** — any `mtggoldfish.com` deck URL

Moxfield requires a unique, Moxfield-approved User-Agent string: pass `--moxfield-user-agent <agent>` or set the `MOXFIELD_USER_AGENT` environment variable.

A URL deck comes from `--decks`, so it is a source you **named**: if it cannot be fetched — a Moxfield URL given without a User-Agent, an `http(s)` URL that matches no supported service, a dead link — the whole build fails with exit code `1` and nothing is published. See [When a list will not build](#when-a-list-will-not-build).

URL decks have no local file, so they carry no changelog and no file timestamp on the generated site.

```bash
./ritual build-site --decks https://moxfield.com/decks/abc123 --moxfield-user-agent "YourName Ritual Build/1.0"
```

## Themes

The generated site ships with multiple themes selectable at runtime, or setting a default theme at build time. The `--theme` flag controls which theme is the **initial** one served (i.e. what users see on first visit before they pick something). Ten Magic-flavored "guild" palettes are available alongside the default, each with a primary background color and a contrasting highlight color used for buttons, focus rings, and accents:

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

Each theme also has an inverted variant accessible by appending `-inverted` to its name (e.g. `azorius-inverted`, `boros-inverted`). Inverted themes swap the background and highlight colors so the highlight becomes the dominant background and the original background becomes the accent — shade and intensity are adjusted so the resulting palette stays comfortable to read.

The app's flame logo — both the header icon and the browser-tab favicon — is tinted from each theme's accent, so switching themes recolors the icon to match (a vivid flame for saturated accents, a pale "white flame" for near-neutral ones).

```bash
./ritual build-site --theme izzet
./ritual build-site --theme boros-inverted
```

### Custom themes

The header's **Theme** button opens a picker popover listing every built-in palette with a preview swatch. Clicking a palette switches the base theme; if the visitor has in-progress customizations, the picker first asks for confirmation before discarding them. Only the chosen theme name (and any explicit overrides) is stored in `localStorage` — when a future build ships updated built-in palettes, visitors who haven't customized see those updates automatically.

For per-variable tweaks, the picker has a **Customize theme…** entry that opens the in-browser **theme editor**. The editor exposes every CSS variable as a labeled control (OKLch sliders for colors, number inputs for sizes) grouped into tabs — including a **Flame icon** group for the six gradient stops of the app logo — lets the user start from any built-in palette, and live-previews changes across all pages (the flame logo and favicon recolor as you drag). The user's edits persist in `localStorage` so subsequent visits restore their custom palette.

A **Download JSON** button in the editor exports the full set of variables as a `.json` file. To bake one of those palettes back into a build, pass it to `--theme-file`:

```bash
./ritual build-site --theme-file ./my-palette.json
./ritual build-site --theme-file ./palette-a.json --theme-file ./palette-b.json
./ritual build-site --theme-file ./my-palette.json --theme my-palette
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

The site's interface language works much like its theme: dictionaries are **data**, published beside the app rather than compiled into it, so one build can carry several languages and visitors switch between them at runtime with no reload.

Three flags control it:

| Flag                      | What it decides                                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--locale <tag>`          | The language the site **opens in**. Stamps `<html lang>` and `dir` before first paint, and sets `index.json.uiLocale`. Defaults to the `uiLocale` config value.           |
| `--locales <tags...>`     | Which dictionaries land in `dist/locales/`. Default `en`; `all` publishes every locale this build has. Populates `index.json.availableLocales`, which the switcher lists. |
| `--locale-file <path...>` | Loads a dictionary JSON from disk at build time. The **file name is the locale tag** (`de-AT.json`), matching the layout translators work in.                             |

```bash
./ritual build-site --locales en de --locale de     # opens in German, English available
./ritual build-site --locales all                   # every dictionary this build has
./ritual build-site --locale-file ./de-AT.json --locales en de-AT
```

`--locales` is variadic, so its tags are **space-separated**, like `--decks` and `--theme-file` (unlike `--currencies`, which takes one comma-separated value). English is always emitted whether or not you list it.

`--locale-file` is the locale analogue of `--theme-file`, and it is how a **released binary publishes a language it was never built with** — hand it a validated dictionary and that locale becomes selectable like any built-in one.

Details worth knowing:

- **The baked locale is always published.** A site whose shell says `lang="de"` must be able to fetch the German dictionary it names, so `--locale de` implies `de` in the emitted set.
- **A baked locale with no dictionary is a warning, not a failure.** A catalog with zero coverage is just the degenerate case of a partial one, and messages fall back to English key by key — the build says so and continues. A tag named by `--locales` that has _no_ dictionary is an error, because naming files to emit is that flag's entire job.
- **The language switcher appears only when more than one locale was published.** A picker with one option is noise, so an English-only build shows none.
- Everything is written into the build's scratch directory and swapped in atomically like the rest of the site, so a failed locale build leaves the previously published site standing — see [Output](#the-output-directory-is-replaced-never-half-written).

Per-locale URL prefixes (for SEO or CDN path routing) are just a loop — no special mode exists:

```sh
for tag in en de ja; do
  ritual build-site --locale "$tag" --locales "$tag" --out-dir "dist/$tag"
done
```

This is **not** the card language. `--locale` changes what language Ritual's own text is in; which printing of a card is shown is [`defaultLanguage`](/configuration/#default-language)'s job. See [Localization](/localization/) for the full picture, including that no translations ship yet.

## Output

Generates a single-page application in the `dist/` directory (or the `--out-dir` directory) containing:

- `index.html` — SPA shell that loads the application
- `app.js` — Bundled SPA with client-side routing
- `index.json` — Deck and collection listing used by the index page (also carries the baked config, including [`site.apiBaseUrl`](/configuration/#pointing-a-static-build-at-a-live-backend-apibaseurl) when a [live backend](/public-site/hosted/) is configured, plus `uiLocale` and `availableLocales` from [the locale flags](#localized-builds))
- `boot.js` — Tiny same-origin bootstrap that applies the stored theme and stamps `<html lang>`/`dir` before first paint
- `locales/{tag}.json` — One message dictionary per published locale, fetched on demand when the visitor switches language
- `decks/{slug}.json` — Full deck data loaded on demand
- `collections/{slug}.json` — Full collection data with pricing loaded on demand
- `wanted/{slug}.json` — Full wanted list data with pricing loaded on demand
- `styles.css` — Bundled CSS
- Responsive design for desktop and mobile
- Dark mode support
- Client-side hash routing (`#/` for index, `#/deck/{slug}` for deck pages, `#/collection/{slug}` for collection pages, `#/wanted/{slug}` for wanted list pages)
- Navigation bar with "Decks", "Collections", and "Wanted" links always visible
- Page transition animations

### The output directory is replaced, never half-written

Every build — the CLI, the admin site's "Build Site" page, and the `build_site`
MCP tool — writes into a scratch directory beside the target and renames it into
place only once the build has succeeded. The output directory therefore holds
either the previous site or the new one at every instant: a build that fails
partway (an unusable card cache, a cold network, a list that will not load)
leaves the site you already published exactly as it was.

Because a successful build **replaces** its output directory, `--out-dir` is
still a destructive flag: it is refused with exit code 2 when the path it
resolves to is blank, is the Ritual directory itself, or **contains** the Ritual
directory — `--out-dir .` would otherwise delete your decks, collections, and
`.git`.

```
$ ./ritual build-site --out-dir .
--out-dir may not be the Ritual directory itself (/home/you/ritual) — it is the
site's output directory: a build replaces it wholesale, and serving it would
publish your lists.
```

### Scratch directories beside the output

The mechanism above is why you will occasionally see directories named
`.dist-build-XXXXXX` and `.dist-old-<pid>-<timestamp>` sitting next to `dist/`.
They are build scratch, never part of the published site, and always safe to
delete by hand:

| Directory                     | What it is                                                                                                                                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.dist-build-XXXXXX`          | The directory the build is writing into, before it is renamed onto `dist/`. The random suffix lets several builds — a CLI build, the admin server, `ritual mcp` — run beside the same output without colliding. |
| `.dist-old-<pid>-<timestamp>` | The **previous** site, parked aside for the width of two renames so it can be restored if the swap fails. It is removed as soon as the new site is in place.                                                    |

A build that runs to completion — success or failure — removes its own scratch
directory. One left behind means a build was killed before it could clean up:
`Ctrl-C`, a crash, or cancelling a build from the admin site or the `build_site`
MCP tool. An admin-triggered build leaves up to two, because the admin server
creates a scratch directory and the `ritual build-site` child process it spawns
creates its own inside the same parent.

Leftovers are reclaimed automatically, but not immediately. The next build
sweeps abandoned scratch directories **older than six hours** before it starts.
The delay is deliberate: a sweep cannot tell its own debris from a scratch
directory another build is using right now, so it goes by age rather than by
name and never touches anything a concurrent build could still be holding. If
you build less often than that, deleting them yourself is perfectly fine.

`ritual init-site` adds both patterns to `.gitignore`, so they stay out of your
repository even under a
[local-build deploy](/commands/init-site/#generated-files) that commits its
built site.

## When a list will not build

A list named on the command line that cannot be loaded **fails the build**:
every such source is listed in a closing summary, the exit code is `1`, and
nothing is published — the previous site stays up.

```
$ ./ritual build-site --decks "Nonexistant Deck"
Failed to load deck 'Nonexistant Deck': no deck named that in /home/you/ritual/decks

⚠️  1 source could not be built:
  - deck 'Nonexistant Deck': no deck named that in /home/you/ritual/decks
The published site was left unchanged.
```

This covers every way a named source can fail: no such list, a list that exists
but cannot be read (broken front matter, bad permissions), a name more than one
list answers to, and a deck URL that could not be fetched. The reason printed is
the real one — a file that is present but unreadable reports _why_, not "no deck
named that".

A source the build **discovered for itself** — one selected by `site.include*`
rather than named on the command line — is treated differently: it is reported
the same way, but the rest of the site is published without it and the build
exits `0`.

```
$ ./ritual build-site
Failed to load deck 'winota': unexpected end of the stream within a flow collection

⚠️  1 source could not be built:
  - deck 'winota': unexpected end of the stream within a flow collection
The site was published without them.
```

Names given to `--decks`, `--collections` and `--wanted-lists` are matched
against both the list's **display name** (the deck's `name:` front matter, a
collection or wanted list's `# Title`) and its **file base name**, ignoring case,
accents, and `-`/`_` separators — the same matching every other list-taking
command uses, so `--decks winota-stax` finds a deck titled `Winota Stax`. A
trailing `.md` is accepted. A name that two lists answer to is reported rather
than resolved to an arbitrary one:

```
Failed to load deck 'Burn': matches 2 decks (Burn, Burn) — name one exactly
```

The `site.include*` config lists match on the **display name, exactly** — no
folding. Config is written once and deliberately, so a name that has drifted is
reported rather than quietly resolved to a near neighbour.

A `site.include*` entry that matches no list is a **warning**, not a failure —
config drifts when a list is renamed, so the build continues without it and says
so:

```
⚠️  site.includeDecks lists 'Old Name', which matches no deck in /home/you/ritual/decks — it may have been renamed or removed.
```

A workspace with no lists at all (including one where `decks/`, `collections/`,
and `wanted/` do not exist yet) is reported as such and exits `1`:

```
Nothing to build: no decks, collections, or wanted lists were found. Create one
with `ritual new deck "My Deck"` (or run `ritual edit`), then build again.
```

If nothing was priced, the build says which of the two causes it was and exits
`1`. When the selected lists are all empty there is nothing to price:
`No cards to price: every selected list is empty, so there is nothing to build.`
When they hold cards but the cache has no prices for them, it names the remedy:
`No price data found in the card cache. Run \`ritual cache preload-all\` first,
or re-run with --refresh auto to download it.`

## View Modes and Card Size

Deck and collection pages offer four view modes, toggled via buttons in the toolbar:

- **Binder** (▦) — dense card image grid
- **List** (☰) — compact text rows showing name, mana cost, and price
- **Row** (⧗) — horizontally scrolling fan of overlapping cards
- **Column** (▥) — vertical stacked columns of cards

In binder, row, and column modes, hovering a card shows its name and price in an overlay at the bottom of the card image.

Double-faced cards show a translucent **flip** button (⇄) on the left edge when hovered in these three image views (it is not shown in list view). Clicking it flips the card in place — with a short rotate animation that does not disturb the surrounding layout — to reveal the back face; clicking again flips back to the front. The flip is purely visual and does not change grouping, sorting, or any saved data.

When grouping by **type**, double-faced cards are categorized by their **front face only**: a card whose front is a creature and whose back is a land is grouped under Creature.

A card size selector (**L / M / S**) appears in the toolbar for binder, row, and column modes. The three sizes are:

| Size               | Card width |
| ------------------ | ---------- |
| L (Large, default) | 190 px     |
| M (Medium)         | 140 px     |
| S (Small)          | 100 px     |

Card size applies uniformly across all three image views. In row and column modes, the row width and column width shift automatically to match the selected card size.

## Exporting a list

Every list page (deck, collection, or wanted list) carries a **Copy** and a **Download** button in its header. Clicking either opens a dropdown of three formats:

- **Text (.txt)** — a quantity-prefixed list (`N Card Name (SET:Collector Number)`). Decks render the import-friendly decklist (Commander then Main, extras omitted); collections and wanted lists render one line per card.
- **Markdown (.md)** — the canonical source Markdown, with `## Section` headers and full card lines (printing, finish, condition, note, and internal id).
- **CSV (.csv)** — spreadsheet rows under a `Name,Set,Collector Number,Finish,Condition,Language,Quantity` header, for importing into other sites.

**Copy** writes the chosen format to the clipboard; **Download** saves it as a file named after the list. A small tooltip ("Copied!" / "Downloaded!") confirms the action — the button labels never change. The list is serialized in the browser from the data already on the page, so no extra files are generated at build time.

## Multi-Select

Any list page (deck, collection, or wanted list) lets you select cards across every view mode and act on the whole selection at once. Hovering a card in binder, row, or column mode reveals a translucent checkbox in its top-left corner; clicking it marks the card with a checkmark in the current theme's accent color. In list view the checkbox sits at the far left of each row. You can also **Ctrl-click** (or **⌘-click** on macOS) anywhere on a card in any view to toggle its selection without opening the card modal.

A card shown with a quantity (e.g. `4×` in a deck, or a grouped duplicate in a collection) is selected as all of its copies at once, and the count reflects the individual copies (selecting `4× Lightning Bolt` counts as four). When you later remove some — but not all — of a group's copies (from the dialog below), its checkbox shows a **dash** instead of a checkmark to indicate the partial selection.

Once at least one card is selected, a **Selected (N)** button appears in the toolbar (N is the running count of selected copies for the list you're viewing). The selection survives changes to grouping, sorting, and view mode. Opening the button reveals a menu of bulk actions over that list's selection:

- **Copy as Text** — copies a quantity-prefixed list (`N Card Name (SET:Collector Number)`) to the clipboard, matching the header **Copy → Text** format but scoped to the selected cards
- **Copy as CSV** — copies the same selection as CSV with a `Name,Set,Collector Number,Finish,Condition,Language,Quantity` header, matching the header **Copy → CSV** output but scoped to the selected cards
- **Add to Trade** — adds the selected cards to the active [Trade Planner](#trade-planner) (deck and collection cards go to the offering side, wanted-list cards to the receiving side). Name-only cards (no pinned printing) prompt for a printing one at a time, exactly like the single-card add
- **Clear selection** — deselects the current list's cards only

Identical printings are merged and their quantities summed in both copy formats.

### Selecting across lists

Selections are held globally, so they persist as you navigate between lists. Whenever anything is selected, an **All Selected (N)** button is shown in the top navbar (N is the total across every list) — on every page, including the index and Trade Planner, not just list pages. Its menu offers the same actions but over the entire cross-list selection, and its **Clear all selections** entry wipes every list at once. This makes it easy to gather cards from several decks, collections, and wanted lists and then copy or trade them together.

The menu's **View all selections…** entry opens a dialog listing every selected card — with its quantity, printing, foil/etched finish, and condition — alongside the list it came from. The cards can be shown in selection order or grouped by source, hovering a row previews the card art, and each row's ✕ removes a single copy (so a `4×` group drops to `3×`). The dialog repeats the **Copy as Text** / **Copy as CSV** and **Clear all selections** actions.

## Deck Features

Deck pages include a "Lowest Price" toggle that swaps all cards to their cheapest available printing. When enabled, card images and prices update to reflect the lowest-priced version. Only printings with a listed price are considered.

## Deck Cover Labels

On the home page deck list and in the Quick Switch dialog, each deck cover shows the deck's format rather than a raw card count. Format is read from the deck's `format:` frontmatter field, falling back to section heuristics (a `Commander` section implies Commander; an `Oathbreaker` / `Signature Spell` section implies Oathbreaker).

- Commander and Oathbreaker decks display just the format name (e.g. **Commander**).
- For other supported formats (Standard, Modern, Pioneer, Legacy, Vintage, Pauper, Historic, Brawl, Duel Commander, Pre-Modern, Limited), the format name appears alone when the main-deck card count matches the format's expected size (60 for most, 100 for Commander/Duel Commander, 40 for Limited).
- When the main-deck count is unusual for the format, a smaller parenthetical card count is shown next to the format name — e.g. **Modern (62 cards)** for a Modern deck with 62 mainboard cards.
- Decks without a recognized format (no `format:` field and no Commander/Oathbreaker section) fall back to the original `N cards` display.

The main-deck count includes the commander/oathbreaker section plus the mainboard, but excludes sideboard, maybeboard, and token sections so a 60-card format with a sideboard still reports 60.

Collections and wanted lists continue to display a plain `N cards` count, since their card count is the primary fact about them.

## Index Toolbar

Every tab of the home page — **Decks**, **Collections**, and **Wanted Lists** — includes a shared filter toolbar (matching the look of the deck and collection page toolbars) for re-sorting and grouping the list. Each tab keeps its own selections, and state is per-session — selections reset on reload.

Sort options (default: **Alphabetical**):

- **Alphabetical** — A–Z by name (uses locale-aware case-insensitive comparison).
- **Recently updated** — newest first, derived from the most recent changelog entry, falling back to the source file's mtime. Items with no timestamp sort last.
- **Current price** — highest current total first, in the active currency.
- **Lowest price** — highest "lowest possible" total first (the sum of the cheapest available printing of each card), in the active currency. **Decks only** — this option does not appear on the Collections or Wanted Lists tabs, where a per-card cheapest-printing total isn't meaningful.

A **Reverse** toggle next to the selects flips the resulting order.

Grouping applies only to the **Decks** tab, which adds a **Group** selector (default: **None**):

- **None** — single flat grid.
- **Format** — splits decks into one section per format (Commander, Modern, Standard, …) with the format label as the section heading. Decks without a recognized format land in a final **Other** bucket. The active sort is applied within each group.

The **Collections** and **Wanted Lists** tabs have no format dimension to group by, so the Group selector is omitted from their toolbars entirely — they show only the Sort selector (Alphabetical, Recently updated, Current price) and the Reverse toggle.

## Price Currency Switching

The generated site includes a **Prices** dropdown in the header for switching between USD (TCGPlayer), EUR (Cardmarket), and TIX (MTGO) at runtime. The dropdown only shows currencies selected by the `--currencies` flag. When switching currencies:

- All displayed prices update to the selected currency
- Deck totals and section totals recalculate
- Collection prices recompute using the card's finish-specific price in the new currency
- The "Lowest Price" toggle finds the cheapest printing per the active currency — images update accordingly
- Price bracket grouping labels adapt to the active currency symbol

The `--currencies` flag controls which currencies are available on the site. The site opens in the configured [`defaultCurrency`](/configuration/#default-currency) when it is among the built currencies, otherwise the first currency listed. Users can switch between available currencies at any time using the dropdown.

## Price Disclaimer

The generated site displays a disclaimer below the header showing the date prices were retrieved. Prices are fetched from Scryfall at build time and reflect values as of the build date. The disclaimer reads: "Prices accurate as of &lt;date&gt;".

### Update Prices (per page)

Every deck, collection, and wanted-list page has an **Update Prices** button (also shown while editing), in the button group above the filter toolbar alongside actions like Combine and View Changes. It is a no-op until pressed; clicking it batch-fetches current prices for that page's cards directly from Scryfall (into an in-memory, per-tab session cache) and the displayed per-card prices and totals update in place. Nothing is written to disk — the refresh lives only in the current browser tab. On a site backed by a [live API](/public-site/hosted/), the refresh instead goes through the backend's batch price endpoint, which updates its shared card cache server-side.

If a refresh only updates some cards (for example, a card Scryfall no longer returns by id), the remaining cards keep their older build-time price. When prices on a page end up with mixed dates, a small expandable warning appears listing the cards whose prices are now older than the rest. Refreshing again so every card is covered clears the warning. The same session cache is shared with the card search in the public editor and the Trade Planner, so a card fetched once is reused without another request.

## Card Cache Refresh

A build pulls card data and prices from three places, in order:

1. **Automatic bulk download** — if the cache is empty, more than a week old, or missing more than 100 of the requested cards, the full Scryfall bulk dataset is downloaded first (equivalent to `./ritual cache preload-all`).
2. **Bulk price-refresh prompt** — otherwise, if more than 100 cards have prices older than 24 hours, `build-site` offers a bulk redownload (fresh prices for everything in one request) instead of refreshing each card individually:

   ```
   287 of 320 card(s) have prices older than 24 hours.
   Redownloading the Scryfall bulk card cache (includes fresh prices) would be faster than refreshing each card individually.
   Redownload the latest Scryfall card cache now? [y/N]
   ```

3. **Per-card fetch** — every card whose cached price is stale (>24h) is then refetched individually; cards with fresh prices are reused from cache.
4. **Tag download** — if none of the build's cards carry oracle/art tags (needed by the site's [tag filters](/public-site/filtering/)), `build-site` offers to download them and bake them into the cache. It is gated by the same `--refresh` mode as the bulk download — `auto` accepts it and `no-bulk` / `never` skip it (leaving the tag filters empty for that build) — but its prompt defaults to **Yes**, since the filters are unusable without it.

When prompts are unavailable (stdin is not a TTY, or the global `--no-input` flag / `RITUAL_NO_INPUT` is in force), every prompt is **declined** — never resolved to its on-screen default. That covers steps 2 and 4, which are prompts.

Step 1 is **not** a prompt: under `ask` (the default) and `auto`, an empty, week-old, or badly incomplete cache is bulk-downloaded automatically, headless or not — a build has no usable card data otherwise, and filling the gap card by card is far slower than the one bulk request. A run that must never make that download should pass `--refresh no-bulk` or `--refresh never`, which suppress it.

### The `--refresh` mode

The shared `--refresh <mode>` option answers the prompts non-interactively and controls the bulk download:

| Mode                | Automatic bulk download (step 1) | Bulk price-refresh prompt (step 2)   | Per-card refresh of stale prices (step 3) | Tag download (step 4)                | Symbology download                   |
| ------------------- | -------------------------------- | ------------------------------------ | ----------------------------------------- | ------------------------------------ | ------------------------------------ |
| `ask` (the default) | Runs automatically               | Prompts (declined when unanswerable) | Yes                                       | Prompts (declined when unanswerable) | Yes, when not cached                 |
| `auto`              | Runs automatically               | Yes, without prompting               | Yes                                       | Yes, without prompting               | Yes, when not cached                 |
| `no-bulk`           | **Suppressed**                   | **Skipped**                          | Yes                                       | **Skipped**                          | Yes, when not cached                 |
| `never`             | **Suppressed**                   | **Skipped**                          | **No** (uses cached prices as-is)         | **Skipped**                          | **Skipped** (warns; symbols missing) |

[`serve --api`](/commands/serve/#live-api-mode---api) runs steps 1, 2, and 4 of this table at startup, over the cards its served lists reference. It never runs step 3 — a live server answers requests from the cache and never fetches from Scryfall — so for the warm, `no-bulk` and `never` are equivalent.

```bash
./ritual build-site --refresh auto     # fastest full refresh, no prompts
./ritual build-site --refresh no-bulk  # refresh prices without the big download
./ritual build-site --refresh never    # build from the existing cache
```

> **Note on `never`:** it makes no bulk, price, tag, or symbology request — but a card the cache does not hold is still fetched individually by step 3's per-card loop, since a card with no data cannot be rendered at all. With no cached symbology, the build prints a warning and the site renders without mana symbols; re-run with `--refresh auto` to download them.

> **Note:** `--refresh no-bulk` and `--refresh never` also suppress the _automatic_ bulk download (step 1). On an empty or very stale cache this forces every card to be fetched individually, which is slow and can hit Scryfall rate limits — use them when you already have a populated cache.

An explicit `--refresh` mode is also what `bun run dev serve` requires — see [Development → Dev Workflow](/development/#dev-workflow).

## Quick Switch

A **Quick switch** button (centered in the site header on desktop, right-aligned on mobile) opens a command-palette-style dialog for jumping between any deck, collection, or wanted list on the site. The same dialog also opens with the keyboard shortcut **Ctrl+K** (or **Cmd+K** on macOS).

When the search field is empty, the dialog lists every deck, collection, and wanted list. As soon as you start typing, results are grouped into four priority tiers. Matching is case- and accent-insensitive throughout, so `teferi` finds `Téferi` and vice versa:

1. **Lists** — matches against deck, collection, and wanted-list names (highest priority).
2. **Commanders** — matches against the commander of any deck. Selecting one opens the deck containing that commander.
3. **Cards** — matches against the name of any card in any list. Selecting one opens the list containing that card. The same card can produce multiple entries (one per containing list), and each row identifies the destination list in its subtitle.
4. **Printings** — matches against the `set:collector` code of any card (e.g. `mkm:42`). The set:collector code is shown as the primary label (uppercased, e.g. `MKM:42`) and the card's name appears alongside in muted italics for context. Selecting one opens the list containing that printing.

Each row shows a thumbnail (the list's featured art for list rows, the card art for commander and card rows), a kind tag (`Deck` / `Collection` / `Wanted` / `Commander` / `Card`), and the destination context. Commander and card matches require per-list detail data; the dialog pre-fetches that data the first time it opens, so card matches start appearing once the data has loaded.

Keyboard controls inside the dialog:

| Key                         | Action                      |
| --------------------------- | --------------------------- |
| <kbd>↑</kbd> / <kbd>↓</kbd> | Move the highlighted result |
| <kbd>Enter</kbd>            | Open the highlighted entry  |
| <kbd>Esc</kbd>              | Close the dialog            |

Clicking a result also opens it. Clicking the darkened backdrop closes the dialog. The dialog closes automatically after navigation.

## Card Detail Modal

Both deck and collection pages share a unified card detail modal. Clicking any card opens a modal showing:

- Card image with flip support for double-faced cards
- Card name, type line, mana cost, and oracle text
- Price, set info, rarity, and other metadata
- A "View on Scryfall" link to the card's Scryfall page
- An "Other Printings" button showing a paginated binder-style grid (8 per page) of all known printings, sorted by release date (newest first) by default, each linking to Scryfall with prices. Sorting can be changed via a dropdown to release date, set name, or price, with a toggle to reverse the sort direction.

## Missing Card Warnings

When a card cannot be priced in a selected currency (e.g., a paper-only card has no TIX price, or an MTGO-only card has no USD/EUR price), it is omitted from price totals. A collapsible warning banner appears at the top of the deck page listing cards with missing prices for the active currency. The banner updates reactively when switching currencies.

On the index page, deck and collection entries with missing prices display the total as **"At least $X.XX (missing N cards)"** instead of the raw total, making it clear the price is incomplete. The "lowest price" variant is hidden when a deck has missing prices to avoid confusion.

## Collections

Collections are included in the build by default — every list allowed by `site.includeCollections`, or exactly the ones named by `--collections`. Collection files come from the `collections/` directory. Each collection card must have a set code and collector number (e.g., `- Sol Ring (C19:221)`). Cards without this information are skipped with a warning.

Collection pages show:

- Total collection value based on specific printing and finish prices
- Individual card prices, conditions, finishes, and set/collector number in the card detail modal
- Non-English copies labelled with their [language](/commands/edit/#card-language) beside the finish and condition — `(Foil · JA)` on card tiles in the art views, and as part of the parenthesised list-view label
- A "View on Scryfall" link in the card detail modal that opens the card's Scryfall page
- An "Other Printings" button that shows a paginated binder-style grid (8 per page) of all known printings of the card, sorted by release date (newest first) by default, each linking to Scryfall. Sorting can be changed via a dropdown to release date, set name, or price, with a toggle to reverse the sort direction.
- Cards displayed individually by default (not grouped), with a "Group Duplicates" toggle
- File order as the default sort, with options for name, price, set code, type, mana value, and color identity
- Grouping by section (the default when the collection has two or more sections), type, mana value, color identity, price brackets, or ungrouped
- Price bracket grouping with three strategies: Archidekt-style brackets, every $5, or every $10
- A "No Price Data" group that appears at the bottom when grouping by price, collecting cards without price data for their finish
- Download as original Markdown or CSV for importing into other sites
- Section/group price totals that update dynamically

## Wanted Lists

Wanted lists are included in the build by default — every list allowed by `site.includeWantedLists`, or exactly the ones named by `--wanted-lists`. Wanted list files come from the `wanted/` directory. Unlike collections, wanted list entries can have varying levels of specificity — from just a card name to a fully pinned printing and finish.

Wanted list pages show:

- Total wanted list value based on current card prices
- Prices always reflect the cheapest option for each entry's state:
  - **Name only** entries use the cheapest printing across all sets
  - **Printing** entries use the cheapest finish of that exact printing
  - **Fully specified** entries use the exact printing and finish specified
- Individual card prices in the card detail modal
- State indicator showing whether each card is name-only, printing-specific, or fully specified
- Grouping by section (the default when the wanted list has two or more sections), type, mana value, color identity, price brackets, printing (whether a card is pinned to a specific printing), or ungrouped
- Download as original Markdown
- No condition display (wanted lists track desired cards, not owned cards)

## Deck Features

Deck pages include:

- Total deck price (mainboard + sideboard) displayed at the top, updating when the "Lowest Price" toggle is enabled
- When extras are visible, a separate parenthetical "all cards" total is shown next to the main price
- "Lowest Price" toggle that swaps all cards to their cheapest available printing (images and prices update)
- Card detail modal with Scryfall link, other printings (paginated, sortable by release date, set name, or price), and full card details
- Section/group price totals shown next to card counts
- Grouping by type, section, mana value, color identity, price brackets, printing (whether a card is pinned to a specific printing), or ungrouped — applies to mainboard only
- Price bracket grouping with three strategies: Archidekt-style brackets, every $5, or every $10
- Sideboard always displayed in its own section at the bottom, ungrouped
- Extras (maybeboard, tokens) displayed below sideboard, toggled via "Hide Extras" checkbox
- Only printings with a listed price are considered for price analysis
- **View Changes** button (when a changelog exists) opens a paginated modal showing the edit history

## Change History

When a deck or collection has a `.changes.md` changelog file (created by the admin editor when saving changes), its edit history is included in the generated site.

- A **View Changes** button appears next to the **Copy** and **Download** buttons in the page header
- Clicking it opens a modal dialog showing paginated change entries, sorted most recent first
- Each page shows one editing session with its timestamp and a list of additions, removals, and other changes (every save within a single session is grouped into that one entry)
- Prev/Next buttons allow paging through older and newer changes
- Card names in the change list are clickable links that open the card detail modal
- Hovering a card name shows a preview image of the card

Cards referenced in changelogs that are no longer in the deck or collection are automatically resolved during the build so their card data is available for previews and modals.

## Editing on the Public Site

Although the generated site is static (no server), the navbar has an **Edit** toggle (top-right) that opens the same editor used in the admin site, running entirely in the browser, for whichever deck, collection, or wanted list you're viewing. (The toggle is present site-wide but disabled on pages with nothing to edit, such as the index.) Edits are **ephemeral** — nothing is saved to a server and nothing is persisted unless you explicitly choose to.

- **Edited vs. published** — while editing, the navbar grows a second row that makes it clear you are viewing a local copy, with an **Original / Edited** toggle to switch between your changes and the published version, and a **Discard** button to drop them. Press **Done** (the same navbar toggle) to leave edit mode.
- **Card search** — adding cards searches Scryfall directly (preferring the shared session cache), the same as the Trade Planner. Matching is Scryfall's own: the [autocomplete API](https://scryfall.com/docs/api/cards/autocomplete) treats your query as one contiguous string, unlike [the admin editor's term matching](/admin/editors/#step-1-search) over the local card cache (where `in tre` finds "In the Trenches"). Results can therefore differ between the two editors — the search dialog notes this and links to the Scryfall API docs. On a site backed by a [live API](/public-site/hosted/), search goes through the backend's cache with the admin editor's term matching instead, and the note disappears.
- **Keyboard shortcuts** — the editor shares the admin site's [keyboard shortcuts](/admin/editors/#keyboard-shortcuts): **Ctrl+Enter** opens the card search, **Ctrl+B** focuses the bottom action bar, and every step of the add-card dialog is arrow-key navigable. Press **?** (or the **?** button at the end of the action bar) for the full list.
- **Set a card's language** — **Set Language…** is available in the per-card **⋯** context menu and in the multi-select **Selected** menu, exactly as in [the admin editor](/admin/editors/#card-language): a picker over the 17 Scryfall [card languages](/commands/edit/#card-language), with **English** clearing the line's token (a bare line always means `en`).
- **Move a card to another list** — the per-card **⋯** menu, the per-list **Selected** menu, and the cross-list **All Selected** navbar menu each offer a single **Move to list…** item that opens a picker listing your other decks, collections, and wanted lists. Moving a card removes it from the list you're editing (it disappears from the edited view) and records the move in your exported change bundle. Moving a printing-less card into a collection (which needs a specific printing) opens the same printing picker the Trade Planner uses. Because the public site has no server, the destination list is only updated when the change bundle is later imported into the admin editor and saved.
- **Export your edits** — the **Export…** panel offers two ways to keep your changes:
  - **Download change list (JSON)** or **Copy JSON** — a portable change bundle that can later be applied to the real lists with the admin site's [Import Changes](/commands/admin/#import-changes) page or the [`import-changes`](/commands/import-changes/) CLI command (both preview the changes and ask for confirmation), or loaded into an editor as pending edits. Applied changes are re-targeted to the current card IDs.
  - **Download updated file** — a full deck `.txt` (or collection/wanted `.md`/`.csv`) with the edits already applied.
- **Export all edited lists at once** — because edit mode persists while you navigate, edits to several lists accumulate in one session. When more than the open list has pending changes, the Export panel gains a scope toggle — **This list (N changes)** vs. **All lists (M changes)** — showing exactly how many changes each export covers, and a **Review changes** section listing every pending change grouped by list before you commit to the export. The all-lists scope downloads a single **bundle** (`ritual-all-edits.json`) covering every edited list, importable by the same admin page and CLI command.
- **Export from anywhere in edit mode** — the **Export…** button stays available in the navbar's edit row even when you are not on a single list — on a combined view or a list directory. Off a list it defaults to the **All lists** scope, and the **This list** option is greyed out (there is no single open list to export). On a **combined view**, a third **Current lists (N changes)** scope sits between them, covering just the edited lists that make up the combination (downloaded as `ritual-combined-edits.json`). The per-list extras — **Download updated file** and **Save to this browser** — appear only when a single list is open.
- **Load changes** — the **Load Changes…** button (next to Export…) opens a dialog where you can upload or paste a change-list JSON (one exported from this site or from the admin editor) and apply it to the list you're editing. The changes load as pending edits, re-targeted to the current card IDs; any that can't be matched to a card in the list are reported and skipped. This is the same machinery the admin editor uses to [import changes](/commands/admin/#import-changes).
- **Save to this browser (opt-in)** — the Export panel can also save the current edit session to `localStorage`. This never happens automatically. When you return to a list with a saved session, the editor offers to **Restore** it (applied through the same safe re-target path as import); **Clear saved edits** removes it.

## Serving the Site

After building, use the [`serve`](/commands/serve/) command to preview locally:

```bash
./ritual serve
```

To build and serve in a single step, pass `--build` to [`serve`](/commands/serve/):

```bash
./ritual serve --build
```

## Trade Planner

The generated site includes a **Trade Planner** page accessible via the "Trade" link in the site navigation at `#/trade`. This is a fully client-side, ephemeral tool — no data is persisted between page refreshes.

The page provides a two-column layout for planning a trade:

### Left Column — My Cards

The left column is for cards you are offering. It searches cards from the collections included in this site. A "Include Decks in Search" toggle (disabled by default) extends the search to include cards from your decks as well.

- Type a card name in the search box to get autocomplete suggestions showing card name and source list
- Each result is deduplicated per source — if the same card appears in multiple collections, each collection shows up as a separate autocomplete result
- Cards show: thumbnail image, name, set code and collector number — with the language badged beside it for a non-English copy (`2XM:270 · JA`) — finish, condition, and price
- If a deck card has no specific printing pinned, selecting it opens the printing picker so you can choose one (the deck source is preserved on the resulting trade row)
- Sort by card name or price (toggle ascending/descending independently)
- Price total shown at the bottom of the column

**Quantity caps:** Each trade row's quantity stepper caps at the maximum number of that exact variant available in its source — for collections this is the count of identical note-less entries (same name, set, collector number, finish, condition); for decks it is the sum across mainboard/sideboard/etc. for that printing in that deck. When only one copy exists the stepper is hidden and a fixed quantity of 1 is displayed.

**Editing picker-sourced rows:** Trade rows added via the printing picker (everything on the right, deck cards without a pinned printing on the left) get a small yellow pencil button to the left of the quantity controls. Clicking it re-opens the printing picker for that card; choosing a printing replaces the row in place while preserving its quantity.

### Right Column — Their Cards

The right column is for cards the other party is offering. What it searches depends on whether the site has a [live backend](/public-site/hosted/).

**Static site — wanted list mode (default):** Search across all wanted lists on this site instance. Results show card name and source wanted list name. Cards no wanted list holds are only reachable through the "Search Scryfall instead" toggle.

**Static site — Scryfall mode:** When the toggle is on, autocomplete calls the Scryfall API directly from the browser, and only Scryfall's results are shown.

**Hosted site:** With `serve --api` behind the site, the server's card cache already covers every card, so the toggle is replaced by a note and each query searches your wanted lists **and** the cache at once. Wanted-list matches lead (with their source, printing and price), followed by cache matches labelled "Card cache". No request goes to Scryfall.

**Every right-column selection opens the printing picker.** A wanted list records the printing you'd _like_, not the one being offered, so picking a wanted card never assumes its printing: the picker opens with the printings your wanted lists ask for (across every list, for that card name) floated to the top and badged **Wanted**, and you choose what's actually on the table. The row keeps its wanted-list source and quantity cap whichever printing you take.

The picker shows all available printings, paginated 8 at a time, with a set-code filter input (e.g. typing `mkm` or `lea` narrows the results); hovering an entry shows the full card art preview. Choose a printing and finish, then click "Add to Trade" to add the card.

Non-English printings carry the same language badge as trade rows (`2XM:270 · JA`). Confirming a printing that exists **only** in a non-English language pauses on a notice — `This printing is only available in Japanese (ja) — it will be recorded as [ja].` — with a **Continue** button that accepts the language and a **Back** button that returns to the list. Shared trade URLs preserve each row's language, so the other party sees exactly the copies you encoded.

Rows added from a bare card name belong to no list of yours, so they're tagged with the backend that answered the lookup — **Cache** on a hosted site, **Scryfall** on a static one — and are encoded in the trade URL by Scryfall ID.

### Update Prices

The toolbar's **Update prices** button refetches current prices for the cards currently loaded on the trade page (only — not your full collection), and updates each row's price and finish in place. A toast confirms how many cards were updated. On a static site it batches requests through Scryfall's `/cards/collection` endpoint (75 IDs per request); on a site backed by a [live API](/public-site/hosted/) it goes through the backend's batch price endpoint instead, which updates its shared card cache server-side.

### Card Hover Previews

Hovering over a card thumbnail (in the trade list, autocomplete suggestions, or printing picker) shows an enlarged preview of the card art that follows the mouse cursor.

### Mobile Layout

On narrow screens (≤768px), the two-column layout collapses to a single-pane view. Tab buttons at the top switch between "My Cards" and "Their Cards". Each pane fills the full screen width, with its own search, sort controls, card list, and price total.
