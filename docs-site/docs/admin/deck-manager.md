---
sidebar_position: 4
---

# Deck Manager

The Deck Manager provides tools to create, rename, and delete decks directly from the admin site.

## Accessing the Deck Manager

Navigate to the **Deck Manager** page from the admin sidebar, or click the "Deck Manager" card on the Dashboard.

## Creating a Deck

Click the **+ New Deck** button to open the create form.

1. **Deck Name** — Enter the full deck name (e.g. "Atraxa Superfriends"). A slug is automatically generated from the name and shown as a preview below the input.
2. **Format** — Select the deck format (Commander, Standard, Modern, etc.). Defaults to Commander.
3. Click **Create Deck** to write the file to the decks directory.

The slug is derived from the deck name using the same rules as the CLI `new-deck` command: lowercased, with non-alphanumeric characters replaced by hyphens.

## Renaming a Deck

Click the **Rename** button next to any deck in the list.

1. The current deck name is pre-filled in the input.
2. Edit the name. A preview of the new slug appears below the input.
3. Click **Rename** to save.

Renaming a deck:

- Updates the `name` field in the deck's YAML frontmatter
- Renames the file to match the new slug (e.g. `old-name.md` → `new-name.md`)
- Also renames the changelog file (`*.changes.md`) and primer file (`*.primer.md`) if they exist

## Deleting a Deck

Click the **Delete** button next to any deck in the list.

:::danger
Deletion is permanent and cannot be undone unless you have git history or a backup.
:::

A confirmation form is shown. You must type the **exact deck name** (as shown) before the Delete button becomes active. This prevents accidental deletion.

Deleting a deck removes:

- The deck file (`<slug>.md`)
- The changelog file (`<slug>.changes.md`) if it exists
- The primer file (`<slug>.primer.md`) if it exists

## Git Integration

When git integration is enabled and **Auto-commit changes** is turned on in Settings, each operation creates a commit:

- **Create**: `Create deck: <Deck Name>`
- **Rename**: `Rename deck: <Old Name> → <New Name>`
- **Delete**: `Delete deck: <Deck Name>`

If **Auto-push after commit** is also enabled, changes are automatically pushed to the remote after each commit.
