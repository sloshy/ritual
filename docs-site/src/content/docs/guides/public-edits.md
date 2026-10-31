---
title: 'Take Edits from Your Public Site'
description: 'Edit a list on your static public site, export the changes as a file, and apply them to your workspace with import-changes, the admin site, or the MCP server.'
sidebar:
  order: 5
---

Your public site is static: it has no server and cannot write to your files. You can still edit lists on it. The editor runs in the browser, and when you are done you download your edits as a **change bundle**, a small JSON file. Back at your workspace, you apply the bundle and Ritual writes the list files and their changelogs.

This is useful when:

- you are away from your computer and want to note changes from your phone,
- a friend or playgroup member suggests changes to a deck and sends you the file,
- you plan a trade on the site and want to record the cards moving between lists.

This guide follows one bundle from the site to your files. It assumes you already have a [public site](/public-site/), local or published; see [Publish your deck site](/guides/publish-site/) if you don't.

## 1. Edit a List on the Site

Open a deck, collection, or wanted list and press **Edit** in the top-right of the navbar. A second row appears under the navbar to show you are working on a local copy.

From there you can:

- add cards with the search dialog (**Ctrl+Enter**),
- change quantities, printings, finishes, languages, labels, and categories,
- remove cards,
- move cards to another of your lists with **Move to list…**,
- re-pick printings for many cards with **Swap Printings…** (decks and collections).

The **Original / Edited** toggle switches between the published list and your copy. **Discard** drops your edits. **Done** leaves edit mode.

The full feature list, and how this editor differs from the admin one, is on [Editing on the Public Site](/public-site/editing/).

### Nothing is saved yet

Edits live only in the browser tab. Closing the tab loses them unless you export them or save them to the browser (step 2). Edit mode stays on while you move between pages, so you can edit several lists in one session and export them together.

## 2. Export the Changes

Press **Export…** in the edit row. The panel offers:

- **Download change list (JSON)** or **Copy JSON**: the change bundle. This is the file you apply later.
- **Download updated deck (.txt)**, **Download updated collection (.md)**, **Download updated wanted list (.md)**, or **Download CSV** for a collection: the whole list with your edits applied. Use this to take the list elsewhere; it does not go through Ritual's change history.
- **Save edits to this browser**: keeps the session in this browser's storage, so you can come back and finish later. The editor offers to **Restore** it the next time you open that list.

When you edited more than one list, choose the scope first:

| Scope                                  | Downloads                    |
| -------------------------------------- | ---------------------------- |
| **This list**                          | `<list name>-edits.json`     |
| **All lists**                          | `ritual-all-edits.json`      |
| **Current lists** (combined view only) | `ritual-combined-edits.json` |

Pick **All lists** when you moved cards between lists, so both ends of each move travel together. The **Review changes** section in the panel lists every pending change, grouped by list, before you download.

If a visitor is sending you their edits, ask them to export with **Download change list (JSON)** and send you the file.

## 3. What the Bundle Contains

A bundle is a `ritual-change-bundle` JSON, currently version 3. It records **what you did**, not the resulting list:

- `lists`: one entry per edited list (its kind, slug and name), each with its ordered changes: adds, removals, quantity, printing, finish, label and category changes, and so on.
- `moves`: every card moved between two lists, one entry per copy, with its printing, tags, note, and labels.

Because a bundle stores changes rather than a finished file, it can be applied even if the list changed in your workspace after the site was built. Each change is matched to the list as it is now. Read the bundle before applying one you got from someone else; it is plain JSON.

The field-by-field format is in [`import-changes`: Format](/commands/import-changes/#format).

## 4. Apply the Bundle

You have three ways to apply it. They run the same engine and give the same result.

### From the command line

```bash
ritual import-changes ritual-all-edits.json
```

[`import-changes`](/commands/import-changes/) prints every change grouped by list, then the moves between lists, and asks before writing:

```text
🎴 Winota Stax (deck 'winota-stax') — 2 changes
  • Add Counterspell
  • Remove Lightning Bolt (LEA:161) &2

🔀 Moves between lists — 1 move
  • Move Sol Ring (C19:221) &7 to Deck 'Winota Stax' (from Collection 'Main Binder')

? Apply 3 changes to 2 lists? › (y/N)
```

Answer `y` to apply. In a script, pass `--yes` (it is required when there is no terminal to prompt on) and `--output json` for a machine-readable result.

### From the admin site

Run `ritual admin`, open the **Import Changes** page, and upload the file or paste its contents. The page shows the same preview, and nothing is written until you press **Apply N changes to K lists**. See [Importing: Import Changes](/admin/import/#import-changes).

To review and adjust the changes before they are saved, open the list in the admin editor instead and use its **Import…** button. The bundle's changes for that list load as pending edits. Change what you like, then **Save Changes**. See [Loading changes into an editor](/admin/import/#loading-changes-into-an-editor).

### From an AI assistant

If you use the [MCP server](/commands/mcp/), the `import_change_bundle` tool takes the bundle's JSON and applies it. The tool is marked destructive, so MCP clients that gate such tools ask you before it runs. See [Use Ritual with AI agents](/guides/ai-agents/).

## 5. Read the Result

The result is reported per list: how many changes applied, and any that were skipped.

A change is **skipped**, not applied, when it no longer fits the list:

| Reason                                 | Typical cause                                                          |
| -------------------------------------- | ---------------------------------------------------------------------- |
| `card not found`                       | The card was removed from the list after the site was built            |
| `not applicable to this list`          | A commander change on a collection, or a label change on a wanted list |
| `card has no printing for that finish` | A foil or etched finish set on a line that names no printing           |

The other changes still apply. Skipped changes do not fail the run; the CLI prints one `⚠ Skipped` line for each.

A **list fails** when it cannot be found or saved, or when a move's source list no longer holds the copy to take. That list's remaining changes stop, nothing from the failing step is written, and the other lists carry on. The CLI exits `1` in that case. See [How Changes Are Applied](/commands/import-changes/#how-changes-are-applied) for the details.

### How moves land

A move is applied once, on its destination list. That save adds the copy there and removes it from the source list in the same step, and writes a changelog entry on **both** lists. The card keeps its tags and note, and its labels follow the [move rule](/commands/move/): a proxy stays a proxy, and the destination keeps only the labels its list type accepts.

## 6. Check and Commit

Applied changes are ordinary edits:

- Each list file is rewritten and its `.changes.md` log gets the new entries, as if you had made them in an editor.
- `ritual history --show "<list name>"` shows them.
- The CLI never makes git commits. Review the files with `git diff`, then commit and push.

The admin page and the MCP tool commit each saved list for you when `admin.gitEnabled` and `admin.gitAutoCommit` are on; see [Git integration](/configuration/#git-integration).

If your site is published by CI, pushing the commit rebuilds it, and the site then shows the new lists. See [Publish your deck site](/guides/publish-site/).

## Continuing on Another Device

A bundle also works in the other direction. On the public site, **Load Changes…** (next to **Export…**) loads a bundle as pending edits on the list you are editing. So you can start editing on one device, export, and pick the session up on another device before applying it at home. Changes that no longer fit the list are listed with a reason and skipped, as above.

## Related

- [Editing on the Public Site](/public-site/editing/): every editor feature, Swap Printings, and the export panel.
- [`import-changes`](/commands/import-changes/): options, output, exit codes, and the bundle format.
- [Importing on the admin site](/admin/import/): the Import Changes page and loading into an editor.
- [Trade page](/public-site/trade/): plan a trade on the site.
