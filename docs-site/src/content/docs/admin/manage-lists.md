---
title: 'Manage Lists'
description: Create, rename, delete, and publish decks, collections, and wanted lists.
---

The **Manage Lists** page creates, renames, and deletes **decks**, **collections**, and **wanted lists**. It also decides which lists the public site publishes.

## Accessing Manage Lists

Open **Manage Lists** from the admin sidebar, or click the "Manage Lists" card on the Dashboard.

Switch between **Decks**, **Collections**, and **Wanted Lists** with the tabs at the top. Each tab lists that type and offers the same Create / Edit / Rename / Delete actions.

## Editing a list

Each list has an **Edit** button (between its visibility toggle and **Rename**). It opens the **Edit Lists** page on the matching tab with that list already selected. The button is a link to the list's [URL](/admin/#page-urls), so ⌘/Ctrl-clicking it opens the editor in a new tab.

## File names

The file name comes from the name you enter, with reserved filesystem characters (`/ \ : * ? " < > |`) stripped. Case and spaces are kept: "My Collection" becomes `My Collection.md`.

The Create and Rename forms show a live preview of the resulting file name below the input.

## Decks

A deck is a Markdown file in the configured `decksDir` (default `decks/`) with YAML front matter (`format`, `description`, `tags`, `labels`, `image`, `sourceId`, `sourceUrl`, plus sync bookkeeping). The deck's name is its `# Title` heading. `labels` holds the deck's [default card labels](/list-format/#card-labels); a deck can carry `proxy` only.

### Creating a deck

1. Click **+ New Deck**.
2. Enter a **Deck Name**.
3. Choose a **Format** (Commander, Standard, Modern, and so on). Defaults to Commander.
4. Click **Create Deck**.

### Renaming a deck

Click **Rename** next to a deck. Renaming:

- Updates the deck's `# Title` heading
- Renames the file (`Old Name.md` → `New Name.md`). The deck's `.md.sha256` is rewritten only if it matched the file before the rename; otherwise it is dropped
- Renames every companion file the deck has: the changelog (`*.changes.md`), the primer (`*.primer.md`), the [custom-art](/custom-art/) file (`*.art.json`), and the [categories](/list-format/#categories-namecategoriesjson) file (`*.categories.json`) with its `*.categories.json.sha256`. Companion files are moved, never rewritten, so the categories hash stays valid

### Deleting a deck

Click **Delete** next to a deck. You must type the **exact deck name** before the Delete button becomes active.

:::danger
Deletion is permanent and cannot be undone unless you have git history or a backup.
:::

Deleting removes, where present:

- The deck file (`<name>.md`)
- The content-hash file (`<name>.md.sha256`)
- The changelog (`<name>.changes.md`)
- The primer (`<name>.primer.md`)
- The [custom-art](/custom-art/) file (`<name>.art.json`)
- The [categories](/list-format/#categories-namecategoriesjson) file (`<name>.categories.json`) and its `<name>.categories.json.sha256`

## Collections

A collection is a Markdown file in the configured `collectionsDir` (default `collections/`). It is simpler than a deck: an optional front-matter block holding the list's [default card labels](/list-format/#default-labels-and-descriptions), `description:`, and `image:`, then a `# Title` heading followed by card lines, optionally grouped under `## Section Name` headers (see the [collection format](/list-format/#title-and-sections)).

### Creating a collection

1. Switch to the **Collections** tab and click **+ New Collection**.
2. Enter a **Collection Name** and click **Create Collection**.

The new file holds a single `# <Name>` heading and is ready to edit from the **Collections** tab of the **Edit Lists** page.

### Renaming a collection

Click **Rename** next to a collection. Renaming:

- Updates the first `# <Title>` heading in the file
- Renames the file (`Old.md` → `New.md`)
- Renames every companion file: the changelog (`*.changes.md`), the [custom-art](/custom-art/) file (`*.art.json`), and the [categories](/list-format/#categories-namecategoriesjson) file (`*.categories.json`) with its still-valid `*.categories.json.sha256`

### Deleting a collection

Click **Delete** next to a collection and type the exact collection name to confirm. Deletion removes `<name>.md` and, where present, `<name>.md.sha256`, `<name>.changes.md`, `<name>.art.json`, `<name>.categories.json`, and `<name>.categories.json.sha256`.

## Wanted Lists

A wanted list is a Markdown file in the configured `wantedDir` (default `wanted/`). It uses the same format as a collection: a `# Title` heading followed by card lines (without condition fields), optionally grouped under `## Section Name` headers (see the [wanted format](/list-format/#title-and-sections)).

Create, Rename, and Delete work exactly as for **Collections**, including the changelog, custom-art, and categories files.

## Publishing visibility

Each list has a **Public / Hidden** toggle next to its Rename and Delete buttons. It controls whether [`build-site`](/commands/build-site/) publishes that list:

- **Public** (on): the list is published, subject to the type's publish list.
- **Hidden** (off): the list is excluded from the public site.

The toggle edits only the type's exclude list in your [site configuration](/configuration/#choosing-which-lists-to-publish): `site.excludeDecks`, `site.excludeCollections`, or `site.excludeWantedLists`. Hiding adds the list's display name there; showing removes it. The `include*` publish lists are never touched, so the two settings combine and exclusion always wins. With the default `include*` of `["*"]` (publish everything), the toggle is simply "published or not".

Changes save immediately. If git **Auto-commit** is enabled in Settings, the configuration change is committed like any other settings edit.

## Git Integration

When git integration is enabled and **Auto-commit changes** is on in Settings, each operation creates a commit:

| Action | Decks                        | Collections                        | Wanted Lists                        |
| ------ | ---------------------------- | ---------------------------------- | ----------------------------------- |
| Create | `Create deck: <Name>`        | `Create collection: <Name>`        | `Create wanted list: <Name>`        |
| Rename | `Rename deck: <Old> → <New>` | `Rename collection: <Old> → <New>` | `Rename wanted list: <Old> → <New>` |
| Delete | `Delete deck: <Name>`        | `Delete collection: <Name>`        | `Delete wanted list: <Name>`        |

If **Auto-push after commit** is also enabled, each commit is pushed to the remote.
