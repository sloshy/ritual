import { describe, expect, test } from 'bun:test'
import { t } from '../../../src/i18n/t'

/**
 * The counts that used to be written `change(s)`: each is a real `$plural` now,
 * so English agrees with its count and a translator gets every form their
 * language needs. One row per key and form.
 */
describe('count-driven messages agree with their count', () => {
  const rows: [string, string, string][] = [
    [
      t('cli.detectChanges.changeCount', { label: 'decks/a.md', count: 1 }),
      t('cli.detectChanges.changeCount', { label: 'decks/a.md', count: 2 }),
      'decks/a.md: 1 change|decks/a.md: 2 changes',
    ],
    [
      t('cli.edit.badgeUnsaved', { count: 1 }),
      t('cli.edit.badgeUnsaved', { count: 2 }),
      '1 unsaved change|2 unsaved changes',
    ],
    [
      t('cli.history.proseWarning', { count: 1 }),
      t('cli.history.proseWarning', { count: 2 }),
      '1 hand-written line will be discarded.|2 hand-written lines will be discarded.',
    ],
    [
      t('cli.history.saved', { count: 1, file: 'a.changes.md' }),
      t('cli.history.saved', { count: 2, file: 'a.changes.md' }),
      'Saved 1 change set to a.changes.md|Saved 2 change sets to a.changes.md',
    ],
    [
      t('cli.history.rewrote', { count: 1 }),
      t('cli.history.rewrote', { count: 2 }),
      'Rewrote history as a single change set with 1 entry (in memory).|' +
        'Rewrote history as a single change set with 2 entries (in memory).',
    ],
    [
      t('cli.cleanup.cardNamesFolded', { count: 1, names: 'A // A' }),
      t('cli.cleanup.cardNamesFolded', { count: 2, names: 'A // A, B // B' }),
      'folded 1 repeated-face card name onto the card it prints: A // A|' +
        'folded 2 repeated-face card names onto the cards they print: A // A, B // B',
    ],
    [
      t('cli.cleanup.categoriesPruned', { count: 1, names: 'Opt' }),
      t('cli.cleanup.categoriesPruned', { count: 2, names: 'Opt' }),
      'pruned 1 category assignment for a card no longer in the list: Opt|' +
        'pruned 2 category assignments for cards no longer in the list: Opt',
    ],
    [
      t('cli.edit.discardCardChangesFirst', {
        type: 'deck',
        changes: t('cli.edit.cardChangeCount', { count: 1 }),
      }),
      t('cli.edit.discardCardChangesFirst', {
        type: 'deck',
        changes: t('cli.edit.cardChangeCount', { count: 2 }),
      }),
      "discard this deck's 1 card change first|discard this deck's 2 card changes first",
    ],
    [
      t('cli.edit.discardInboundMovesFirst', {
        type: 'collection',
        moves: t('cli.edit.pendingMoveCount', { count: 1 }),
      }),
      t('cli.edit.discardInboundMovesFirst', {
        type: 'collection',
        moves: t('cli.edit.pendingMoveCount', { count: 2 }),
      }),
      'discard the 1 pending move into this collection first|' +
        'discard the 2 pending moves into this collection first',
    ],
  ]

  test.each(rows)('%p / %p', (one, other, expected) => {
    expect(`${one}|${other}`).toBe(expected)
  })
})
