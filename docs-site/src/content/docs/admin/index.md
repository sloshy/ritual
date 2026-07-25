---
title: 'Admin Site'
description: Documentation for the Ritual admin interface.
---

Documentation for the Ritual admin interface:

- [Editors](/admin/editors/) — edit decks, collections, and wanted lists in the browser
- [Move Cards](/admin/move-cards/) — move cards between lists
- [Manage Lists](/admin/manage-lists/) — create, rename, and delete lists
- [Change History](/admin/history/) — browse the history of changes across all lists
- [Sync Decks](/admin/sync-decks/) — pull or push deck changes with Archidekt
- [Admin API](/admin/api/) — HTTP API reference

## Page URLs

Every page has its own address, using the same `#/…` hash routing as the public site. Reloads, bookmarks, and pasted links land on the page they name, and the browser's back and forward buttons move between the pages you visited.

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
| Sync Decks      | `#/sync`                                      |
| Archidekt Login | `#/archidekt`                                 |
| Audit Log       | `#/audit`                                     |
| Settings        | `#/settings`                                  |

The Edit Lists URL also names the open tab (`deck`, `collection`, or `wanted`) and the list being edited, so `#/edit/collection/Red%20Binder` opens that collection directly — this is what **Edit** on the Manage Lists page links to. Choosing a tab or a list rewrites the current URL instead of adding a history entry, so **Back** leaves the editor rather than retracing every list you opened in it.

Sidebar items, dashboard cards, and the Manage Lists **Edit** buttons are ordinary links: middle-click or ⌘/Ctrl-click opens one in a new tab. Leaving an editor that has unsaved changes still asks for confirmation first, including when you leave via the browser's back or forward button — declining puts the address bar back where it was.

An unrecognized URL falls back to the dashboard and corrects the address bar.
