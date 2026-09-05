---
title: 'Manage Lists'
description: Create, rename, delete, and publish decks, collections, and wanted lists.
---

The **Manage Lists** page is one place to create, rename, and delete every kind of list: **decks**, **collections**, and **wanted lists**. It also decides which lists the public site publishes.

## Accessing Manage Lists

Open the **Manage Lists** page from the admin sidebar, or click the "Manage Lists" card on the Dashboard.

The page is organised by category. Switch between **Decks**, **Collections**, and **Wanted Lists** using the tabs at the top. Each tab shows the items in that category and offers the same Create / Edit / Rename / Delete actions.

## Editing a list

Each list has an **Edit** button (between its visibility toggle and **Rename**) that jumps straight to the **Edit Lists** page, opening the matching tab with that list already selected, so you can start changing cards without picking it from the editor's dropdown. It is a link to that list's [URL](/admin/#page-urls), so ⌘/Ctrl-clicking it opens the editor in a new tab.

## File names

The file name for each list is derived from the name you enter, with a small set of reserved filesystem characters (`/ \ : * ? " < > |`) stripped. Case and spaces are preserved. "My Collection" becomes `My Collection.md`.

A live preview of the resulting file name is shown below the input on both the Create and Rename forms.

## Decks

A deck is a Markdown file in the configured `decksDir` (defaults to `decks/`) with YAML front matter (`name`, `format`, `created`, `description`, `tags`, `labels`, `sourceId`, `sourceUrl`). `labels` holds the deck's [default card labels](/commands/edit/#card-labels), `proxy` alone on a deck.

### Creating a deck

1. Click **+ New Deck** to open the create form.
2. Enter a **Deck Name**.
3. Choose a **Format** (Commander, Standard, Modern, and so on). Defaults to Commander.
4. Click **Create Deck** to write the file.

### Renaming a deck

Click **Rename** next to any deck. Renaming a deck:

- Updates the `name` field in the deck's YAML front matter
- Renames the file to match the new name (`Old Name.md` → `New Name.md`)
- Also renames every sidecar the deck has: the changelog (`*.changes.md`), the primer (`*.primer.md`), the [custom-art](/custom-art/) sidecar (`*.art.json`), and the [categories](/list-format/#categories-namecategoriesjson) sidecar (`*.categories.json`) with its still-valid `*.categories.json.sha256`. A rename never rewrites the sidecar, so its hash travels with it

### Deleting a deck

Click **Delete** next to any deck.

:::danger
Deletion is permanent and cannot be undone unless you have git history or a backup.
:::

You must type the **exact deck name** before the Delete button becomes active. Deleting a deck removes:

- The deck file (`<name>.md`)
- The content-hash sidecar (`<name>.md.sha256`) if it exists
- The changelog file (`<name>.changes.md`) if it exists
- The primer file (`<name>.primer.md`) if it exists
- The [custom-art](/custom-art/) sidecar (`<name>.art.json`) if it exists
- The [categories](/list-format/#categories-namecategoriesjson) sidecar (`<name>.categories.json`) and its `<name>.categories.json.sha256` if they exist

## Collections

A collection is a Markdown file in the configured `collectionsDir` (defaults to `collections/`). Collection files are simpler than decks: an optional YAML front-matter block holding the list's [default card labels](/commands/edit/#collection-front-matter), then a top-level `# Title` heading followed by card lines, optionally organized under `## Section Name` (H2) headers (see the [collection format](/commands/edit/#sections)).

### Creating a collection

1. Switch to the **Collections** tab and click **+ New Collection**.
2. Enter a **Collection Name** and click **Create Collection**.

The new file is scaffolded with a single `# <Name>` heading and is ready to be edited from the **Collections** tab on the **Edit Lists** page.

### Renaming a collection

Click **Rename** next to any collection. Renaming a collection:

- Updates the first `# <Title>` H1 in the file
- Renames the file (`Old.md` → `New.md`)
- Also renames every sidecar the collection has: the changelog (`*.changes.md`), the [custom-art](/custom-art/) sidecar (`*.art.json`), and the [categories](/list-format/#categories-namecategoriesjson) sidecar (`*.categories.json`) with its still-valid `*.categories.json.sha256`

### Deleting a collection

Click **Delete** next to any collection. As with decks, you must type the exact collection name to confirm. Deletion removes the `<name>.md` file and its `<name>.md.sha256`, `<name>.changes.md`, `<name>.art.json`, `<name>.categories.json` and `<name>.categories.json.sha256` sidecars if present.

## Wanted Lists

A wanted list is a Markdown file in the configured `wantedDir` (defaults to `wanted/`). It uses the same simple format as a collection: a `# Title` heading followed by card lines (without condition fields), optionally organized under `## Section Name` (H2) headers (see the [wanted format](/commands/edit/#sections)).

The Create / Rename / Delete flow is identical to **Collections**, including the changelog and custom-art sidecar handling.

## Publishing visibility

Each list in every tab has a **Public / Hidden** toggle next to its Rename and Delete buttons. It controls whether [`build-site`](/commands/build-site/) publishes that list to the public site:

- **Public** (toggle on): the list is published, subject to the category's publish list.
- **Hidden** (toggle off): the list is excluded from the public site.

The toggle edits only the category's exclude list in your [site configuration](/configuration/#choosing-which-lists-to-publish) (`site.excludeDecks`, `site.excludeCollections`, or `site.excludeWantedLists`). Hiding a list adds its display name there and showing it removes the name. It never touches the `include*` publish lists, so the two settings compose, and exclusion always wins. With the default `include*` of `["*"]` (publish everything), the toggle is simply "published or not".

Changes save immediately. If git **Auto-commit** is enabled in Settings, the configuration change is committed like any other settings edit.

## Git Integration

When git integration is enabled and **Auto-commit changes** is turned on in Settings, each operation creates a commit:

| Action | Decks                        | Collections                        | Wanted Lists                        |
| ------ | ---------------------------- | ---------------------------------- | ----------------------------------- |
| Create | `Create deck: <Name>`        | `Create collection: <Name>`        | `Create wanted list: <Name>`        |
| Rename | `Rename deck: <Old> → <New>` | `Rename collection: <Old> → <New>` | `Rename wanted list: <Old> → <New>` |
| Delete | `Delete deck: <Name>`        | `Delete collection: <Name>`        | `Delete wanted list: <Name>`        |

If **Auto-push after commit** is also enabled, changes are automatically pushed to the remote after each commit.
