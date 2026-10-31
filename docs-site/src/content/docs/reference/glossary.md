---
title: 'Glossary'
description: Short definitions of the words these docs use, with links to where each is explained.
sidebar:
  order: 5
---

Words these docs use, in alphabetical order. Each links to the page that explains it.

## Admin site

A website for editing your lists in the browser, run on your own computer with [`ritual admin`](/commands/admin/). It needs a sign-in. See [Admin Site](/admin/).

## Bulk data

The files Scryfall publishes once a day with every card and its prices. Ritual downloads them to fill the [card cache](#card-cache). See [Card Cache](/card-cache/).

## Card cache

Ritual's local copy of Scryfall's card data, images and prices. One folder per user, shared by all your workspaces. See [Card Cache](/card-cache/).

## Card ID (`&N`)

The number at the end of each card line, such as `&12`. It names that line within its list and stays the same while you edit the line. Ritual adds it for you; you never need to type one. See [Card IDs](/list-format/#card-ids-n).

## Card line

One line of a list file that stands for a card, such as `- 1 Sol Ring (C21:263) [foil] &5`. See [Card lines](/list-format/#card-lines).

## Category

A card's role in one list, such as `Ramp` or `Board Wipes`. Archidekt calls these categories too; Moxfield calls them tags. Stored in the list's `.categories.json` file. See [Labels, tags, and categories](/list-format/#labels-tags-and-categories).

## Changelog

The `<name>.changes.md` file beside each list, recording every change to it. [`ritual history`](/commands/history/) and the sites show it. Not to be confused with Ritual's own [Changelog](/reference/changelog/) of releases. See [The `.changes.md` changelog](/list-format/#the-changesmd-changelog).

## Collection

A list of cards you own, one line per copy. See [The three list types](/list-format/#the-three-list-types).

## Deck

A list of cards with quantities, split into sections such as Commander, Main and Sideboard. See [The three list types](/list-format/#the-three-list-types).

## Finish

Whether a printing is nonfoil, foil or etched. Written as `[foil]` or `[etched]` on a card line; nonfoil is the default and is not written.

## Label

What you plan to do with one copy of a card: `sale`, `trade`, `keep` or `proxy`. Labels change how Ritual prices and filters cards. See [Card labels](/list-format/#card-labels).

## List

A deck, a collection or a wanted list: one markdown file in your workspace. See [List Files](/list-format/).

## Managed files

Files Ritual writes and keeps up to date for you: the site's deploy workflow, the Ritual entries in `.gitignore`, and installed agent skills. Do not edit them by hand. See [Files Ritual manages](/workspace/#files-ritual-manages).

## MCP

The Model Context Protocol, a standard way for AI assistants to use tools. [`ritual mcp`](/commands/mcp/) lets an assistant such as Claude read and change your lists. See [Use Ritual with AI Agents](/guides/ai-agents/).

## Migration

A one-time change a newer Ritual makes to a workspace, such as renaming a setting. Run with [`ritual migrate`](/commands/migrate/). See [Upgrading](/reference/upgrading/#migrations).

## Printing

One specific release of a card, named by its set code and collector number: `LEA:161` is the Alpha printing of Lightning Bolt. A card line with a printing is _pinned_ to it; one without stands for any printing.

## Public site

The website [`ritual build-site`](/commands/build-site/) makes from your lists, to host anywhere. See [Public Site](/public-site/).

## Section

A heading inside a deck, such as `## Main` or `## Sideboard`. See [Title and sections](/list-format/#title-and-sections).

## `.sha256` file

A small file beside each list holding a hash of the list as Ritual last wrote it. It lets Ritual tell its own edits from yours. Commit it with the list. See [The `.sha256` files](/list-format/#the-sha256-files).

## Sidecar

Any file Ritual keeps beside a list: its `.changes.md`, `.sha256`, `.categories.json` and `.art.json` files. They move with the list when you rename or delete it.

## Site build

Running [`ritual build-site`](/commands/build-site/) to turn your lists into the public site's files, in `dist/`.

## Skills

Instructions an AI coding agent (such as Claude Code) can load to learn how to use the `ritual` command. Installed with [`ritual skills install`](/commands/skills/).

## Tag

A plain-text note about one physical copy of a card, such as `#Signed`, which stays with the copy when it moves to another list. See [Card tags](/list-format/#card-tags).

## Wanted list

A list of cards you want to get, one line per copy. See [The three list types](/list-format/#the-three-list-types).

## Workspace

The folder holding your lists, settings and the files Ritual keeps beside them, usually a git repository. See [Workspace](/workspace/).
