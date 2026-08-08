/**
 * `help.*` messages for the interactive editors — the unified `edit` session, list lifecycle, history, and cleanup.
 *
 * A fragment of the help namespace, split out purely so the command surfaces can
 * be converted independently without contending for one file. Every key still
 * begins with `help.`, and a translator sees one flat catalog.
 *
 * These strings are *registered*, not called: Commander evaluates them while
 * `buildProgram()` constructs the tree, which is why the locale is resolved from
 * the tolerant argv pre-scan before registration (see `src/commands/locale.ts`).
 *
 * Flag spellings (`--show`, `--hash-only`), file extensions (`.sha256`), git
 * refs (`HEAD~1`), the `deck:`/`collection:`/`wanted:` prefixes, finish and
 * condition tokens and set codes are machine vocabulary and stay English inside
 * the sentences that mention them.
 */

import type { MessageCatalogShape } from '../../types'

export const helpEditMessages = {
  // ── edit ──────────────────────────────────────────────────────────────
  'help.edit.description': 'Edit any deck, collection, or wanted list in one interactive session',
  'help.edit.listName':
    'Open this list directly, skipping the selection menu (optionally with a deck:/collection:/wanted: prefix)',
  'help.edit.deck': 'Resolve the list name as a deck',
  'help.edit.collection': 'Resolve the list name as a collection',
  'help.edit.wanted': 'Resolve the list name as a wanted list',
  'help.edit.sets': 'Filter by set codes (comma-separated, e.g., "FDN, SPG")',
  'help.edit.finish': 'Default finish (nonfoil, foil, etched)',
  'help.edit.condition': 'Default condition (NM, LP, MP, HP, DMG)',
  'help.edit.section': 'Add deck cards to this section (otherwise prompts per card)',
  'help.edit.collector': 'Start in collector number mode',
  'help.edit.allowDigitalOnly': 'Include digital-only sets (e.g., Alchemy)',

  // ── history ───────────────────────────────────────────────────────────
  'help.history.description':
    'Compact and rewrite the change history for a deck, collection, or wanted list',
  'help.history.listName':
    'Name of the deck, collection, or wanted list (resolved across all types unless a type flag is given)',
  'help.history.deck': 'Resolve the name as a deck',
  'help.history.collection': 'Resolve the name as a collection',
  'help.history.wanted': 'Resolve the name as a wanted list',
  'help.history.show': 'Print the change history and exit instead of opening the editor',
  'help.history.limit': 'With --show: print only the newest <n> change sets',

  // ── detect-changes ────────────────────────────────────────────────────
  'help.detectChanges.description':
    'Record changelog entries for hand-edited lists, or manage .sha256 sidecars',
  'help.detectChanges.commit': 'Git commit hash or ref to diff against (e.g. HEAD~1, abc123)',
  'help.detectChanges.hashOnly':
    'Stamp .sha256 sidecars from current content (no git, no changelog entries)',
  'help.detectChanges.verify': "Report each list file's sidecar status and write nothing",
  'help.detectChanges.dryRun': 'Preview what would change without writing files',
} as const satisfies MessageCatalogShape
