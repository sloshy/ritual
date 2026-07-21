---
title: 'Mobile & Touch'
---

The public site adapts to phones and touch devices automatically — there is nothing to configure. Two independent signals drive the adaptations:

- **Screen width** — below tablet width the site switches to its phone layout (the bottom tab bar and the compact toolbar).
- **Pointer type** — on touch-first devices (no hover / coarse pointer), controls that desktop reveals on hover are always visible, tap targets are enlarged, and dropdown menus open as bottom sheets. A touch-capable device gets these regardless of its screen size, so tablets benefit too. The exception is the controls in a card tile's corners — see [Selecting cards by touch](#selecting-cards-by-touch).

## Navigation

On phone-width screens the header's nav links are replaced by a **bottom tab bar** carrying the same six destinations: Decks, Collections, Wanted, [All](/public-site/combined-view/), Trade, and Find. The current section is highlighted, and the quick-switch button (⌕) sits centered in the header for jumping straight to any list.

While edit mode is on, the tab bar steps aside so the editor's bottom action bar (Add Card, Sections, Changes, Undo) can use that edge — use quick switch to move between lists mid-edit, or tap **Done** to leave edit mode and get the tabs back.

### Display options

To keep the header uncrowded, phones show only the logo and quick switch there. The **price currency**, the **Edit** toggle, and the **Theme** menu move into a second row revealed by the **⚙** button at the top right — tap to open it, tap again to collapse. The row stays as you left it as you navigate, and the desktop layout keeps all three inline as before.

**Done** appears in the same slot **Edit** occupied, so leaving edit mode works exactly where entering it did. The ⚙ button never leaves the header, so a collapsed row is always one tap from coming back.

## The toolbar on phones

List pages collapse the full desktop toolbar into a single compact row:

- the **view toggle** (binder and list views — the overlap and stack views are omitted on touch devices, since their fan-out interaction requires a hover),
- a **Sort** button that opens a _Sort & Group_ bottom sheet holding the full controls: grouping (and price brackets), sorting — including stacking multiple sort layers with the **+** button, each with its own reverse (**↑↓**) and remove (**−**) button — the Reverse Sections toggle, card size, and any page-specific extras, and
- the **Filters** button with its active-filter count badge.

On pages that support it, the **Update prices** button lives in the button group above the toolbar (alongside actions like Combine and View Changes), the same as on desktop — see [Update Prices](/commands/build-site/#update-prices-per-page).

## Bottom sheets

On touch devices, menus that would be anchored dropdowns on desktop — the Filters panel, the Sort & Group controls, the selection actions, and the export format pickers — slide up from the bottom of the screen instead, with larger rows sized for fingers. Dismiss a sheet by tapping the ✕, tapping the dimmed backdrop, or pressing Escape on a connected keyboard.

The card detail modal similarly expands to fill the whole screen on phones, with the card image on top and the details scrolling beneath it.

## Selecting cards by touch

Desktop multi-select relies on Ctrl/Cmd-click and hover-revealed checkboxes, which have no touch equivalent — so touch devices get a **selection mode** instead:

1. Tap **Select** in the toolbar. While it's active, every card shows its checkbox and a plain tap selects a card instead of opening it.
2. As soon as something is selected, a **bottom action bar** appears with the selected count, an **Actions** button (copy as text/CSV, add to trade, and the bulk edit actions while editing), and a ✕ to clear the selection.
3. Tap **Select** again to leave selection mode and restore tap-to-open.

Outside selection mode the checkboxes stay hidden, so card art is never overlaid with controls you didn't ask for — the **Select** toggle is what brings them out.

The **Add to Trade** corner bookmark is likewise omitted on touch devices for the same reason. Add a card to the trade board by opening it and tapping **+ Add to Trade** in the card modal, or by selecting cards and choosing **Add to Trade** from the Actions sheet.

## Editing on touch

Everything in the [in-browser editor](/commands/edit/) works by touch: the per-card **+ / − / ⋯** controls that desktop reveals on hover are always visible on card tiles while editing, sized for fingers, and the editor's action bar sits along the bottom edge within thumb reach.
