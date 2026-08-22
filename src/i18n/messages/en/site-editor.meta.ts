/** Translator metadata for the `site-editor` fragment. See `src/i18n/types.ts`. */

import type { MetaFor } from '../../types'
import type { siteEditorMessages } from './site-editor'

export const siteEditorMeta = {
  'site.editor.localCopy': {
    description:
      'Standing notice while the public site is in edit mode: the edits live only in this browser. {emphasis} is rendered bold and is supplied by site.editor.localCopyEmphasis.',
  },
  'site.editor.localCopyEmphasis': {
    description:
      'The stressed half of that notice — what the visitor is *not* editing. Rendered bold inside site.editor.localCopy.',
  },
  'site.editor.viewToggle': {
    description:
      "Screen-reader name of the pair of buttons switching between the published list and the visitor's edited copy.",
  },
  'site.editor.viewOriginal': {
    description: 'Toggle option showing the published list, with no edits applied.',
    maxLen: 14,
  },
  'site.editor.viewEdited': {
    description: "Toggle option showing the visitor's edited copy of the list.",
    maxLen: 14,
  },
  'site.editor.discard': {
    description: 'Edit-bar button throwing away every pending edit to the open list.',
    maxLen: 14,
  },
  'site.editor.loadChanges': {
    description:
      'Edit-bar button opening the dialog that loads a previously exported change file. The ellipsis marks that a dialog follows.',
    maxLen: 20,
  },
  'site.editor.export': {
    description:
      'Edit-bar button opening the export panel. The ellipsis marks that a dialog follows.',
    maxLen: 14,
  },
  'site.editor.swapPrintings': {
    description:
      'Edit-bar button opening the batch Swap Printings wizard for the whole list being edited. The ellipsis marks that a dialog follows.',
    maxLen: 20,
  },
  'site.editor.exitTitle': {
    description:
      'Title of the confirmation shown when leaving edit mode with unsaved edits — including edits to other lists made earlier in the same visit.',
  },
  'site.editor.exitMessage': {
    description:
      'Body of that confirmation, explaining that nothing was ever uploaded so the edits cannot be recovered afterwards.',
  },
  'site.editor.exitConfirm': {
    description: 'The destructive button of that confirmation.',
    maxLen: 22,
  },
  'site.editor.restorePrompt': {
    description:
      'Offer shown on opening a list the visitor had deliberately saved to this browser earlier. {count} is how many edits were saved.',
  },
  'site.editor.restore': {
    description: 'Accepts the restore offer, loading the saved edits as pending changes.',
    maxLen: 14,
  },
  'site.editor.dismiss': {
    description:
      'Declines the restore offer for now. The saved edits are kept, not deleted — only hidden.',
    maxLen: 14,
  },
  'site.editor.exportTitle': {
    description:
      "Title of the export panel, which is the public editor's equivalent of saving: there is no server to write to.",
  },
  'site.editor.exportScope': {
    description:
      'Screen-reader name of the buttons choosing how much of the session an export covers.',
  },
  'site.editor.scopeThisList': {
    description:
      "Scope button covering only the list currently open. {count} is that list's pending edit count.",
  },
  'site.editor.scopeCurrentLists': {
    description:
      'Scope button covering the lists making up the combined view being browsed. {count} is their total pending edit count.',
  },
  'site.editor.scopeAllLists': {
    description:
      'Scope button covering every list edited during this visit. {count} is the total pending edit count.',
  },
  'site.editor.scopeThisListHint': {
    description:
      'Hover tooltip explaining why the "this list" scope is dead: the visitor is not on a single list\'s page.',
  },
  'site.editor.exporting': {
    description:
      'Summary of what the export will contain when it covers one list. {changes} is an already-rendered count phrase such as "3 changes".',
  },
  'site.editor.exportingAcross': {
    description:
      'Summary of what the export will contain when it spans several lists. {changes} and {lists} are already-rendered count phrases such as "7 changes" and "2 lists".',
  },
  'site.editor.reviewShow': {
    description: 'Button expanding the itemised list of edits about to be exported.',
    maxLen: 20,
  },
  'site.editor.reviewHide': {
    description: 'Button collapsing that itemised list again.',
    maxLen: 20,
  },
  'site.editor.reviewGroup': {
    description:
      "Header of one list's section in the review. {icon} is an emoji for the list kind, {name} the list name, {changes} an already-rendered count phrase.",
  },
  'site.editor.downloadJson': {
    description:
      'Button downloading the edits as a change file — the machine-readable form applied later by the admin site or the CLI.',
  },
  'site.editor.copyJson': {
    description: 'Button copying that same change file to the clipboard instead of downloading it.',
    maxLen: 20,
  },
  'site.editor.copied': {
    description: "Momentary confirmation replacing the copy button's label after a copy.",
    maxLen: 20,
  },
  'site.editor.applyHint': {
    description:
      'Explains what to do with the exported file. {command} is the literal CLI command, rendered as code and never translated.',
  },
  'site.editor.saveToBrowser': {
    description:
      'Button deliberately persisting the pending edits in this browser so they survive a reload. Opt-in; nothing is uploaded.',
  },
  'site.editor.savedToBrowser': {
    description: "Momentary confirmation replacing that button's label after saving.",
  },
  'site.editor.clearSaved': {
    description: 'Button deleting the edits previously saved to this browser.',
  },
  'site.editor.browserOnlyHint': {
    description:
      "Reassurance under the save-to-browser button: localStorage is the browser's own storage and the edits never leave the machine.",
  },
  'site.editor.downloadDeck': {
    description:
      'Button downloading the edited deck as a plain-text deck list. The file extension is never translated.',
  },
  'site.editor.downloadCollection': {
    description:
      'Button downloading the edited collection as its markdown list file. The file extension is never translated.',
  },
  'site.editor.downloadCollectionCsv': {
    description: 'Button downloading the edited collection as a spreadsheet-friendly CSV.',
  },
  'site.editor.downloadWanted': {
    description:
      'Button downloading the edited wanted list as its markdown list file. The file extension is never translated.',
  },
} as const satisfies MetaFor<typeof siteEditorMessages>
