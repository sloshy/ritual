import { describe, test, expect } from 'bun:test'
import {
  areOppositeChanges,
  consolidateSetFinish,
  consolidateSetNote,
  consolidateSetPrinting,
  isAdditiveChange,
  isSamePrinting,
  createChangeId,
  formatChange,
} from '../../src/change-event'
import type { ChangeEvent, ChangeAction } from '../../src/change-event'
import { applyChangeToDeck } from '../../src/admin/site/types/deck-changes'
import type { DeckData } from '../../src/types'

type MakeChangeOverrides = {
  action: ChangeAction
  cardName: string
  cardId?: number
  set?: string
  collectorNumber?: string
  finish?: string
  condition?: string
  board?: string
  note?: string
  to?: unknown
  from?: unknown
}

/** Test helper — builds a ChangeEvent with add-change defaults.
 *  Uses assertion since overrides may switch to a different union branch. */
function makeChange(overrides: MakeChangeOverrides): ChangeEvent {
  return {
    id: createChangeId(),
    timestamp: Date.now(),
    ...overrides,
  } as ChangeEvent
}

describe('areOppositeChanges', () => {
  test('add + remove of same card returns true', () => {
    const a = makeChange({ action: 'add', cardName: 'Sol Ring' })
    const b = makeChange({ action: 'remove', cardName: 'Sol Ring' })
    expect(areOppositeChanges(a, b)).toBe(true)
  })

  test('remove + add of same card returns true', () => {
    const a = makeChange({ action: 'remove', cardName: 'Sol Ring' })
    const b = makeChange({ action: 'add', cardName: 'Sol Ring' })
    expect(areOppositeChanges(a, b)).toBe(true)
  })

  test('add + remove of different cards returns false', () => {
    const a = makeChange({ action: 'add', cardName: 'Sol Ring' })
    const b = makeChange({ action: 'remove', cardName: 'Mana Crypt' })
    expect(areOppositeChanges(a, b)).toBe(false)
  })

  test('add + remove same card but different set returns false', () => {
    const a = makeChange({ action: 'add', cardName: 'Sol Ring', set: '2XM' })
    const b = makeChange({ action: 'remove', cardName: 'Sol Ring', set: 'C21' })
    expect(areOppositeChanges(a, b)).toBe(false)
  })

  test('add + remove same card but different finish returns false', () => {
    const a = makeChange({ action: 'add', cardName: 'Sol Ring', finish: 'foil' })
    const b = makeChange({ action: 'remove', cardName: 'Sol Ring', finish: 'nonfoil' })
    expect(areOppositeChanges(a, b)).toBe(false)
  })

  test('add + remove same card but different condition returns false', () => {
    const a = makeChange({ action: 'add', cardName: 'Sol Ring', condition: 'NM' })
    const b = makeChange({ action: 'remove', cardName: 'Sol Ring', condition: 'LP' })
    expect(areOppositeChanges(a, b)).toBe(false)
  })

  test('add + add same card returns false (same action)', () => {
    const a = makeChange({ action: 'add', cardName: 'Sol Ring' })
    const b = makeChange({ action: 'add', cardName: 'Sol Ring' })
    expect(areOppositeChanges(a, b)).toBe(false)
  })

  test('remove + remove same card returns false', () => {
    const a = makeChange({ action: 'remove', cardName: 'Sol Ring' })
    const b = makeChange({ action: 'remove', cardName: 'Sol Ring' })
    expect(areOppositeChanges(a, b)).toBe(false)
  })

  test('set-commander + remove returns false (different action types)', () => {
    const a = makeChange({ action: 'set-commander', cardName: 'Sol Ring' })
    const b = makeChange({ action: 'remove', cardName: 'Sol Ring' })
    expect(areOppositeChanges(a, b)).toBe(false)
  })

  test('set-commander + unset-commander of same card returns true', () => {
    const a = makeChange({ action: 'set-commander', cardName: 'Sol Ring' })
    const b = makeChange({ action: 'unset-commander', cardName: 'Sol Ring' })
    expect(areOppositeChanges(a, b)).toBe(true)
  })

  test('unset-commander + set-commander of same card returns true', () => {
    const a = makeChange({ action: 'unset-commander', cardName: 'Sol Ring' })
    const b = makeChange({ action: 'set-commander', cardName: 'Sol Ring' })
    expect(areOppositeChanges(a, b)).toBe(true)
  })

  test('set-commander + unset-commander of different cards returns false', () => {
    const a = makeChange({ action: 'set-commander', cardName: 'Sol Ring' })
    const b = makeChange({ action: 'unset-commander', cardName: 'Mana Crypt' })
    expect(areOppositeChanges(a, b)).toBe(false)
  })

  test('set-commander + set-commander same card returns false (same action)', () => {
    const a = makeChange({ action: 'set-commander', cardName: 'Sol Ring' })
    const b = makeChange({ action: 'set-commander', cardName: 'Sol Ring' })
    expect(areOppositeChanges(a, b)).toBe(false)
  })

  test('both with matching set/CN/finish/condition returns true', () => {
    const a = makeChange({
      action: 'add',
      cardName: 'Mana Crypt',
      set: '2XM',
      collectorNumber: '1',
      finish: 'foil',
      condition: 'LP',
    })
    const b = makeChange({
      action: 'remove',
      cardName: 'Mana Crypt',
      set: '2XM',
      collectorNumber: '1',
      finish: 'foil',
      condition: 'LP',
    })
    expect(areOppositeChanges(a, b)).toBe(true)
  })

  test('both with undefined set/CN match (both undefined)', () => {
    const a = makeChange({ action: 'add', cardName: 'Sol Ring' })
    const b = makeChange({ action: 'remove', cardName: 'Sol Ring' })
    expect(areOppositeChanges(a, b)).toBe(true)
  })

  test('one with set, other without returns false', () => {
    const a = makeChange({ action: 'add', cardName: 'Sol Ring', set: '2XM', collectorNumber: '1' })
    const b = makeChange({ action: 'remove', cardName: 'Sol Ring' })
    expect(areOppositeChanges(a, b)).toBe(false)
  })

  test('same card with matching cardId cancels', () => {
    const a = makeChange({ action: 'add', cardName: 'Sol Ring', cardId: 5 })
    const b = makeChange({ action: 'remove', cardName: 'Sol Ring', cardId: 5 })
    expect(areOppositeChanges(a, b)).toBe(true)
  })

  test('same card with different cardIds does not cancel', () => {
    const a = makeChange({ action: 'add', cardName: 'Sol Ring', cardId: 5 })
    const b = makeChange({ action: 'remove', cardName: 'Sol Ring', cardId: 7 })
    expect(areOppositeChanges(a, b)).toBe(false)
  })

  test('both undefined cardIds still cancel', () => {
    const a = makeChange({ action: 'add', cardName: 'Sol Ring' })
    const b = makeChange({ action: 'remove', cardName: 'Sol Ring' })
    expect(areOppositeChanges(a, b)).toBe(true)
  })

  test('one with cardId and one without still cancel (backwards compat)', () => {
    const a = makeChange({ action: 'add', cardName: 'Sol Ring', cardId: 5 })
    const b = makeChange({ action: 'remove', cardName: 'Sol Ring' })
    expect(areOppositeChanges(a, b)).toBe(true)
  })

  test('commander changes with matching cardIds cancel', () => {
    const a = makeChange({ action: 'set-commander', cardName: 'Kenrith', cardId: 1 })
    const b = makeChange({ action: 'unset-commander', cardName: 'Kenrith', cardId: 1 })
    expect(areOppositeChanges(a, b)).toBe(true)
  })

  test('commander changes with different cardIds do not cancel', () => {
    const a = makeChange({ action: 'set-commander', cardName: 'Kenrith', cardId: 1 })
    const b = makeChange({ action: 'unset-commander', cardName: 'Kenrith', cardId: 2 })
    expect(areOppositeChanges(a, b)).toBe(false)
  })

  test('add to Sideboard + remove from Main (default) does not cancel', () => {
    const a = makeChange({ action: 'add', cardName: 'Sol Ring', board: 'Sideboard' })
    const b = makeChange({ action: 'remove', cardName: 'Sol Ring' })
    expect(areOppositeChanges(a, b)).toBe(false)
  })
})

