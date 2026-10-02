---
title: 'License and Attribution'
description: Ritual's license, the Fan Content Policy notice, and where its card data and prices come from.
---

## License

Ritual is free software, licensed under the [GNU Affero General Public License, version 3](https://github.com/sloshy/ritual/blob/main/LICENSE) (AGPL-3.0-only). Copyright © 2026 Ryan Peters. [`ritual license`](/commands/license/) prints the license, and [`ritual dep-license`](/commands/dep-license/) lists the licenses of the third-party packages compiled into the binary.

The repository's [`NOTICE`](https://github.com/sloshy/ritual/blob/main/NOTICE) file holds the same statements as this page.

## Source Code

Everything Ritual serves over a network offers its source, as section 13 of the AGPL asks: the footer of every site [`build-site`](/commands/build-site/) produces (and of a site [`serve --api`](/commands/serve/) hosts), the foot of the [admin site](/admin/)'s navigation, and the [MCP server](/commands/mcp/)'s instructions. Each names the Ritual version and its license, and links to the source of exactly that version: the release tag for a release build, or the commit for a development build.

A modified build should point those links at its own source; see [Development](/development/#building) for `RITUAL_SOURCE_URL`.

## Wizards of the Coast

Ritual is unofficial Fan Content permitted under the [Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy). Not approved or endorsed by Wizards of the Coast. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.

Magic: The Gathering, card names, card text, mana symbols, and card images are property of Wizards of the Coast LLC, a subsidiary of Hasbro, Inc.

Every site [`build-site`](/commands/build-site/) produces shows this notice in its footer, along with the Scryfall credit below, so a deck site you publish carries it without any work on your part.

## Data Sources

| What                                                 | Where it comes from                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Card data, images, and symbols                       | [Scryfall](https://scryfall.com), under its [API guidelines](https://scryfall.com/docs/api) |
| TCGplayer, Cardmarket, and Cardhoarder (MTGO) prices | Scryfall's card data                                                                        |
| Card Kingdom prices and buylist quotes               | Card Kingdom's public price list                                                            |
| Deck imports                                         | Archidekt, Moxfield, and MTGGoldfish, when you import from them                             |
| Deck and collection sync                             | Archidekt, with your own account                                                            |

Ritual downloads Scryfall's bulk data files into a local [card cache](/commands/cache/) rather than looking cards up one at a time, so most commands never touch the network. None of these sites is affiliated with Ritual.
