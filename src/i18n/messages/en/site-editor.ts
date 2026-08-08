/**
 * `site.*` — the public site's editing surfaces: edit-mode chrome, the change
 * bundle export/import panels, quantity and move dialogs, and the status text
 * the editor session produces.
 *
 * One of four `site` fragments (see `site-chrome.ts` for why the namespace is
 * split across files).
 *
 * The dialogs and action bar the public editor *embeds* live in `ui.*` instead:
 * `src/editor` and `src/ui` are shared with the admin SPA, so their wording must
 * not sit in a public-site-only fragment. What is here is the chrome that exists
 * only because the public editor has no server to save to — the local-copy
 * banner, the export panel, and the browser-session restore prompt.
 */

import type { MessageCatalogShape } from '../../types'

export const siteEditorMessages = {
  // ── Edit-mode banner (second navbar row) ──────────────────────────────
  //
  // `{emphasis}` is rendered as its own bold element, so the sentence is split
  // into a frame plus the phrase to stress rather than hard-coded markup — a
  // translator can move the stressed phrase anywhere in the sentence.
  'site.editor.localCopy': 'Editing a local copy — {emphasis}',
  'site.editor.localCopyEmphasis': 'not the published version',
  'site.editor.viewToggle': 'View original or edited',
  'site.editor.viewOriginal': 'Original',
  'site.editor.viewEdited': 'Edited',
  'site.editor.discard': 'Discard',
  'site.editor.loadChanges': 'Load Changes…',
  'site.editor.export': 'Export…',

  // ── Leaving edit mode ─────────────────────────────────────────────────
  'site.editor.exitTitle': 'Discard your edits and exit?',
  'site.editor.exitMessage':
    'Your pending edits are only held in this browser. Leaving edit mode throws them away.',
  'site.editor.exitConfirm': 'Discard and exit',

  // ── Restoring a session saved to the browser ──────────────────────────
  'site.editor.restorePrompt': {
    $plural: 'count',
    one: 'You saved edits to this list in this browser ({count} change). Restore them?',
    other: 'You saved edits to this list in this browser ({count} changes). Restore them?',
  },
  'site.editor.restore': 'Restore',
  'site.editor.dismiss': 'Dismiss',

  // ── Export panel ──────────────────────────────────────────────────────
  //
  // The public editor cannot save, so "export" is its commit: the visitor
  // downloads or copies a change file and applies it elsewhere.
  'site.editor.exportTitle': 'Export your edits',
  'site.editor.exportScope': 'Export scope',
  'site.editor.scopeThisList': {
    $plural: 'count',
    one: 'This list ({count} change)',
    other: 'This list ({count} changes)',
  },
  'site.editor.scopeCurrentLists': {
    $plural: 'count',
    one: 'Current lists ({count} change)',
    other: 'Current lists ({count} changes)',
  },
  'site.editor.scopeAllLists': {
    $plural: 'count',
    one: 'All lists ({count} change)',
    other: 'All lists ({count} changes)',
  },
  'site.editor.scopeThisListHint': 'Open a single list to export just its changes',
  'site.editor.exporting': 'Exporting {changes}',
  'site.editor.exportingAcross': 'Exporting {changes} across {lists}',
  'site.editor.reviewShow': 'Review changes',
  'site.editor.reviewHide': 'Hide changes',
  'site.editor.reviewGroup': '{icon} {name} — {changes}',
  'site.editor.downloadJson': 'Download change list (JSON)',
  'site.editor.copyJson': 'Copy JSON',
  'site.editor.copied': 'Copied!',
  // `{command}` is the literal CLI invocation, rendered as code and never translated.
  'site.editor.applyHint': "Apply the JSON with the admin site's Import Changes page or {command}.",
  'site.editor.saveToBrowser': 'Save edits to this browser',
  'site.editor.savedToBrowser': 'Saved to browser ✓',
  'site.editor.clearSaved': 'Clear saved edits',
  'site.editor.browserOnlyHint':
    'Saved only in this browser (localStorage) until you clear it — never uploaded.',

  // ── Per-list-type file downloads offered by the export panel ──────────
  'site.editor.downloadDeck': 'Download updated deck (.txt)',
  'site.editor.downloadCollection': 'Download updated collection (.md)',
  'site.editor.downloadCollectionCsv': 'Download CSV',
  'site.editor.downloadWanted': 'Download updated wanted list (.md)',
} as const satisfies MessageCatalogShape