describe('consolidateSetFinish', () => {
  test('adds a set-finish change when finish differs from original', () => {
    const { changes, addedChange, cancelledChange } = consolidateSetFinish(
      [],
      'Sol Ring',
      'foil',
      'nonfoil',
    )
    expect(changes).toHaveLength(1)
    expect(changes[0]!.action).toBe('set-finish')
    expect((changes[0] as { finish: string }).finish).toBe('foil')
    expect(addedChange).not.toBeNull()
    expect(cancelledChange).toBeNull()
  })

  test('does not add a change when finish equals originalFinish', () => {
    const { changes, addedChange, cancelledChange } = consolidateSetFinish(
      [],
      'Sol Ring',
      'nonfoil',
      'nonfoil',
    )
    expect(changes).toHaveLength(0)
    expect(addedChange).toBeNull()
    expect(cancelledChange).toBeNull()
  })

  test('cancels existing set-finish and adds nothing when restoring to original', () => {
    const existing = makeChange({ action: 'set-finish', cardName: 'Sol Ring', finish: 'foil' })
    const { changes, addedChange, cancelledChange } = consolidateSetFinish(
      [existing],
      'Sol Ring',
      'nonfoil',
      'nonfoil',
    )
    expect(changes).toHaveLength(0)
    expect(addedChange).toBeNull()
    expect(cancelledChange).toBe(existing)
  })

  test('replaces existing set-finish with new finish', () => {
    const existing = makeChange({ action: 'set-finish', cardName: 'Sol Ring', finish: 'foil' })
    const { changes, addedChange, cancelledChange } = consolidateSetFinish(
      [existing],
      'Sol Ring',
      'etched',
      'nonfoil',
    )
    expect(changes).toHaveLength(1)
    expect((changes[0] as { finish: string }).finish).toBe('etched')
    expect(addedChange).not.toBeNull()
    expect(cancelledChange).toBe(existing)
  })

  test('only one set-finish per card at a time; replaces foil → etched → nonfoil (original)', () => {
    const step1 = consolidateSetFinish([], 'Sol Ring', 'foil', 'nonfoil')
    expect(step1.changes).toHaveLength(1)

    const step2 = consolidateSetFinish(step1.changes, 'Sol Ring', 'etched', 'nonfoil')
    expect(step2.changes).toHaveLength(1)
    expect((step2.changes[0] as { finish: string }).finish).toBe('etched')

    const step3 = consolidateSetFinish(step2.changes, 'Sol Ring', 'nonfoil', 'nonfoil')
    expect(step3.changes).toHaveLength(0)
    expect(step3.addedChange).toBeNull()
    expect(step3.cancelledChange).not.toBeNull()
  })

  test('does not affect set-finish for a different card', () => {
    const other = makeChange({ action: 'set-finish', cardName: 'Mana Crypt', finish: 'foil' })
    const { changes, addedChange } = consolidateSetFinish([other], 'Sol Ring', 'foil', 'nonfoil')
    expect(changes).toHaveLength(2)
    expect(addedChange).not.toBeNull()
  })

  test('matches by cardId when provided', () => {
    const existing = makeChange({
      action: 'set-finish',
      cardName: 'Sol Ring',
      finish: 'foil',
      cardId: 5,
    })
    const { changes, cancelledChange } = consolidateSetFinish(
      [existing],
      'Sol Ring',
      'nonfoil',
      'nonfoil',
      5,
    )
    expect(changes).toHaveLength(0)
    expect(cancelledChange).toBe(existing)
  })

  test('returns no-op (both null) when finish equals original and no existing change', () => {
    const { addedChange, cancelledChange } = consolidateSetFinish(
      [],
      'Sol Ring',
      'nonfoil',
      'nonfoil',
    )
    expect(addedChange).toBeNull()
    expect(cancelledChange).toBeNull()
  })
})

