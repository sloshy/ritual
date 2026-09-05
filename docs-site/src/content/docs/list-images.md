---
title: 'List Cover Images'
description: Choose the picture a list shows on the site index and in Quick Switch, or let Ritual pick one.
---

Every list gets a **cover image** on the published site: the picture on its tile on the index page, and the one it shows in Quick Switch. Ritual chooses one for you. A commander deck shows its commander, and every other list shows its most expensive printing. Any list can override that choice with the `image:` key in its YAML front matter.

The override works on decks, collections, **and wanted lists**. For a wanted list it is one of only two front-matter keys, alongside the [`description:`](/commands/metadata/) blurb.

## The key

`image:` is always a single-key mapping naming exactly one of three things:

```yaml
---
format: commander
image:
  card: 12
---
```

| Mode   | Value                                                                  | Meaning                                                        |
| ------ | ---------------------------------------------------------------------- | -------------------------------------------------------------- |
| `card` | the `&N` of a card line **in this same list**                          | Show that card (its custom art, if it wears any)               |
| `file` | a path relative to the [art directory](/custom-art/#the-art-directory) | Show that image, published into the site like custom art       |
| `url`  | an absolute `http(s)` URL                                              | Use the URL verbatim; the browser does the rest                |
| —      | no `image:` key at all                                                 | Ritual's own choice: the commander, else the priciest printing |

```yaml
image:
  file: alters/atraxa.png
image:
  url: https://example.com/cover.jpg
```

### The mapping is the only spelling

Scalar forms are **rejected**, for three reasons:

- `image: &12` is not the string `&12`. A leading `&` opens a YAML _anchor_, and the value parses as `null`. Writing what looks like the id from a card line would silently mean nothing at all.
- `image: alters/atraxa.png` and `image: https://…` would each need a second grammar to tell a path from a URL, one that the CLI flags, the admin radio buttons, and the API body do not want.
- There is no `image: default` either. A list goes back to Ritual's own choice by **removing the key** (or by writing `null` through an API).

So every non-mapping value is a parse error. The key is ignored, the built-in cover applies, and the site build reports `Front matter 'image' ignored: …` with the parser's reason. Fix it when you see that warning. A collection or wanted list carries the unreadable value along untouched, but a deck's next whole-file save drops the key entirely, the same way it drops a `labels:` it cannot read.

A _valid_ `image:` needs no fixing on any type. There is nothing to normalize, so the block you wrote survives every save on all three list types alike.

## Setting it

| Surface    | How                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| CLI        | [`ritual set-list-image`](/commands/set-list-image/) — `--card`, `--file`, `--url`, `--default`, or no flag for a wizard |
| Admin site | The **Cover Image** button in the deck, collection, and wanted-list editors                                              |
| MCP        | The `image` field on the `set_list_metadata` tool (`null` clears it)                                                     |
| HTTP       | [`PUT /api/metadata/:type/:slug`](/admin/api/#list-metadata) — the same body shape                                       |
| By hand    | Edit the front matter                                                                                                    |

[`ritual metadata`](/commands/metadata/) does **not** write it. A cover is a mapping, which that command's scalar `<value…>` arguments cannot spell. `metadata list` reports the stored mapping; `set`, `unset` and `get` alike refuse the key (exit `2`) with a message naming `ritual set-list-image`.

```bash
ritual set-list-image "Winota Stax" --card 12
ritual set-list-image "Main Binder" --file alters/binder.png
ritual set-list-image "To Buy" --wanted --url https://example.com/cover.jpg
ritual set-list-image "Winota Stax" --default
```

## The card reference follows the card

A `card` cover names a card **line**, by the same [`&N` id](/cli-conventions/#the-card-id-backfill) the line carries. It does not name a printing, so it can point at a specific one of two lines of the same card, or at a line that pins no printing at all.

Those ids are recycled: removing a line releases its id to the next card added. A cover reference is therefore reconciled the way [custom art](/custom-art/) is, on every path that removes, moves, or renumbers a card line:

- the covered card is **removed**: the `image:` key is removed with it, and the built-in cover applies again;
- a save **renumbers** the line: the key is rewritten to the new id;
- anything else: the file is not rewritten at all.

That is why a `card` id is validated when it is **written**. Every surface refuses one the list does not carry (CLI exit `2`, HTTP/MCP `400`) rather than storing a reference that would later point at an unrelated card. A hand-edited file is the only way to get a stale one. The site build then warns, `List image for deck 'x' references card &12, which is no longer in the list`, and falls back to the default cover.

One case is silent by design. A covered card whose printing cannot be resolved (and which wears no custom art) falls back to the default cover without a second warning, because the unresolvable printing has already been reported against that card.

## Files, URLs, and the build

A `file` cover obeys the [custom-art reference rules](/custom-art/#the-sidecar) exactly: forward slashes, relative to the art directory, never escaping it, and one of `.avif`, `.gif`, `.jpeg`, `.jpg`, `.png`, `.webp`. It is published the same way: [`build-site`](/commands/build-site/) copies it into `dist/art/`, and [`serve --api`](/commands/serve/) serves it live from the art directory.

Unlike a card id, and unlike a card's custom art, which is refused outright when the file is not there, **a cover file is not required to exist when you set it**. Only the shape of the path is checked, so you may point at an image you are about to add. A path with nothing behind it at build time prints the usual `Custom art file not found in …` warning and the list falls back to its default cover.

A `url` cover is never validated, not when written and not at build time. A broken one is the browser's problem, exactly as for a custom-art URL. Note that `serve --api` bakes a `file` cover without checking it too, so a missing file there shows as a `404` in the page rather than a fallback.

## Public-site downloads

The public site's edit mode can download an edited collection or wanted list as Markdown. That file is synthesized from the published data, which carries the list's `description:`, its `labels:` and its `image:`. All three are re-emitted, so the cover survives a download-and-replace. Every _other_ hand-authored key, along with comments and quoting style, is still lost: only what the site bakes can be rebuilt in a browser.

## Known gap: the CLI edit session

A [`ritual edit`](/commands/edit/) session snapshots a list's front matter when it opens and re-emits the block on save. Two consequences follow, until the session grows its own cover action:

- you cannot set a cover from inside an edit session (use `set-list-image` in another shell, or the admin editor);
- if `set-list-image`, the admin editor, or the MCP tool writes `image:` **while** a session is open on that list, the session's next save re-emits its stale block and drops it. Reopen the session after an outside metadata write.

## See Also

- [`set-list-image`](/commands/set-list-image/) — the command
- [Custom Card Art](/custom-art/) — per-card images, the art directory, and the reference rules a `file` cover shares
- [`metadata`](/commands/metadata/) — the rest of a list's front matter
