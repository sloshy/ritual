---
sidebar_position: 2
---

# Collection Editor

The Collection Editor provides a visual interface for editing collection contents through the admin site, similar to the [Deck Editor](./deck-editor.md).

## Accessing the Editor

Navigate to the **Collection Editor** page from the admin sidebar, or click the 📦 **Collection Editor** card on the Dashboard.

## Selecting a Collection

Choose a collection from the dropdown at the top of the page. Collections correspond to `.md` files in the `collections/` directory.

## Editing Cards

### Quantity Controls

Each card displays edit controls:

- **+** — Add one copy of the card
- **−** — Remove one copy (removes the card entirely if quantity reaches 0)

In binder and overlap views, these appear as transparent overlay buttons on hover. In list view, they appear as inline buttons.

### Context Menu

Right-clicking a card opens a context menu with:

- **Set as Foil** — Mark the card as foil (greyed out if the printing doesn't support foil)

:::note
Unlike the Deck Editor, there is no "Set as Commander" option — collections don't have sections.
:::

### Adding Cards

Click the **+ Add Card** button in the collection header to open the card search modal.

#### Step 1: Search

- Type at least 2 characters to search (debounced to 1 request per second)
- Results are keyboard navigable (↑/↓ arrows, Enter to select)
- Hovering or navigating to a card shows a preview image of the cheapest printing

#### Step 2: Select Printing

Choose a specific printing from the grid showing set, collector number, and price.

:::warning
A specific printing **must** be selected when adding cards to a collection. The "No specific printing" shortcut available in the Deck Editor is not available here.
:::

#### Step 3: Finish & Condition

- Select a finish (nonfoil, foil, etched) if the printing has multiple options
- Select a condition (NM, LP, MP, HP, DMG) — defaults to NM
- Click "Add Card" to confirm

Both finish and condition are **required** for collection entries.

## Change Tracking

All edits are tracked as in-memory change events until explicitly saved.

- **Changes** button shows the count of pending changes and opens a dialog listing them
- Additive changes (add card, set finish) are shown in green
- Destructive changes (remove card) are shown in red
- Opposite changes cancel out automatically (e.g., adding then removing the same card)
- Card names in the changes dialog are clickable links that open the card detail modal
- Hovering a card name shows a preview image of the card

## Saving and Discarding

- **Save Changes** — Writes the updated collection file and appends to the changelog. Enabled only when there are unsaved changes.
- **Discard Changes** — Shows a confirmation dialog listing all changes that would be lost. Enabled only when there are unsaved changes.

## Key Differences from Deck Editor

| Feature              | Deck Editor      | Collection Editor         |
| -------------------- | ---------------- | ------------------------- |
| Set as Commander     | ✅ Available     | ❌ Not available          |
| No specific printing | ✅ Allowed       | ❌ Must select a printing |
| Printing required    | Optional         | Required                  |
| Finish & condition   | Optional         | Required                  |
| Sections             | ✅ Deck sections | ❌ Flat list              |

## API Endpoints

The following endpoints support the Collection Editor. All endpoints require authentication.

See the full [Admin API Endpoints](./api.md) reference for shared endpoints (autocomplete, card printings, card price).

### List Collections

```
GET /api/collections
```

Returns the list of available collections.

**Response:**

```json
{
  "success": true,
  "collections": ["my-collection", "trade-binder"]
}
```

### Load Collection

```
GET /api/collection/:slug
```

Load a collection with full card data and printings.

**Response:**

```json
{
  "success": true,
  "collection": { "name": "...", "cards": [] },
  "cards": { "Sol Ring": {} },
  "printings": { "Sol Ring": [] },
  "symbolMap": { "{W}": "https://..." },
  "slug": "my-collection"
}
```

### Save Collection

```
POST /api/collection/:slug/save
```

Save collection changes. Writes the updated collection file and creates a changelog entry.

**Request Body:**

```json
{
  "changes": [{ "id": "...", "timestamp": 123, "action": "add", "cardName": "Sol Ring" }],
  "collection": { "name": "...", "cards": [] }
}
```

**Response:**

```json
{
  "success": true,
  "message": "Saved 3 changes to My Collection"
}
```