describe('consolidateSetNote', () => {
  test('adds a set-note change when note differs from original', () => {
    const { changes, addedChange, cancelledChange } = consolidateSetNote(
      [],
      'Sol Ring',
      'fast mana',
      '',
    )
    expect(changes).toHaveLength(1)
    expect(changes[0]!.action).toBe('set-note')
    expect((changes[0] as { note: string }).note).toBe('fast mana')
    expect(addedChange).not.toBeNull()
    expect(cancelledChange).toBeNull()
  })

  test('does not add a change when note equals originalNote', () => {
    const { changes, addedChange, cancelledChange } = consolidateSetNote(
      [],
      'Sol Ring',
      'unchanged',
      'unchanged',
    )
    expect(changes).toHaveLength(0)
    expect(addedChange).toBeNull()
    expect(cancelledChange).toBeNull()
  })

  test('cancels existing set-note when restoring to original', () => {
    const existing = makeChange({ action: 'set-note', cardName: 'Sol Ring', note: 'first' })
    const { changes, addedChange, cancelledChange } = consolidateSetNote(
      [existing],
      'Sol Ring',
      '',
      '',
    )
    expect(changes).toHaveLength(0)
    expect(addedChange).toBeNull()
    expect(cancelledChange).toBe(existing)
  })

  test('replaces an existing set-note with the latest value', () => {
    const existing = makeChange({ action: 'set-note', cardName: 'Sol Ring', note: 'first' })
    const { changes, addedChange, cancelledChange } = consolidateSetNote(
      [existing],
      'Sol Ring',
      'second',
      '',
    )
    expect(changes).toHaveLength(1)
    expect((changes[0] as { note: string }).note).toBe('second')
    expect(addedChange).not.toBeNull()
    expect(cancelledChange).toBe(existing)
  })

  test('matches by cardId when provided', () => {
    const existing = makeChange({
      action: 'set-note',
      cardName: 'Sol Ring',
      note: 'first',
      cardId: 5,
    })
    const { changes, cancelledChange } = consolidateSetNote([existing], 'Sol Ring', '', '', 5)
    expect(changes).toHaveLength(0)
    expect(cancelledChange).toBe(existing)
  })

  test('does not affect set-note for a different card', () => {
    const other = makeChange({ action: 'set-note', cardName: 'Mana Crypt', note: 'first' })
    const { changes, addedChange } = consolidateSetNote([other], 'Sol Ring', 'second', '')
    expect(changes).toHaveLength(2)
    expect(addedChange).not.toBeNull()
  })

  test('does not consolidate set-finish or other actions', () => {
    const finishChange = makeChange({
      action: 'set-finish',
      cardName: 'Sol Ring',
      finish: 'foil',
    })
    const { changes, addedChange, cancelledChange } = consolidateSetNote(
      [finishChange],
      'Sol Ring',
      'note text',
      '',
    )
    expect(changes).toHaveLength(2)
    expect(addedChange).not.toBeNull()
    expect(cancelledChange).toBeNull()
  })
})

