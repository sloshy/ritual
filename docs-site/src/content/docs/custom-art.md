---
title: 'Custom Card Art'
description: Show your own image for any card, from a local art directory or a URL, recorded in a per-list sidecar.
---

Any card in any list can show **your** image instead of the printing's Scryfall art: a proxy scan, an altered card photo, commissioned art. The image is referenced, never uploaded. You put the file in an art directory (or point at a URL), and Ritual records the reference in a small JSON file beside the list (a "sidecar").

Custom art never changes the card line or the printing it is pinned to. It changes one thing beyond appearance: a card with its own art **carries no price**. See [Custom art carries no price](#custom-art-carries-no-price).

## The art directory

Local images live in the directory named by the [`artDir`](/configuration/#directory-options) config key: `./art` unless you change it, resolved against the base directory like `decksDir`.

```bash
ritual config set artDir ./art
```

Nothing creates the directory for you. A workspace with no `art/` has no local art; only a reference to a file that is not there is an error. Organize it however you like. A reference is the path **relative to that directory**, so subdirectories work:

```
art/
├── proxies/
│   ├── sol-ring.jpg
│   └── mana-crypt.png
└── alters/
    └── island-winter.webp
```

The same relative path identifies the image everywhere: on disk, in the built site (`art/proxies/sol-ring.jpg`), and in the served art route. Two lists referencing one file share it; the build copies each unique path once.

## The sidecar

Each list's art lives beside it as `<list>.art.json`, so `decks/Winota Stax.art.json` sits next to `decks/Winota Stax.md`. It is a JSON object keyed by the card line's [`&N` id](/cli-conventions/#the-card-id-backfill). Each value carries exactly one of `file` or `url`:

```json
{
  "5": { "file": "proxies/sol-ring.jpg" },
  "12": { "url": "https://example.com/art/bolt.png" }
}
```

- **`file`** is a path relative to the art directory. Forward slashes only (a backslash is rejected, not rewritten), never absolute, and never escaping the directory: a `..` that survives normalization is an error. The extension must be one of `.avif`, `.gif`, `.jpeg`, `.jpg`, `.png`, `.webp` (case-insensitive). Those are the only ones the art route serves, so `--art notes.txt` is refused where you type it.
- **`url`** must be an absolute `http`/`https` URL and is used verbatim. No extension rule applies; the browser decides what it can render.
- Keys are the plain `&N` numbers as decimal strings. The file is written in ascending numeric order with a two-space indent.
- Clearing the last card's art **deletes** the sidecar rather than leaving `{}`.

Ritual writes this file for you (see below), but hand-editing it is fine.

### When the sidecar is wrong

A malformed sidecar fails **as a whole** rather than loading the entries it could read, because a partial read would be erased by the next write. A bad file is reported and the list still loads, editors included; its cards show their normal art. The message names the exact problem: `card 5: "..\\secret.png" escapes the art directory`, `"x" is not a card id — keys are the card line's &N`, `not valid JSON: …`.

An entry pointing at a card id the list no longer has is only a **warning**. The entry is kept (removing it is your decision), and the warning reports the raw ids. Ritual's own edits never leave such an entry behind (see [Art follows the card](#art-follows-the-card)), so an orphan means the card line was removed by a hand edit or another tool.

## Setting art

Five surfaces write the sidecar, and all validate identically:

- **CLI**: [`set-card --art`](/commands/set-card/#custom-art).

  ```bash
  ritual set-card --deck "Winota Stax" "Sol Ring" --art proxies/sol-ring.jpg
  ritual set-card --collection main "Lightning Bolt" --art https://example.com/bolt.png
  ritual set-card --deck "Winota Stax" "Sol Ring" --art none
  ```

- **CLI editor**: `🎨 Set Custom Art` in the [`edit`](/commands/edit/#custom-art) TUI's per-card action menu, on every list type. Enter a URL, browse the art directory for a file, or clear what is there. This writer is **deferred**: the edit is staged like every other session edit and written by the save, so `↩️ Undo Last Edit` takes it back and exiting without saving writes nothing.
- **Admin editors**: **Set Custom Art…** in a card's `⋯` [context menu](/admin/editors/#custom-art) opens a dialog with a file/URL toggle, a live preview, and **Save** / **Remove art**. The [add-card dialog](/admin/editors/#card-options) takes art too. Both write immediately for a card the saved file already has. For a card this session added, there is no line yet, so the reference is held with the pending changes and written by the save that creates the line.
- **Agents**: the [`set_card_art`](/commands/mcp/) MCP tool, which calls the same admin route in-process. `get_list` reports a list's art as `customArt`, keyed by `&N`.
- **By hand**: edit `<list>.art.json`. The next build (or the next request under [`serve --api`](/commands/serve/#live-api-mode---api)) picks it up.

Every write reads and rewrites the whole sidecar. Each refuses when the existing file cannot be read, since overwriting it would erase art for cards the request never mentioned.

## Art is metadata, not a change

Like a deck's `.primer.md`, the art sidecar is **list metadata**:

- No change event and **no changelog entry** is recorded for it. The change log is card-level, and which picture a card shows is not a card change.
- It is not part of the editors' change pipeline. The admin dialog saves immediately through its own route, so setting art there never interacts with pending card edits and needs no save. The CLI editor stages its art edits with the session's card edits and writes the sidecar in the same save, but still records no event.
- [`detect-changes`](/commands/detect-changes/) does not track hand edits to it, and the list's `.sha256` hash covers the markdown file only.
- It travels with the list: [`rename`](/commands/rename/), [`cleanup`](/commands/cleanup/)'s renames, and [`delete`](/commands/delete/) move or remove `.art.json` with the other sidecars.

## Art follows the card

The sidecar is keyed by `&N`, and removing a line **releases that id** for the next card added. The art cannot stay where it is, or it would come back on a different card. Every edit that moves ids re-files the sidecar in the same operation, and the file is rewritten only when something in it changed:

- **Removing a card** ([`remove-card`](/commands/remove-card/), an editor save, a bulk remove) drops that card's entry. Removing a _copy_ from a deck line that still has copies left does not: the line, its id, and its art stay. A removal in the [`edit`](/commands/edit/) TUI re-files the sidecar when the session is saved, including art the same session had just set.
- **A removal is final for the art, even when the card comes straight back.** Removing a card and re-adding it in the same save leaves the card without art, even if the written line carries the same `&N`. Art returns two ways only: **undo** the removal, which reclaims the original id, art and all, as long as nothing has since taken that id (an undo that must allocate a fresh `&N` restores the card but not its art); or give the re-add art of its own.
- **Unless the two cancel out entirely.** In the web editors, adding a card that is the exact opposite of a removal still pending in the same session (same card, printing, and labels) cancels that removal instead of queueing a second change. The file is never rewritten, and **its art stays**.
- **Moving a card between lists** carries the entry across: dropped from the source, re-filed under the destination's new `&N`. This holds for [`move`](/commands/move/), the admin editors' move-to-another-list, the `edit` TUI's, the web editors' **Swap Printings** wizard (whose incoming copies carry their art _into_ the edited list), and a bundle's `moves` applied by [`import-changes`](/commands/import-changes/) or the MCP `import_change_bundle` tool. Rules:
  - A copy that merges onto a line the destination already had does not bring its art; that line may have art of its own.
  - A copy landing on a new or emptied `&N` adopts the arriving art.
  - An incoming copy whose art has no destination line is reported as unfiled rather than dropped silently.
  - A copy that replaces a **name-only** line in place (the Swap Printings wizard) lands on a standing line: that line keeps its own art and the arriving reference stays where it was.
- **A save that renumbers a line** (an incoming card claiming an `&N` already taken) re-files the entry under the new id.
- **A sync that pulls removals in** ([`deck-sync pull`](/commands/deck-sync/) and [`collection-sync`](/commands/collection-sync/)) drops the entries of the cards it removed. A `deck-sync push` writes the deck back unchanged apart from its sync stamp, so it never touches the sidecar.

All of this writes the sidecar directly, with no changelog entry. A list's [cover image](/list-images/) is filed under an `&N` the same way and is reconciled in the same step, by the same rules.

## Custom art carries no price

A card with custom art is priced at **0 everywhere**, exactly like a card labeled [`proxy`](/list-format/#card-labels). One rule covers both: custom art or proxy means no price, no quotes, no sale.

- [`ritual price`](/commands/price/) skips the lookup. Price and lowest price are `0`, the unpriced reason is `custom-art`, and it counts toward the card count but **not** the unpriced count. A card that is both custom-arted and labeled `proxy` reports `custom-art`; custom art wins.
- [`ritual sell`](/commands/sell/) drops the entry before matching, so it is never quoted against a buylist and never counted as a card the buyer declined.
- On the public site the card contributes `0` to every total, is left out of the missing-price counts, and shows **CUSTOM** where a price would be (**PROXY** for a proxy without custom art), in list views, the card modal, and trade pages. It gets no buylist quote in [sell mode](/public-site/sell/).

Read the zero as "Ritual has nothing to quote", not "worthless": the price of a card is the price of a specific printing, and an altered or hand-drawn copy is not that object.

## Where custom art appears

On the public site and in the editors, a card with custom art shows it on:

- card tiles in every art view (grid, binder, stacks) and the list view's hover preview,
- the [card detail modal](/public-site/browsing/#card-detail-modal)'s main image,
- the list's cover image on the site index, when that card is the one the cover picks (a deck's commander, or a collection's or wanted list's priciest entry). The cover ranks entries by the **printing's** price rather than the zero above, so a custom-art copy of an expensive card can still be a list's face.

Only the **front** image is replaced. A double-faced card's back keeps its real face, since the override belongs to the entry, not the printing. The modal's **Other Printings** grid and the editors' printing pickers keep real thumbnails: they exist to show actual printings.

## Publishing

[`build-site`](/commands/build-site/#output) copies every referenced local file into `dist/art/<relpath>`, once per unique path, and writes the resolved value into each list's detail JSON (`art/<relpath>` for files, the URL verbatim). A referenced file that is not on disk is a build warning and is omitted, so the card falls back to its normal art rather than a broken image:

```
  ⚠️  Custom art file not found in /home/you/mtg/art: proxies/sol-ring.jpg
Copied 3 files of custom art.
```

A file that exists but cannot be read or copied (a permission denial, a broken symlink) gets the same warning and the same fallback. One bad image never fails the build.

The **price** and the **CUSTOM** marker do not fall back with the picture. What makes a card priceless is the reference in the sidecar, not the image in the build. A card whose file could not be deployed still prices at `0`, contributes `0` to every total, is left out of the missing-price counts and every buylist quote, and reads `CUSTOM` everywhere a price would show (list pages, the [combined view](/public-site/combined-view/) and its find view, the card detail modal, the selection totals, and the trade board). That holds for the built site as well as [`ritual price`](/commands/price/) and [`ritual sell`](/commands/sell/), which read the sidecar and never see the build's output. Only the picture is missing: the tile shows the printing's own art until you put the file back.

Under [`serve --api`](/commands/serve/#live-api-mode---api) nothing is copied. The server answers `GET /art/<relpath>` from the workspace's art directory directly, so a new image or an edited sidecar shows up without a rebuild. The [admin server](/commands/admin/) mounts the same route behind authentication so the editors can preview local files.

Only `.avif`, `.gif`, `.jpeg`, `.jpg`, `.png`, and `.webp` are served, the same allowlist a `file` reference is validated against. SVG is excluded because it can carry script, and the route is same-origin with the admin UI. Anything else in the art directory answers `404`, as does any attempt to step outside it.

A list's [cover image](/list-images/) shares all of this. A `file` cover is copied into `dist/art/` by the same pass, obeys the same reference rules and allowlist, and falls back to the list's default cover with the same `Custom art file not found` warning. It differs only in where it is stored (the list's front matter, not the sidecar) and in what it may name (also a card in the list or a URL).

## See also

- [List cover images](/list-images/) — the same reference rules, applied to a whole list's cover
- [`set-card --art`](/commands/set-card/#custom-art) — the CLI writer
- [`edit` → Custom Art](/commands/edit/#custom-art) — the interactive editor's action and its art-directory file browser
- [Admin editors → Custom Art](/admin/editors/#custom-art) — the dialog
- [Card labels](/list-format/#card-labels) — the `proxy` label; neither implies the other, but both mean the card carries no price
- [Admin API → Card Art](/admin/api/#card-art) — `PUT /api/art/:type/:slug`
- [MCP → `set_card_art`](/commands/mcp/) — the agent-facing writer
