---
title: 'Mobile & Touch'
description: How the public site adapts to phones and touch devices.
---

The public site adapts to phones and touch devices automatically. There is nothing to configure. Two independent signals drive the adaptations:

- **Screen width.** Below tablet width the site switches to its phone layout: the bottom tab bar and the compact toolbar.
- **Pointer type.** On touch-first devices (no hover, coarse pointer), controls that desktop reveals on hover are always visible, tap targets are larger, and dropdown menus open as bottom sheets. This applies at any screen size, so tablets benefit too. The exception is the controls in a card tile's corners; see [Selecting cards by touch](#selecting-cards-by-touch).

## Navigation

On phone-width screens a **bottom tab bar** replaces the header's nav links, with the same six destinations: Decks, Collections, Wanted, [All](/public-site/combined-view/), Trade, and Find. The current section is highlighted, and the quick-switch button (⌕) sits centered in the header for jumping to any list.

While edit mode is on, the tab bar steps aside for the editor's bottom action bar (Add Card, Sections, Changes, Undo). Use quick switch to move between lists mid-edit, or tap **Done** to leave edit mode and get the tabs back.

### Display options

Phones show only the logo and quick switch in the header. The **price currency**, the **Edit** toggle, the **Theme** menu, and, on a site [built with more than one locale](/commands/build-site/#localized-builds), the **interface language** switcher move into a second row behind the **⚙** button at the top right. Tap to open it, tap again to collapse. The row stays as you left it as you navigate. Desktop keeps these controls inline.

**Done** appears in the slot **Edit** occupied, so leaving edit mode works where entering it did. The ⚙ button never leaves the header, so a collapsed row is always one tap away.

## The toolbar on phones

List pages collapse the desktop toolbar into one compact row:

- the **view toggle** (binder and list views only; the overlap and stack views need hover, so touch devices omit them),
- a **Sort** button that opens a _Sort & Group_ bottom sheet with the full controls: grouping (and price brackets), sorting with stacked layers via **+** (each with its own reverse **↑↓** and remove **−** button), the Reverse Sections toggle, card size, and any page-specific extras, and
- the **Filters** button with its active-filter count badge.

The two [category groupings](/public-site/filtering/#grouping-sorting-and-filtering-by-category), the **Category** sort, and the **Categories** filter row live in those same sheets.

On pages that support it, the **Update prices** button sits in the button group above the toolbar (with Combine and View Changes), as on desktop. See [Update Prices](/public-site/prices/#update-prices-per-page).

## Bottom sheets

On touch devices, menus that are dropdowns on desktop (the Filters panel, the Sort & Group controls, the selection actions, and the export format pickers) slide up from the bottom of the screen with finger-sized rows. Dismiss a sheet by tapping the ✕, tapping the dimmed backdrop, or pressing Escape on a connected keyboard.

The card detail modal fills the whole screen on phones, with the card image on top and the details scrolling beneath it.

## Selecting cards by touch

Desktop multi-select uses Ctrl/Cmd-click and hover-revealed checkboxes, which have no touch equivalent, so touch devices have a **selection mode**:

1. Tap **Select** in the toolbar. While it's active, every card shows its checkbox and a tap selects a card instead of opening it.
2. Once something is selected, a **bottom action bar** appears with the selected count, an **Actions** button (copy as text/CSV, add to trade, and the bulk edit actions while editing), and a ✕ to clear the selection.
3. Tap **Select** again to leave selection mode and restore tap-to-open.

Outside selection mode the checkboxes stay hidden, so card art is never covered by controls you didn't ask for.

The **Add to Trade** corner bookmark is also omitted on touch devices. Add a card to the trade by opening it and tapping **+ Add to Trade** in the card modal, or by selecting cards and choosing **Add to Trade** from the Actions sheet.

## Editing on touch

Everything in the [in-browser editor](/public-site/editing/) works by touch. The per-card **+ / − / ⋯** controls that desktop reveals on hover are always visible on card tiles while editing, sized for fingers, and the editor's action bar sits along the bottom edge within thumb reach.
