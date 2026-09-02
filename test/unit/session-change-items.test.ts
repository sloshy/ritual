import { describe, expect, test } from 'bun:test'
import {
  listSessionChangeItems,
  sessionChangeCardId,
  type EditUndoEntry,
  type SameCardCheck,
} from '../../src/commands/session/edit-undo'
import type { SessionAddItem } from '../../src/commands/session/strategy'
import { t } from '../../src/i18n/t'

/**
 * The View Session Changes rows: which of them the screen may offer to *edit*
 * (as opposed to only discard), and the index → card id mapping that routes
 * those edits back to a line.
 *
 * The property under test is that editability is an **identity** check, not a
 * liveness one. A removal releases its `&N` to the pool and the next add takes
 * it, so a rule that only asked "does this id resolve?" would offer to edit the
 * card that inherited the number, under a row naming the card that was removed.
 */

const undoEntry = (
  cardId: number,
  cardName: string,
  kind: EditUndoEntry['kind'],
  label: string,
): EditUndoEntry => ({
  cardId,
  cardName,
  kind,
  label,
  inverse: [],
  addedToChangelog: [],
  removedFromChangelog: [],
})

/** The live list: `&1` is Sol Ring, and `&5` has been reissued to Black Lotus. */
const isSameCard: SameCardCheck = (cardId, name) =>
  (cardId === 1 && name === 'Sol Ring') || (cardId === 5 && name === 'Black Lotus')

const adds: SessionAddItem[] = [
  { label: 'Sol Ring (LEA:269) &1', name: 'Sol Ring', cardId: 1 },
  // A session add whose line is gone again: no id, so nothing to edit.
  { label: 'removed (&9)', name: '&9', cardId: undefined },
]

const editUndo: EditUndoEntry[] = [
  undoEntry(1, 'Sol Ring', 'edit', 'printing on Sol Ring'),
  undoEntry(5, 'Mox Ruby', 'removal', 'removed Mox Ruby'),
]

describe('listSessionChangeItems', () => {
  test('offers the edit actions only where the id still names the same card', () => {
    expect(listSessionChangeItems(adds, editUndo, isSameCard).map((item) => item.editable)).toEqual(
      [
        true, // the add: &1 is still Sol Ring
        false, // the discarded add: no id at all
        true, // the field edit: &1 is still Sol Ring
        false, // the removal: &5 resolves, but to Black Lotus, not Mox Ruby
      ],
    )
  })

  test('a removal is never editable even when its id was never reissued', () => {
    // The row's own card is gone; there is nothing of it left to edit.
    const gone = undoEntry(1, 'Sol Ring', 'removal', 'removed Sol Ring')
    expect(listSessionChangeItems([], [gone], isSameCard)[0]?.editable).toBe(false)
  })

  test('an add whose id was reissued to a different card is not editable', () => {
    // A deck add row keeps the name it recorded, so the mismatch is visible.
    const stale: SessionAddItem = { label: 'Mox Ruby → Main', name: 'Mox Ruby', cardId: 5 }
    expect(listSessionChangeItems([stale], [], isSameCard)[0]?.editable).toBe(false)
  })

  test('a blocked row is still editable — the block only stops the discard', () => {
    // Two field edits on card 1: the older cannot be undone out of order, but
    // the card itself is unchanged in identity, so editing it is safe.
    const stacked = [
      undoEntry(1, 'Sol Ring', 'edit', 'printing on Sol Ring'),
      undoEntry(1, 'Sol Ring', 'edit', 'note'),
    ]
    const [older] = listSessionChangeItems([], stacked, isSameCard)
    expect(t('cli.edit.undoBlockedNewer', { label: 'note' })).not.toBe('cli.edit.undoBlockedNewer')
    expect(older?.blocked).toBe(t('cli.edit.undoBlockedNewer', { label: 'note' }))
    expect(older?.editable).toBe(true)
  })
})

describe('sessionChangeCardId', () => {
  test('maps a row index across the adds-then-edits concatenation', () => {
    expect(sessionChangeCardId(adds, editUndo, 0)).toBe(1)
    expect(sessionChangeCardId(adds, editUndo, 1)).toBeUndefined()
    expect(sessionChangeCardId(adds, editUndo, 2)).toBe(1)
    expect(sessionChangeCardId(adds, editUndo, 3)).toBe(5)
  })

  test('an index past the end names no card', () => {
    expect(sessionChangeCardId(adds, editUndo, 4)).toBeUndefined()
  })
})
