---
title: 'Editing on the Public Site'
description: Edit any list in the browser on a static site, then export the changes as a bundle to apply later.
---

The public site has no server, but you can still edit a list in it. The navbar's **Edit** toggle (top-right) opens the same editor the admin site uses, running entirely in the browser, for whichever deck, collection, or wanted list you're viewing. The toggle is present site-wide but disabled on pages with nothing to edit, such as the index.

Edits are **ephemeral**. Nothing is saved to a server, and nothing is persisted unless you explicitly choose to. The way to keep your work is to export it as a change bundle and apply it with the admin site or the [`import-changes`](/commands/import-changes/) command.

## Edited vs. published

While editing, the navbar grows a second row that makes it clear you are viewing a local copy. It has an **Original / Edited** toggle to switch between your changes and the published version, and a **Discard** button to drop them. Press **Done** (the same navbar toggle) to leave edit mode.

## What the editor can do

The editor is the admin editor with a few differences that follow from having no server.

- **Card search.** Adding cards searches Scryfall directly (preferring the shared session cache), the same as the Trade Planner. Matching is Scryfall's own: the [autocomplete API](https://scryfall.com/docs/api/cards/autocomplete) treats your query as one contiguous string, unlike [the admin editor's term matching](/admin/editors/#step-1-search) over the local card cache (where `in tre` finds "In the Trenches"). Results can therefore differ between the two editors. The search dialog notes this and links to the Scryfall API docs. On a site backed by a [live API](/public-site/hosted/), search goes through the backend's cache with the admin editor's term matching instead, and the note disappears.
- **Keyboard shortcuts.** The editor shares the admin site's [keyboard shortcuts](/admin/editors/#keyboard-shortcuts): **Ctrl+Enter** opens the card search, **Ctrl+B** focuses the bottom action bar, and every step of the add-card dialog is arrow-key navigable. Press **?** (or the **?** button at the end of the action bar) for the full list.
- **Label a card as you add it.** The add-card dialog's [Card Options](/admin/editors/#card-options) row offers the new card's [label override](/list-format/#card-labels), listing what the list type carries (the full vocabulary on a collection, **Proxy** alone on a deck, nothing on a wanted list). The label rides the `add` change, so it travels in the exported bundle and lands on the copy you added. Custom art is not offered here. This editor writes no files, and art lives in a sidecar only the admin site (or the CLI) can write.
- **Edit a card's categories.** **Edit Categories…** in the per-card **⋯** menu, and the action bar's **Categories** dialog for the list's whole vocabulary, work exactly as in [the admin editor](/admin/editors/#card-categories). Unlike custom art, categories _are_ editable here. They travel as change events in the exported bundle and are written when the bundle is imported into the admin editor or [`import-changes`](/commands/import-changes/), rather than being a file the browser would have to write itself.
- **Set a card's language.** **Set Language…** is available in the per-card **⋯** context menu and in the multi-select **Selected** menu, exactly as in [the admin editor](/admin/editors/#card-language): a picker over the 17 Scryfall [card languages](/list-format/#card-language), with **English** clearing the line's token (a bare line always means `en`).
- **Move a card to another list.** The per-card **⋯** menu, the per-list **Selected** menu, and the cross-list **All Selected** navbar menu each offer a single **Move to list…** item that opens a picker listing your other decks, collections, and wanted lists. Moving a card removes it from the list you're editing (it disappears from the edited view) and records the move in your exported change bundle, its [tags](/list-format/#card-tags) included. Moving a printing-less card into a collection (which needs a specific printing) opens the same printing picker the Trade Planner uses. Because the public site has no server, the destination list is only updated when the change bundle is later imported into the admin editor and saved.

## Swap printings

On a deck or collection, the **Swap Printings…** button in the navbar's edit row opens a wizard that re-picks printings for many cards at once using copies you already own in your _other_ lists, and records the result as cross-list moves. The same wizard opens pre-checked on a selection from the per-list **Selected** menu (**Swap Printings…**), and on a single card from its **⋯** menu (**Swap printing…**, offered on a name-only card too, where it _sets_ the printing from a copy you own elsewhere). Wanted lists offer no swap entry points, since they hold no physical cards.

The steps:

1. **Cards.** Tick the cards to swap. (Skipped when the wizard was opened on a single card.) A line that names no printing shows a "no printing set" note and takes part too; it is given whatever printing you pick for it.
2. **Sources.** Choose which lists to draw from. Decks and collections are on by default, wanted lists off but selectable. The list you're editing is never a source.
3. **Mode.** Pick **Manual** (choose per card), **Most expensive**, or **Least expensive**. In every mode you can set an optional finish filter (it also seeds the picker's quick-filter) and where displaced copies go (back to the list each replacement came from, or one chosen deck/collection). When a checked card has no printing, a **Replace the copies taken from other lists** option appears (off by default). The price modes add what to do with cards that have an unpriced candidate: **Skip** them, **Ignore** unpriced options, or **Ask me** (force a pick by hand).
4. **Pick** (Manual mode, or when **Ask me** left cards to decide). Choose a printing per card from the copies your other lists hold.
5. **Review** (price modes only). Current → chosen printing with prices, per-card flags, and a **Change…** button to override any card.
6. **Replacements** (only with the replace option on). One row per source list and printing taken (`1× Lightning Bolt (LEA:161) taken from Binder`), each with **Choose replacement…** to say which printing that list gets back. **No replacement** leaves it a copy short.
7. **Summary.** The moves grouped by list, and the value before → after. Apply from here.

Picking a copy that has no printing in its source list (a wanted line, or a name-only deck line) first confirms it is that entry and then asks which printing it actually is.

Applying records each replacement as a move into the edited list and each displaced copy as a move out, so the result shows up in the edited view and in the **Changes** dialog, and travels in the exported bundle's top-level `moves` array. A copy arriving on a **name-only** line pins that line instead of adding a copy. Nothing is displaced, so no move out accompanies it, and it rides in the bundle as a move carrying `pinsCardId` (plus its `replacement`, when one was chosen). Nothing is written until the bundle is imported into the admin editor and saved.

## Exporting your edits

The **Export…** panel offers two ways to keep your changes:

- **Download change list (JSON)** or **Copy JSON**: a portable change bundle that can later be applied to the real lists with the admin site's [Import Changes](/admin/import/#import-changes) page or the [`import-changes`](/commands/import-changes/) CLI command (both preview the changes and ask for confirmation), or loaded into an editor as pending edits. Applied changes are re-targeted to the current card IDs.
- **Download updated file**: a full deck `.txt` (the same Moxfield decklist dialect the header's [Download → Text](/public-site/browsing/#exporting-a-list) writes), or a collection/wanted `.md`/`.csv`, with the edits already applied.

**Export all edited lists at once.** Because edit mode persists while you navigate, edits to several lists accumulate in one session. When more than the open list has pending changes, the Export panel gains a scope toggle, **This list (N changes)** vs. **All lists (M changes)**, showing exactly how many changes each export covers, and a **Review changes** section listing every pending change grouped by list before you commit to the export. The all-lists scope downloads a single **bundle** (`ritual-all-edits.json`) covering every edited list, importable by the same admin page and CLI command.

**Export from anywhere in edit mode.** The **Export…** button stays available in the navbar's edit row even when you are not on a single list, such as a combined view or a list directory. Off a list it defaults to the **All lists** scope, and the **This list** option is greyed out (there is no single open list to export). On a **combined view**, a third **Current lists (N changes)** scope sits between them, covering just the edited lists that make up the combination (downloaded as `ritual-combined-edits.json`). The per-list extras, **Download updated file** and **Save to this browser**, appear only when a single list is open.

## Loading changes

The **Load Changes…** button (next to Export…) opens a dialog where you can upload or paste a change-list JSON (one exported from this site or from the admin editor) and apply it to the list you're editing. The changes load as pending edits, re-targeted to the current card IDs. Any that can't be applied (the card is not in the list, the action doesn't apply to this kind of list, or it would set a foil/etched finish on a card that pins no printing) are reported with their reason and skipped. This is the same machinery the admin editor uses to [import changes](/admin/import/#import-changes).

## Saving to this browser

The Export panel can also save the current edit session to `localStorage`. This never happens automatically. When you return to a list with a saved session, the editor offers to **Restore** it (applied through the same safe re-target path as import). **Clear saved edits** removes it.
