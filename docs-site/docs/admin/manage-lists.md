---
sidebar_position: 4
---

# Manage Lists

The **Manage Lists** page provides a single place to create, rename, and delete every kind of list the admin site knows about: **decks**, **collections**, and **wanted lists**.

## Accessing Manage Lists

Navigate to the **Manage Lists** page from the admin sidebar, or click the "Manage Lists" card on the Dashboard.

The page is organised by category — switch between **Decks**, **Collections**, and **Wanted Lists** using the tabs at the top. Each tab shows the items in that category and offers the same Create / Rename / Delete actions.

## File names

The file name for each list is derived from the name you enter, with a small set of reserved filesystem characters (`/ \ : * ? " < > |`) stripped. Case and spaces are preserved — for example, "My Collection" becomes `My Collection.md`.

A live preview of the resulting file name is shown below the input on both the Create and Rename forms.

## Decks

A deck is a Markdown file in the configured `decksDir` (defaults to `decks/`) with YAML frontmatter (`name`, `format`, `created`, `tags`).

### Creating a deck

1. Click **+ New Deck** to open the create form.
2. Enter a **Deck Name**.
3. Choose a **Format** (Commander, Standard, Modern, etc.). Defaults to Commander.
4. Click **Create Deck** to write the file.

### Renaming a deck

Click **Rename** next to any deck. Renaming a deck:

- Updates the `name` field in the deck's YAML frontmatter
- Renames the file to match the new name (e.g. `Old Name.md` → `New Name.md`)
- Also renames the changelog file (`*.changes.md`) and the primer file (`*.primer.md`) if either exists

### Deleting a deck

Click **Delete** next to any deck.

:::danger
Deletion is permanent and cannot be undone unless you have git history or a backup.
:::

You must type the **exact deck name** before the Delete button becomes active. Deleting a deck removes:

- The deck file (`<name>.md`)
- The changelog file (`<name>.changes.md`) if it exists
- The primer file (`<name>.primer.md`) if it exists

## Collections

A collection is a Markdown file in the configured `collectionsDir` (defaults to `collections/`). Collection files are simpler than decks — there is no YAML frontmatter, just a top-level `# Title` heading followed by card lines.

### Creating a collection

1. Switch to the **Collections** tab and click **+ New Collection**.
2. Enter a **Collection Name** and click **Create Collection**.

The new file is scaffolded with a single `# <Name>` heading and is ready to be edited from the **Collection Editor**.

### Renaming a collection

Click **Rename** next to any collection. Renaming a collection:

- Updates the first `# <Title>` H1 in the file
- Renames the file (e.g. `Old.md` → `New.md`)
- Also renames the changelog file (`*.changes.md`) if it exists

### Deleting a collection

Click **Delete** next to any collection. As with decks, you must type the exact collection name to confirm. Deletion removes the `<name>.md` file and its `<name>.changes.md` sidecar if present.

## Wanted Lists

A wanted list is a Markdown file in the configured `wantedDir` (defaults to `wanted/`). It uses the same simple format as a collection — a `# Title` heading followed by card lines (without condition fields).

The Create / Rename / Delete flow is identical to **Collections**, including the changelog sidecar handling.

## Git Integration

When git integration is enabled and **Auto-commit changes** is turned on in Settings, each operation creates a commit:

| Action | Decks                        | Collections                        | Wanted Lists                        |
| ------ | ---------------------------- | ---------------------------------- | ----------------------------------- |
| Create | `Create deck: <Name>`        | `Create collection: <Name>`        | `Create wanted list: <Name>`        |
| Rename | `Rename deck: <Old> → <New>` | `Rename collection: <Old> → <New>` | `Rename wanted list: <Old> → <New>` |
| Delete | `Delete deck: <Name>`        | `Delete collection: <Name>`        | `Delete wanted list: <Name>`        |

If **Auto-push after commit** is also enabled, changes are automatically pushed to the remote after each commit.
