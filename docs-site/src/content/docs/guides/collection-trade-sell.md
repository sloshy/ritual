---
title: 'Manage a Collection, Trade and Sell'
description: 'Keep your cards in collection lists, mark what you will trade or sell, track what you want, and use prices, the Trade page and the Card Kingdom buylist to decide.'
---

This guide covers the cards you own: where to keep them, how to mark what each copy is for, and how to move from "what do I have" to a trade or a sale. Each step links to the reference page with every option.

It assumes you have a workspace with a few lists. If not, start with the [quick tour](/start/tour/).

## 1. Split Your Cards into Collections

A collection is one list file under `collections/`. Make as many as you like: one per binder, box or shelf.

```bash
ritual new collection "Trade Binder"
ritual new collection "Bulk Box"
ritual new wanted "Needs"
```

A collection differs from a deck in two ways ([full table](/list-format/#the-three-list-types)):

- **Every copy is its own line.** Four Lightning Bolts are four lines, so each copy can have its own condition, language or note.
- **Every line has a printing.** A collection holds physical cards, so each line names its set and collector number: `- Lightning Bolt (LEA:161)`.

Collections have no fixed sections. A `## Heading` inside one is just a group you choose, such as `## Page 1` or `## Foils`.

To bring in a collection you already track elsewhere, import its CSV with [`ritual import`](/commands/import/), or pull it from Archidekt (see [Sync with Archidekt](/guides/archidekt-sync/)).

## 2. Record Each Copy's Details

A copy can carry a finish, a condition and a language. Defaults are left off the line: nonfoil, Near Mint, English.

```markdown
- Lightning Bolt (LEA:161) [LP] &1
- Mana Crypt (2XM:270) [foil] [ja] &2
```

Add a copy with all of them in one command:

```bash
ritual add-card --collection "Trade Binder" Mana Crypt --exact \
  --set 2XM --collector-number 270 --finish foil --language ja
```

`add-card` adds one copy at a time to a collection. For many cards, use the interactive editor, `ritual edit`, or the [admin site](/admin/editors/).

Fix a copy later with [`set-card`](/commands/set-card/):

```bash
ritual set-card --collection "Trade Binder" "Lightning Bolt" --condition MP
ritual set-card --collection "Trade Binder" --card-id 2 --language en
```

Conditions are `NM`, `LP`, `MP`, `HP` and `DMG`. Languages are [Scryfall language codes](/list-format/#card-language) (`ja`, `de`, `zhs`, …). New cards get the [`defaultLanguage`](/configuration/#default-language) from your config, English unless you change it.

## 3. Mark What Each Copy Is For

Labels tell Ritual what you plan to do with a copy. A collection can use four:

| Label   | Meaning                          |
| ------- | -------------------------------- |
| `sale`  | For sale                         |
| `trade` | For trade (combines with `sale`) |
| `keep`  | To keep (stands alone)           |
| `proxy` | Not a real card; priced at zero  |

Set a default for a whole list, so every card in it inherits the label:

```bash
ritual metadata set "Trade Binder" labels sale,trade
```

Then adjust single cards. `sale` and `trade` add to the default; `keep` and `proxy` stand alone, so they replace it. `no-<label>` takes an inherited label away:

```bash
ritual set-card "Trade Binder" "Mana Crypt" --label no-sale    # trade only
ritual set-card "Trade Binder" "Black Lotus" --label keep      # not leaving
```

`--label none` clears a card's own labels, so it goes back to the list default.

Decks carry only `proxy` (and `no-proxy`), which is useful for a playtest deck. Wanted lists carry no labels. The rules for combining labels are in [Card labels](/list-format/#card-labels).

## 4. Add Tags and Notes

A **tag** is your own word for a copy, and it follows the card to any list: `Signed`, `Gift`, `CK Batch`. A **note** is free text on one line.

```bash
ritual set-card "Trade Binder" "Black Lotus" --tag "Signed, Graded"
ritual note "Trade Binder" "Black Lotus" --note "signed by the artist"
```

On the line they look like this:

```markdown
- Black Lotus (LEA:232) [keep] #Graded, Signed {signed by the artist} &3
```

Tags do not change what Ritual does with a card; labels do. Neither is the same as a deck's [categories](/commands/categories/). [Labels, tags, and categories](/list-format/#labels-tags-and-categories) explains which to use.

## 5. Keep a Wanted List

A wanted list holds cards you are looking for. A line can name just the card, or a printing and finish if you care which:

```markdown
- Counterspell &1
- Bloodghast (ZEN:83) [foil] &2
```

A name-only line is priced at the cheapest printing. See [wanted-list card states](/list-format/#wanted-list-card-states).

```bash
ritual add-card --wanted "Needs" Demonic Tutor --exact --name-only
```

## 6. Move Cards Between Lists

When a wanted card arrives, move it into a collection. A collection needs a printing, so give it in the same command:

```bash
ritual move "Demonic Tutor" --from wanted:Needs --to "collection:Trade Binder" \
  --set sta --collector-number 90
```

Moving a copy between binders, or from a binder into a deck, works the same way:

```bash
ritual move "Lightning Bolt" --from "collection:Bulk Box" --to "collection:Trade Binder"
```

Tags, notes and language travel with the card. Labels are kept as far as the destination allows. Both lists get a changelog entry. Run `ritual move` with no arguments for an interactive session, or use [the admin Move Cards page](/admin/move-cards/). The details are on the [`move`](/commands/move/) page.

## 7. See What It Is Worth

```bash
ritual price --collection
```

[`price`](/commands/price/) opens a browser of your lists and their totals. Add `--summary` to print the totals instead. Prices come from TCGplayer by default; `--source cardmarket` shows euros, and [`priceSources`](/configuration/#price-stores-pricesources) sets which stores you use. Proxies count as zero.

## 8. Plan a Trade on Your Site

Build your site (`ritual serve --build`, or see [Publish your deck site](/guides/publish-site/)) and open **Trade** in its navbar. The [Trade Editor](/public-site/trade/) has two columns:

- **Offering** searches your collections (and your decks, if you switch that on).
- **Receiving** searches your wanted lists, or Scryfall for anything else. You pick the printing the other person is offering.

Each column shows a price total. The trade is kept in the browser only, not in your files, and you can share it with the other person as a link.

Other site pages help you prepare:

- On a collection page, the **Labels** filter shows only cards **For sale** or **For trade**. See [Filtering](/public-site/filtering/).
- [Find](/public-site/find/) takes a pasted list of names, such as someone's want list, and shows which of your lists hold each card.

After the trade, record it: `move` or `remove-card` the cards you gave, and `add-card` the ones you got.

## 9. Check a Buylist Offer

[`sell`](/commands/sell/) shows what Card Kingdom's buylist pays for your cards right now. The first run downloads Card Kingdom's public price file (about 70 MB), which is then reused for a day.

```bash
ritual sell                        # every collection
ritual sell "Trade Binder" --min 1 # one list, offers of $1 or more
ritual sell --min-ratio 0.7        # offers at 70% of TCGplayer market or better
```

Quotes are cash prices for Near Mint copies. Played cards are graded down when the store receives them, and offers change daily, so treat the report as a guide.

To sell a hand-picked batch, tag those copies and build Card Kingdom's sell-cart CSV from the tag:

```bash
ritual set-card "Trade Binder" --card-id 14 --tag "CK Batch"
ritual sell --tags "CK Batch" --output csv --out ck-batch.csv
```

Upload the file on Card Kingdom's CSV import page. See [Selling a Hand-Picked Batch](/commands/sell/#selling-a-hand-picked-batch). Proxies and cards with custom art are never quoted.

The same quotes can appear on your site with [sell mode](/public-site/sell/). Sell mode on the sites is **beta** and off by default; `ritual sell` works without it.

## 10. Export a List

[`export`](/commands/export/) writes any set of cards as CSV, JSON, text or Markdown, filtered by labels, tags, condition and more:

```bash
# Everything marked for trade, as a plain-text list to paste into a message
ritual export --collection --labels trade --format text

# Your collections in the shape Archidekt's importer reads
ritual export --collection --preset archidekt --out archidekt.csv
```

Run `ritual export` with no arguments for a wizard that asks the same questions.

## Where Next

- [List Files](/list-format/): every token a card line can carry.
- [Sync with Archidekt](/guides/archidekt-sync/): keep these collections in step with your Archidekt collection.
- [Take edits from your public site](/guides/public-edits/): change lists from another device.