describe('isAdditiveChange', () => {
  test.each([
    ['add', true],
    ['set-commander', true],
    ['set-finish', true],
    ['set-note', true],
    ['set-printing', true],
    ['remove', false],
    ['unset-commander', false],
    ['move-from', false],
    ['move-to', false],
  ] as const)('isAdditiveChange(%s) === %s', (action, expected) => {
    expect(isAdditiveChange(action)).toBe(expected)
  })
})

describe('createChangeId', () => {
  test('returns unique ids', () => {
    const ids = new Set(Array.from({ length: 100 }, () => createChangeId()))
    expect(ids.size).toBe(100)
  })

  test('matches expected format (timestamp-random)', () => {
    const id = createChangeId()
    expect(id).toMatch(/^\d+-[a-z0-9]+$/)
  })
})

describe('formatChange', () => {
  test('includes card ID in add format', () => {
    const change = makeChange({ action: 'add', cardName: 'Sol Ring', cardId: 5 })
    expect(formatChange(change)).toBe('Add Sol Ring &5')
  })

  test('includes card ID with printing info', () => {
    const change = makeChange({
      action: 'add',
      cardName: 'Mana Crypt',
      set: '2xm',
      collectorNumber: '1',
      finish: 'foil',
      cardId: 42,
    })
    expect(formatChange(change)).toBe('Add Mana Crypt (2XM:1) [foil] &42')
  })

  test('includes card ID for remove', () => {
    const change = makeChange({ action: 'remove', cardName: 'Sol Ring', cardId: 3 })
    expect(formatChange(change)).toBe('Remove Sol Ring &3')
  })

  test('includes card ID for set-commander', () => {
    const change = makeChange({ action: 'set-commander', cardName: 'Kenrith', cardId: 1 })
    expect(formatChange(change)).toBe('Set Kenrith as commander &1')
  })

  test('includes card ID for set-finish', () => {
    const change = makeChange({
      action: 'set-finish',
      cardName: 'Sol Ring',
      finish: 'foil',
      cardId: 7,
    })
    expect(formatChange(change)).toBe('Set Sol Ring finish to foil &7')
  })

  test('omits card ID when undefined', () => {
    const change = makeChange({ action: 'add', cardName: 'Sol Ring' })
    expect(formatChange(change)).toBe('Add Sol Ring')
  })

  test('formats set-note with the note text', () => {
    const change = makeChange({
      action: 'set-note',
      cardName: 'Sol Ring',
      note: 'starts the engine',
      cardId: 5,
    })
    expect(formatChange(change)).toBe('Set note on Sol Ring &5 to "starts the engine"')
  })

  test('formats empty set-note as a clear', () => {
    const change = makeChange({ action: 'set-note', cardName: 'Sol Ring', note: '', cardId: 5 })
    expect(formatChange(change)).toBe('Clear note on Sol Ring &5')
  })

  test('formats set-printing with set, collector number and finish', () => {
    const change = makeChange({
      action: 'set-printing',
      cardName: 'Lightning Bolt',
      set: 'm10',
      collectorNumber: '146',
      finish: 'foil',
      cardId: 5,
    })
    expect(formatChange(change)).toBe('Set Lightning Bolt printing to M10:146 [foil] &5')
  })

  test('formats set-printing with no specific printing', () => {
    const change = makeChange({ action: 'set-printing', cardName: 'Lightning Bolt', cardId: 5 })
    expect(formatChange(change)).toBe('Set Lightning Bolt printing to no specific printing &5')
  })

  test('formats move-from with destination list label', () => {
    const change = makeChange({
      action: 'move-from',
      cardName: 'Sol Ring',
      cardId: 5,
      to: { type: 'collection', name: 'Main' },
    })
    expect(formatChange(change)).toBe("Move Sol Ring &5 to Collection 'Main'")
  })

  test('formats move-to with origin list label and printing annotation', () => {
    const change = makeChange({
      action: 'move-to',
      cardName: 'Lightning Bolt',
      set: 'm10',
      collectorNumber: '146',
      finish: 'foil',
      cardId: 7,
      from: { type: 'wanted', name: 'Burn' },
    })
    expect(formatChange(change)).toBe(
      "Move Lightning Bolt (M10:146) [foil] &7 from Wanted list 'Burn'",
    )
  })
})

