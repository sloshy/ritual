---
title: 'Admin Site'
description: A browser interface for editing lists, moving cards, importing, syncing, and building the public site.
---

The admin site is a browser interface for your workspace. Start it with [`ritual admin`](/commands/admin/) and sign in. From there you can do most of what the CLI does: edit lists, move cards between them, import decks and CSVs, sync with Archidekt, build the public site, and change settings.

- [Editors](/admin/editors/) — edit decks, collections, and wanted lists in the browser
- [Move Cards](/admin/move-cards/) — move cards between lists
- [Manage Lists](/admin/manage-lists/) — create, rename, delete, and publish lists
- [Importing](/admin/import/) — import a deck, a CSV, or a change bundle from the public site
- [Change History](/admin/history/) — browse and edit the history of changes across all lists
- [Sync Decks](/admin/sync-decks/) — pull or push deck changes with Archidekt
- [Sync Collection](/admin/sync-collection/) — pull or push collection changes with Archidekt
- [Build, Cache & Settings](/admin/dashboard/) — build the site, refresh the card cache, sign in to Archidekt, change settings, read the audit log
- [Admin API](/admin/api/) — the HTTP API behind every page

Setting up the server itself (the account, security options, and recovery) is covered on the [`admin` command page](/commands/admin/).

## Page URLs

Every page has its own `#/…` address, the same hash routing the public site uses. Reloads, bookmarks, and pasted links open the page they name. The browser's back and forward buttons move between the pages you visited.

| Page            | URL                                           |
| --------------- | --------------------------------------------- |
| Dashboard       | `#/`                                          |
| Edit Lists      | `#/edit`, `#/edit/deck`, `#/edit/deck/<list>` |
| Move Cards      | `#/move`                                      |
| Manage Lists    | `#/lists`                                     |
| Change History  | `#/history`                                   |
| Import Deck     | `#/import/deck`                               |
| Import CSV      | `#/import/csv`                                |
| Import Changes  | `#/import/changes`                            |
| Build Site      | `#/build`                                     |
| Refresh Cache   | `#/cache`                                     |
| Sync Decks      | `#/sync/decks`                                |
| Sync Collection | `#/sync/collection`                           |
| Archidekt Login | `#/archidekt`                                 |
| Audit Log       | `#/audit`                                     |
| Settings        | `#/settings`                                  |

The Edit Lists URL also names the open tab (`deck`, `collection`, or `wanted`) and the list being edited. `#/edit/collection/Red%20Binder` opens that collection directly, and this is what **Edit** on the Manage Lists page links to. Choosing a tab or a list rewrites the current URL instead of adding a history entry, so **Back** leaves the editor rather than retracing every list you opened in it.

Sidebar items, dashboard cards, and the Manage Lists **Edit** buttons are ordinary links: middle-click or ⌘/Ctrl-click opens one in a new tab. Leaving an editor with unsaved changes asks for confirmation first, including via the browser's back or forward button. Declining puts the address bar back where it was.

An unrecognized URL falls back to the dashboard and corrects the address bar.
