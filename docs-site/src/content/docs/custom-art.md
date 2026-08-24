---
title: 'Custom Card Art'
---

Any card in any list can be shown with **your** image instead of the printing's Scryfall art — a proxy scan, an altered card photo, a piece of commissioned art. The image is referenced, never uploaded: you put the file in an art directory (or point at a URL) and Ritual records the reference in a per-list sidecar.

Custom art never changes the card line or the printing it is pinned to. It does change one thing beyond appearance: a card wearing art of its own is no longer the printing a price is quoted for, so **it carries no price** — see [Custom art carries no price](#custom-art-carries-no-price).

## The art directory

Local images live in the directory named by the [`artDir`](/configuration/#directory-options) config key — `./art` unless you change it, resolved against the base directory like `decksDir` and friends:

```bash
./ritual config set artDir ./art
```

Nothing ever creates the directory: a workspace with no `art/` simply has no local art, and only a reference to a file that is not there is an error. Organize it however you like — a reference is the path **relative to that directory**, so subdirectories are free:

```
art/
├── proxies/
│   ├── sol-ring.jpg
│   └── mana-crypt.png
└── alters/
    └── island-winter.webp
```

The same relative path identifies the image everywhere: on disk, in the built site (`art/proxies/sol-ring.jpg`), and in the served art route. Two lists referencing one file share it — the build copies each unique path once.

## The sidecar

Each list's art lives beside it as `<list>.art.json` — `decks/Winota Stax.art.json` next to `decks/Winota Stax.md`. It is a JSON object keyed by the card line's [`&N` id](/#the-card-id-backfill), whose values carry exactly one of `file` or `url`:

```json
{
  "5": { "file": "proxies/sol-ring.jpg" },
  "12": { "url": "https://example.com/art/bolt.png" }
}
```

- **`file`** is a path relative to the art directory. Forward slashes only (a backslash is rejected rather than rewritten), never absolute, and never escaping the directory — a `..` that survives normalization is an error. Its extension must be one of `.avif`, `.gif`, `.jpeg`, `.jpg`, `.png`, `.webp` (case-insensitive): those are the only ones the art route serves, so `--art notes.txt` is refused where you type it rather than written, published, and then answered with a `404`.
- **`url`** must be an absolute `http`/`https` URL, and is used verbatim. No extension rule applies here — image URLs routinely end in a query string or nothing at all, and the browser decides what it can render.
- Keys are the plain `&N` numbers as decimal strings; the file is written in ascending numeric order with a two-space indent, so a diff shows the edit rather than insertion order.
- Clearing the last card's art **deletes** the sidecar rather than leaving `{}` behind.

Ritual writes this file for you (see below), but hand-editing it is perfectly fine.

### When the sidecar is wrong

Parsing implies validation, and a malformed sidecar fails **as a whole** rather than loading the entries it could read — a partial read would be erased by the next write. A bad file is reported and the list still loads, editors included; its cards just show their normal art. The message names the exact problem: `card 5: "..\\secret.png" escapes the art directory`, `"x" is not a card id — keys are the card line's &N`, `not valid JSON: …`.

An entry pointing at a card id the list no longer has is only a **warning** — the entry is kept (removing it is your decision), and the warning reports the raw ids rather than looking names up for data that is gone. Ritual's own edits keep this from happening (see [Art follows the card](#art-follows-the-card)), so an orphan means the card line was taken out by something else: a hand edit, or another tool.

## Setting art

Five surfaces write the sidecar, and all of them validate identically:

- **CLI** — [`set-card --art`](/commands/set-card/#custom-art):

  ```bash
  ./ritual set-card --deck "Winota Stax" "Sol Ring" --art proxies/sol-ring.jpg
  ./ritual set-card --collection main "Lightning Bolt" --art https://example.com/bolt.png
  ./ritual set-card --deck "Winota Stax" "Sol Ring" --art none
  ```

- **CLI editor** — `🎨 Set Custom Art` in the [`edit`](/commands/edit/#custom-art) TUI's per-card action menu, on every list type: enter a URL, browse the art directory for a file, or clear what is there. Unlike the other writers this one is **deferred** — the edit is staged like every other session edit and written by the save, so `↩️ Undo Last Edit` takes it back and exiting without saving writes nothing.
- **Admin editors** — **Set Custom Art…** in a card's `⋯` [context menu](/admin/editors/#custom-art) opens a dialog with a file/URL toggle, a live preview, and **Save** / **Remove art**. The [add-card dialog](/admin/editors/#card-options) takes art too, for the card being added. Both are immediate writes for a card the saved file already has; for one this session added there is no line to write against yet, so the reference is held with the pending changes and written by the save that creates the line.
- **Agents** — the [`set_card_art`](/commands/mcp/) MCP tool, which calls the same admin route in-process. `get_list` reports a list's art back as `customArt`, keyed by `&N`.
- **By hand** — edit `<list>.art.json` in your editor. The next build (or the next request under [`serve --api`](/commands/serve/#live-api-mode---api)) picks it up.

Every write is a read-modify-write of the whole sidecar, and each refuses outright when the existing file cannot be read — overwriting it would erase art for cards the request never mentioned.

## Art is metadata, not a change

Like a deck's `.primer.md`, the art sidecar is **list metadata**:

- No change event and **no changelog entry** is ever recorded for it. The change log is card-level, and which picture a card wears is not a card change.
- It is not part of the editors' change **event** pipeline. The admin dialog saves immediately through its own route, so setting art there never interacts with pending card edits and needs no save; the CLI editor stages its art edits alongside the session's card edits and writes the sidecar in the same save, but still records no event for them.
- [`detect-changes`](/commands/detect-changes/) does not track hand edits to it (again, exactly like the primer), and the list's `.sha256` hash covers the markdown file only.
- It travels with the list: [`rename`](/commands/rename/), [`cleanup`](/commands/cleanup/)'s renames, and [`delete`](/commands/delete/) move or remove `.art.json` along with the other sidecars.

## Art follows the card

The sidecar is keyed by the card line's `&N`, and removing a line **releases that id** to the reuse pool — the next card added takes it. So the art cannot simply be left where it is: it would come back on a different card. Every edit that moves ids around re-files the sidecar in the same operation, and the file is rewritten only when something in it actually changed:

- **Removing a card** ([`remove-card`](/commands/remove-card/), an editor save, a bulk remove) drops that card's entry. Removing a _copy_ from a deck line that still has copies left does not: the line, its id, and its art all stay. The same applies to a removal made in the [`edit`](/commands/edit/) TUI, which re-files the sidecar when the session is saved — including art the same session had just set.
- **A removal is final for the art, even when the card comes straight back.** Removing a card and re-adding it in the same save leaves the card without art, though the written line may well carry the same `&N`: the removal is read from the changes, not from the file it produced. Art returns two ways only — **undo** the removal (which reclaims the original id, art and all, as long as nothing has since taken that id: an undo that has to allocate a fresh `&N` restores the card but not its art), or give the re-add art of its own. This is deliberate: a re-added card is a new copy, and inheriting the picture of the one that left would be a surprise nothing asked for.
- **Unless the two cancel out entirely.** In the web editors, adding a card that is the exact opposite of a removal still pending in the same session — same card, same printing, same labels — cancels that removal outright instead of queueing a second change. Nothing about the line reaches the save, the file is never rewritten, and **its art stays**. That is not an exception to the rule above so much as the absence of a removal to apply it to: taking the card out and putting it back leaves you where you started, art included.
- **Moving a card between lists** carries the entry across — it is dropped from the source and re-filed under the id the destination's new line was given. This holds for [`move`](/commands/move/), the admin editors' move-to-another-list, the `edit` TUI's, the web editors' **Swap Printings** wizard (whose incoming copies carry their art _into_ the edited list), and a bundle's `moves` applied by [`import-changes`](/commands/import-changes/) or the MCP `import_change_bundle` tool. A copy that merges onto a line the destination already had does not take its art with it; that line already stands for the card and may have art of its own — a copy landing on a new or emptied `&N` adopts the arriving art. An incoming copy whose art has no destination line to follow onto is reported as unfiled rather than dropped silently.
- **A save that renumbers a line** (an incoming card claiming an `&N` that is already taken) re-files the entry under the line's new id.
- **A sync that pulls removals in** — [`deck-sync pull`](/commands/deck-sync/) and [`collection-sync`](/commands/collection-sync/) — drops the entries of the cards it removed. A `deck-sync push` writes the deck back unchanged apart from its sync stamp, so it never touches the sidecar.

Everything here writes the sidecar directly, with no changelog entry, exactly like setting art in the first place. A list's [cover image](/list-images/) is filed under an `&N` the same way and is reconciled in the very same step, by the same rules.

## Custom art carries no price

A card given custom art is priced at **0 everywhere**, exactly like a card labeled [`proxy`](/commands/edit/#card-labels). One rule covers both: custom art or proxy ⇒ no price, no quotes, no sale.

- [`ritual price`](/commands/price/) short-circuits the entry before any lookup: price and lowest price are `0`, the unpriced reason is `custom-art`, and it counts toward the card count but **not** toward the unpriced count — it is not a gap in the price data. A card that is both custom-arted and labeled `proxy` reports `custom-art`; custom art wins.
- [`ritual sell`](/commands/sell/) drops the entry before matching, so it is never quoted against a buylist and never counted as a card the buyer declined.
- On the public site the card contributes `0` to every total, is left out of the missing-price counts, and shows **CUSTOM** where a price would be (**PROXY** for a proxy without custom art) — in list views, the card modal, and trade pages alike. It gets no buylist quote in [sell mode](/public-site/sell/).

The reasoning is the same as for a proxy: the price of a Sol Ring is the price of a specific printing of Sol Ring, and an altered or hand-drawn copy is not that object. Do not read the zero as "worthless" — read it as "Ritual has nothing to quote".

## Where custom art appears

On the public site and in the editors, a card with custom art shows it on:

- card tiles in every art view (grid, binder, stacks) and the list view's hover preview,
- the [card detail modal](/commands/build-site/#card-detail-modal)'s main image,
- the list's cover image on the site index, when that card is the one the cover
  picks (a deck's commander, or a collection's or wanted list's priciest entry).
  The cover ranks entries by the **printing's** price rather than the zero
  below, so a custom-art copy of an expensive card can still be a list's face.

Only the **front** image is replaced. A double-faced card's back keeps its real face — the override is the entry's, not the printing's. The modal's **Other Printings** grid and the editors' printing pickers also keep real thumbnails: they exist to show you actual printings.

## Publishing

[`build-site`](/commands/build-site/#output) copies every referenced local file into `dist/art/<relpath>` before it bakes any list, once per unique path, and writes the resolved value into each list's detail JSON (`art/<relpath>` for files, the URL verbatim). A referenced file that is not on disk is reported as a build warning and simply omitted, so the card falls back to its normal art rather than showing a broken image:

```
  ⚠️  Custom art file not found in /home/you/mtg/art: proxies/sol-ring.jpg
Copied 3 files of custom art.
```

A file that exists but cannot be read or copied at all (a permission denial, a broken symlink) is warned about the same way and the same card falls back to its normal art — one bad image never fails the build.

The **price** does not fall back with the picture. What makes a card priceless is the reference in the sidecar, not the image that came out of the build: a card whose file could not be deployed still prices at `0`, still counts as nothing in every total, and is still left out of the missing-price counts and of every buylist quote. That holds for the built site as much as for [`ritual price`](/commands/price/) and [`ritual sell`](/commands/sell/), which read the sidecar and never see the build's output at all.

The **CUSTOM** marker does not fall back either: the site bakes the sidecar's answer beside the image URL, so such a card reads `CUSTOM` where its price would be everywhere the deployed ones do — deck, collection and wanted list pages, the [combined view](/public-site/combined-view/) and its find view, the card detail modal, the selection totals, and the trade board — and is refused a buylist quote in [sell mode](/public-site/sell/) just the same. The only thing missing is the picture: the tile shows the printing's own art until you put the file back.

Under [`serve --api`](/commands/serve/#live-api-mode---api) nothing is copied: the server answers `GET /art/<relpath>` from the workspace's art directory directly, at the exact path the baked value names, so a new image or an edited sidecar shows up without a rebuild. The [admin server](/commands/admin/) mounts the same route behind authentication so the editors can preview local files.

Only `.avif`, `.gif`, `.jpeg`, `.jpg`, `.png`, and `.webp` are served — the same allowlist a `file` reference is validated against, so a reference that parses is a reference the route will answer. SVG is deliberately excluded — it can carry script, and the route is same-origin with the admin UI. Anything else in the art directory answers `404`, as does any attempt to step outside it.

A list's [cover image](/list-images/) shares all of this: a `file` cover is copied into `dist/art/` by the same pass, obeys the same reference rules and the same allowlist, and falls back to the list's default cover with the same `Custom art file not found` warning. It differs only in where it is stored — the list's own front matter, not the sidecar — and in what it names, which may also be a card in the list or a URL.

## See also

- [List cover images](/list-images/) — the same reference rules, applied to a whole list's cover
- [`set-card --art`](/commands/set-card/#custom-art) — the CLI writer
- [`edit` → Custom Art](/commands/edit/#custom-art) — the interactive editor's action and its art-directory file browser
- [Admin editors → Custom Art](/admin/editors/#custom-art) — the dialog
- [Card labels](/commands/edit/#card-labels) — the `proxy` label, which pairs naturally with a scanned proxy image (neither one implies the other, but both mean the card carries no price)
- [Admin API → Card Art](/admin/api/#card-art) — `PUT /api/art/:type/:slug`
- [MCP → `set_card_art`](/commands/mcp/) — the agent-facing writer
