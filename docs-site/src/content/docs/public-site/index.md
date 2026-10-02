---
title: 'Public Site'
description: What the generated website is, how to build and serve it, and where each of its features is documented.
---

The public site is a website of your decks, collections, and wanted lists. [`ritual build-site`](/commands/build-site/) generates it as static files, so you can host it anywhere that serves plain files. Visitors can browse and filter your lists, see prices, plan trades, and edit a list in the browser and hand you the changes as a file.

## Building and Serving

```bash
ritual build-site      # write the site to dist/
ritual serve           # serve the built site at http://localhost:3000
ritual serve --build   # both in one step
```

Every page's footer names the Ritual version that built the site and links to its source code, carries the notice Wizards of the Coast's Fan Content Policy asks of a site showing Magic cards, and credits Scryfall for the card data and images. See [License and Attribution](/attribution/).

[`build-site`](/commands/build-site/) documents the build options: which lists to publish, themes, price stores, languages, and how the card cache is refreshed. [`serve`](/commands/serve/) previews the result and can also run the site against a live backend. [`init-site`](/commands/init-site/) can set up a GitHub Actions workflow that builds and publishes the site for you.

## What's on the Site

- [Browsing Lists](/public-site/browsing/) — view modes, the card detail modal, quick switch, multi-select, and what each kind of list page shows.
- [Filtering, Sorting & Grouping](/public-site/filtering/) — the toolbar's filters and how to share a configured view by link.
- [Prices](/public-site/prices/) — currencies, price stores, and per-page price updates.
- [Sell Mode](/public-site/sell/) — Card Kingdom buylist quotes beside each card, and a cart export.
- [Trade Planner](/public-site/trade/) — plan a trade from the cards on the site.
- [Editing](/public-site/editing/) — edit any list in the browser and export the changes.
- [Combined List View](/public-site/combined-view/) — browse several lists as one.
- [Find Cards](/public-site/find/) and [Find in Lists](/public-site/find-printings/) — search every list for a set of names, or for other copies of one card.
- [Mobile & Touch](/public-site/mobile/) — how the site adapts to phones.
- [Hosting with a Live Backend](/public-site/hosted/) — serve the same site with live list data and cache-backed search.