describe('isSamePrinting', () => {
  test('normalizes absent finish/condition to defaults', () => {
    expect(
      isSamePrinting(
        { set: 'lea', collectorNumber: '161' },
        {
          set: 'lea',
          collectorNumber: '161',
          finish: 'nonfoil',
          condition: 'NM',
        },
      ),
    ).toBe(true)
  })

  test('compares set codes case-insensitively', () => {
    expect(
      isSamePrinting(
        { set: 'LEA', collectorNumber: '161' },
        { set: 'lea', collectorNumber: '161' },
      ),
    ).toBe(true)
  })

  test('differs when set differs', () => {
    expect(
      isSamePrinting(
        { set: 'lea', collectorNumber: '161' },
        { set: 'm10', collectorNumber: '146' },
      ),
    ).toBe(false)
  })

  test('differs when finish differs', () => {
    expect(
      isSamePrinting(
        { set: 'lea', collectorNumber: '161', finish: 'foil' },
        { set: 'lea', collectorNumber: '161', finish: 'nonfoil' },
      ),
    ).toBe(false)
  })
})

describe('consolidateSetPrinting', () => {
  test('adds a set-printing change when the printing differs from the original', () => {
    const { changes, addedChange, cancelledChange } = consolidateSetPrinting(
      [],
      'Lightning Bolt',
      { set: 'm10', collectorNumber: '146', finish: 'nonfoil' },
      { set: 'lea', collectorNumber: '161', finish: 'nonfoil' },
      5,
    )
    expect(changes).toHaveLength(1)
    expect(changes[0]!.action).toBe('set-printing')
    expect(addedChange).not.toBeNull()
    expect(cancelledChange).toBeNull()
  })

  test('adds nothing when the printing equals the original (no-op)', () => {
    const { changes, addedChange, cancelledChange } = consolidateSetPrinting(
      [],
      'Lightning Bolt',
      { set: 'lea', collectorNumber: '161' },
      { set: 'lea', collectorNumber: '161', finish: 'nonfoil', condition: 'NM' },
      5,
    )
    expect(changes).toHaveLength(0)
    expect(addedChange).toBeNull()
    expect(cancelledChange).toBeNull()
  })

  test('replaces an existing set-printing for the same card (latest wins)', () => {
    const first = consolidateSetPrinting(
      [],
      'Lightning Bolt',
      { set: 'm10', collectorNumber: '146' },
      { set: 'lea', collectorNumber: '161' },
      5,
    )
    const second = consolidateSetPrinting(
      first.changes,
      'Lightning Bolt',
      { set: '2x2', collectorNumber: '117' },
      { set: 'lea', collectorNumber: '161' },
      5,
    )
    expect(second.changes).toHaveLength(1)
    expect((second.changes[0] as { set?: string }).set).toBe('2x2')
    expect(second.cancelledChange).not.toBeNull()
  })

  test('cancels an existing set-printing when restored to the original', () => {
    const first = consolidateSetPrinting(
      [],
      'Lightning Bolt',
      { set: 'm10', collectorNumber: '146' },
      { set: 'lea', collectorNumber: '161' },
      5,
    )
    const revert = consolidateSetPrinting(
      first.changes,
      'Lightning Bolt',
      { set: 'lea', collectorNumber: '161' },
      { set: 'lea', collectorNumber: '161' },
      5,
    )
    expect(revert.changes).toHaveLength(0)
    expect(revert.addedChange).toBeNull()
    expect(revert.cancelledChange).not.toBeNull()
  })

  test('keeps set-printing changes for different cardIds independent', () => {
    const first = consolidateSetPrinting(
      [],
      'Lightning Bolt',
      { set: 'm10', collectorNumber: '146' },
      { set: 'lea', collectorNumber: '161' },
      1,
    )
    const second = consolidateSetPrinting(
      first.changes,
      'Lightning Bolt',
      { set: 'm10', collectorNumber: '146' },
      { set: 'lea', collectorNumber: '161' },
      2,
    )
    expect(second.changes).toHaveLength(2)
  })
})

