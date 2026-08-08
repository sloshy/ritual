/** Translator metadata for {@link helpEditMessages}. See `src/i18n/types.ts`. */

import type { MetaFor } from '../../types'
import type { helpEditMessages } from './help-edit'

export const helpEditMeta = {
  // ── edit ──────────────────────────────────────────────────────────────
  'help.edit.description': { description: 'Summary of the `edit` command.' },
  'help.edit.listName': {
    description:
      'The `[listName]` argument of `edit`. The three prefixes are literal spellings, colon included.',
  },
  'help.edit.deck': { description: '`edit --deck`.' },
  'help.edit.collection': { description: '`edit --collection`.' },
  'help.edit.wanted': { description: '`edit --wanted`.' },
  'help.edit.sets': {
    description: '`edit --sets`. FDN and SPG are set codes and stay uppercase as-is.',
  },
  'help.edit.finish': {
    description: '`edit --finish`. The three finishes are literal values the user types.',
  },
  'help.edit.condition': {
    description: '`edit --condition`. The five codes are literal values the user types.',
  },
  'help.edit.section': {
    description: '`edit --section`. A section is a deck board such as Main or Sideboard.',
  },
  'help.edit.collector': {
    description:
      '`edit --collector`. Collector number mode adds cards by set and collector number instead of by name.',
  },
  'help.edit.allowDigitalOnly': {
    description: '`edit --allow-digital-only-cards`. Alchemy is a digital-only product name.',
  },

  // ── history ───────────────────────────────────────────────────────────
  'help.history.description': { description: 'Summary of the `history` command.' },
  'help.history.listName': { description: 'The `[listName]` argument of `history`.' },
  'help.history.deck': { description: '`history --deck`.' },
  'help.history.collection': { description: '`history --collection`.' },
  'help.history.wanted': { description: '`history --wanted`.' },
  'help.history.show': { description: '`history --show`.' },
  'help.history.limit': {
    description: '`history --limit`. `--show` is a flag spelling and `<n>` its placeholder.',
  },

  // ── detect-changes ────────────────────────────────────────────────────
  'help.detectChanges.description': {
    description:
      "Summary of the `detect-changes` command. A sidecar is the `.sha256` file recording a list file's content hash.",
  },
  'help.detectChanges.commit': {
    description: 'The `[commit]` argument of `detect-changes`. The two examples are git refs.',
  },
  'help.detectChanges.hashOnly': { description: '`detect-changes --hash-only`.' },
  'help.detectChanges.verify': { description: '`detect-changes --verify`.' },
  'help.detectChanges.dryRun': { description: '`detect-changes --dry-run`.' },
} as const satisfies MetaFor<typeof helpEditMessages>