function makeDeck(): DeckData {
  return {
    name: 'Test Deck',
    sections: [
      {
        name: 'Main',
        cards: [
          {
            quantity: 4,
            name: 'Lightning Bolt',
            set: 'lea',
            collectorNumber: '161',
            finish: 'nonfoil',
            cardId: 5,
          },
        ],
      },
    ],
  }
}

describe('applyChangeToDeck — change-printing support', () => {
  test('add with a different printing creates a separate entry (does not merge by name)', () => {
    const deck = makeDeck()
    const result = applyChangeToDeck(deck, {
      action: 'add',
      cardName: 'Lightning Bolt',
      set: 'm10',
      collectorNumber: '146',
      finish: 'nonfoil',
      cardId: 99,
    })
    const cards = result.sections[0]!.cards
    expect(cards).toHaveLength(2)
    expect(cards[0]!.set).toBe('lea')
    expect(cards[0]!.quantity).toBe(4)
    expect(cards[1]!.set).toBe('m10')
    expect(cards[1]!.cardId).toBe(99)
    expect(cards[1]!.quantity).toBe(1)
  })

  test('add with the same printing merges into the existing entry', () => {
    const deck = makeDeck()
    const result = applyChangeToDeck(deck, {
      action: 'add',
      cardName: 'Lightning Bolt',
      set: 'lea',
      collectorNumber: '161',
      finish: 'nonfoil',
      cardId: 99,
    })
    const cards = result.sections[0]!.cards
    expect(cards).toHaveLength(1)
    expect(cards[0]!.quantity).toBe(5)
  })

  test('set-printing retargets the entry by cardId in place', () => {
    const deck = makeDeck()
    const result = applyChangeToDeck(deck, {
      action: 'set-printing',
      cardName: 'Lightning Bolt',
      set: 'm10',
      collectorNumber: '146',
      finish: 'foil',
      cardId: 5,
    })
    const cards = result.sections[0]!.cards
    expect(cards).toHaveLength(1)
    expect(cards[0]!.set).toBe('m10')
    expect(cards[0]!.collectorNumber).toBe('146')
    expect(cards[0]!.finish).toBe('foil')
    expect(cards[0]!.quantity).toBe(4)
  })

  test('partial split: decrement original by 2, then add 2 of new printing under a new id', () => {
    let deck = makeDeck()
    // Decrement the original entry by 2.
    for (let i = 0; i < 2; i++) {
      deck = applyChangeToDeck(deck, { action: 'remove', cardName: 'Lightning Bolt', cardId: 5 })
    }
    // Add 2 copies of the new printing under a fresh id.
    for (let i = 0; i < 2; i++) {
      deck = applyChangeToDeck(deck, {
        action: 'add',
        cardName: 'Lightning Bolt',
        set: 'm10',
        collectorNumber: '146',
        finish: 'nonfoil',
        cardId: 99,
      })
    }
    const cards = deck.sections[0]!.cards
    expect(cards).toHaveLength(2)
    const original = cards.find((c) => c.cardId === 5)!
    const split = cards.find((c) => c.cardId === 99)!
    expect(original.set).toBe('lea')
    expect(original.quantity).toBe(2)
    expect(split.set).toBe('m10')
    expect(split.quantity).toBe(2)
  })
})

describe('applyChangeToDeck — additional action coverage', () => {
  test('set-commander moves the card into a new Commander section (created if absent)', () => {
    const deck = makeDeck()
    const result = applyChangeToDeck(deck, {
      action: 'set-commander',
      cardName: 'Lightning Bolt',
      cardId: 5,
    })
    const commander = result.sections.find((s) => s.name === 'Commander')
    const main = result.sections.find((s) => s.name === 'Main')
    expect(commander).toBeDefined()
    expect(commander!.cards).toHaveLength(1)
    expect(commander!.cards[0]!.name).toBe('Lightning Bolt')
    expect(commander!.cards[0]!.cardId).toBe(5)
    expect(main!.cards).toHaveLength(0)
  })

  test('unset-commander moves the card from Commander back to Main', () => {
    const deck: DeckData = {
      name: 'Test Deck',
      sections: [
        {
          name: 'Commander',
          cards: [
            {
              quantity: 1,
              name: 'Kenrith',
              set: 'eld',
              collectorNumber: '303',
              cardId: 1,
            },
          ],
        },
        { name: 'Main', cards: [] },
      ],
    }
    const result = applyChangeToDeck(deck, {
      action: 'unset-commander',
      cardName: 'Kenrith',
      cardId: 1,
    })
    const commander = result.sections.find((s) => s.name === 'Commander')!
    const main = result.sections.find((s) => s.name === 'Main')!
    expect(commander.cards).toHaveLength(0)
    expect(main.cards).toHaveLength(1)
    expect(main.cards[0]!.name).toBe('Kenrith')
    expect(main.cards[0]!.cardId).toBe(1)
  })

  test('set-finish mutates the matching card finish in place', () => {
    const deck = makeDeck()
    const result = applyChangeToDeck(deck, {
      action: 'set-finish',
      cardName: 'Lightning Bolt',
      cardId: 5,
      finish: 'foil',
    })
    const card = result.sections[0]!.cards[0]!
    expect(card.finish).toBe('foil')
    expect(card.quantity).toBe(4)
  })

  test('set-note mutates the matching card note in place', () => {
    const deck = makeDeck()
    const result = applyChangeToDeck(deck, {
      action: 'set-note',
      cardName: 'Lightning Bolt',
      cardId: 5,
      note: 'burn spell',
    })
    expect(result.sections[0]!.cards[0]!.note).toBe('burn spell')
  })

  test('remove that drops quantity to zero deletes the entry entirely', () => {
    let deck = makeDeck()
    for (let i = 0; i < 4; i++) {
      deck = applyChangeToDeck(deck, { action: 'remove', cardName: 'Lightning Bolt', cardId: 5 })
    }
    expect(deck.sections[0]!.cards).toHaveLength(0)
  })

  test('remove of a card not in the deck is a no-op (no error, deck unchanged)', () => {
    const deck = makeDeck()
    const result = applyChangeToDeck(deck, {
      action: 'remove',
      cardName: 'Mana Crypt',
      cardId: 999,
    })
    expect(result.sections[0]!.cards).toHaveLength(1)
    expect(result.sections[0]!.cards[0]!.quantity).toBe(4)
  })

  test('set-finish on a card not in the deck is a no-op', () => {
    const deck = makeDeck()
    const result = applyChangeToDeck(deck, {
      action: 'set-finish',
      cardName: 'Mana Crypt',
      cardId: 999,
      finish: 'foil',
    })
    expect(result.sections[0]!.cards).toHaveLength(1)
    expect(result.sections[0]!.cards[0]!.finish).toBe('nonfoil')
  })
})
