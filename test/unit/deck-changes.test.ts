import { describe, test, expect } from 'bun:test'
import {
  areOppositeChanges,
  consolidateSetFinish,
  consolidateSetNote,
  consolidateSetPrinting,
  isAdditiveChange,
  isSamePrinting,
  createChangeId,
} from '../../src/change-event'
import { formatChange } from '../../src/change-message'
import type { AddChange, ChangeAction, ChangeEvent, ChangeInput } from '../../src/change-event'
import { applyChangeToDeck, findDeckAddMergeTargetId } from '../../src/editor/deck-changes'
import type { DeckData } from '../../src/types'
import { runMissMatrix, type MissMatrixCase } from '../test-utils'
import type { MissReason } from '../../src/editor/apply-batch'

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
  section?: string
  newSection?: string
  labels?: string[]
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

type OppositeChangesCase = [
  description: string,
  a: MakeChangeOverrides,
  b: MakeChangeOverrides,
  expected: boolean,
]

describe('areOppositeChanges', () => {
  const cases: OppositeChangesCase[] = [
    [
      'add + remove of same card returns true',
      { action: 'add', cardName: 'Sol Ring' },
      { action: 'remove', cardName: 'Sol Ring' },
      true,
    ],
    [
      'remove + add of same card returns true',
      { action: 'remove', cardName: 'Sol Ring' },
      { action: 'add', cardName: 'Sol Ring' },
      true,
    ],
    [
      'add + remove of different cards returns false',
      { action: 'add', cardName: 'Sol Ring' },
      { action: 'remove', cardName: 'Mana Crypt' },
      false,
    ],
    [
      'add + remove same card but different set returns false',
      { action: 'add', cardName: 'Sol Ring', set: '2XM' },
      { action: 'remove', cardName: 'Sol Ring', set: 'C21' },
      false,
    ],
    [
      'add + remove same card but different finish returns false',
      { action: 'add', cardName: 'Sol Ring', finish: 'foil' },
      { action: 'remove', cardName: 'Sol Ring', finish: 'nonfoil' },
      false,
    ],
    [
      'add + remove same card but different condition returns false',
      { action: 'add', cardName: 'Sol Ring', condition: 'NM' },
      { action: 'remove', cardName: 'Sol Ring', condition: 'LP' },
      false,
    ],
    [
      'add + add same card returns false (same action)',
      { action: 'add', cardName: 'Sol Ring' },
      { action: 'add', cardName: 'Sol Ring' },
      false,
    ],
    [
      'remove + remove same card returns false',
      { action: 'remove', cardName: 'Sol Ring' },
      { action: 'remove', cardName: 'Sol Ring' },
      false,
    ],
    [
      'set-commander + remove returns false (different action types)',
      { action: 'set-commander', cardName: 'Sol Ring' },
      { action: 'remove', cardName: 'Sol Ring' },
      false,
    ],
    [
      'set-commander + unset-commander of same card returns true',
      { action: 'set-commander', cardName: 'Sol Ring' },
      { action: 'unset-commander', cardName: 'Sol Ring' },
      true,
    ],
    [
      'unset-commander + set-commander of same card returns true',
      { action: 'unset-commander', cardName: 'Sol Ring' },
      { action: 'set-commander', cardName: 'Sol Ring' },
      true,
    ],
    [
      'set-commander + unset-commander of different cards returns false',
      { action: 'set-commander', cardName: 'Sol Ring' },
      { action: 'unset-commander', cardName: 'Mana Crypt' },
      false,
    ],
    [
      'set-commander + set-commander same card returns false (same action)',
      { action: 'set-commander', cardName: 'Sol Ring' },
      { action: 'set-commander', cardName: 'Sol Ring' },
      false,
    ],
    [
      'both with matching set/CN/finish/condition returns true',
      {
        action: 'add',
        cardName: 'Mana Crypt',
        set: '2XM',
        collectorNumber: '1',
        finish: 'foil',
        condition: 'LP',
      },
      {
        action: 'remove',
        cardName: 'Mana Crypt',
        set: '2XM',
        collectorNumber: '1',
        finish: 'foil',
        condition: 'LP',
      },
      true,
    ],
    [
      'one with set, other without returns false',
      { action: 'add', cardName: 'Sol Ring', set: '2XM', collectorNumber: '1' },
      { action: 'remove', cardName: 'Sol Ring' },
      false,
    ],
    [
      'same card with matching cardId cancels',
      { action: 'add', cardName: 'Sol Ring', cardId: 5 },
      { action: 'remove', cardName: 'Sol Ring', cardId: 5 },
      true,
    ],
    [
      'same card with different cardIds does not cancel',
      { action: 'add', cardName: 'Sol Ring', cardId: 5 },
      { action: 'remove', cardName: 'Sol Ring', cardId: 7 },
      false,
    ],
    [
      'one with cardId and one without still cancel (backwards compat)',
      { action: 'add', cardName: 'Sol Ring', cardId: 5 },
      { action: 'remove', cardName: 'Sol Ring' },
      true,
    ],
    [
      'commander changes with matching cardIds cancel',
      { action: 'set-commander', cardName: 'Kenrith', cardId: 1 },
      { action: 'unset-commander', cardName: 'Kenrith', cardId: 1 },
      true,
    ],
    [
      'commander changes with different cardIds do not cancel',
      { action: 'set-commander', cardName: 'Kenrith', cardId: 1 },
      { action: 'unset-commander', cardName: 'Kenrith', cardId: 2 },
      false,
    ],
    [
      'add to Sideboard + remove from Main (default) does not cancel',
      { action: 'add', cardName: 'Sol Ring', board: 'Sideboard' },
      { action: 'remove', cardName: 'Sol Ring' },
      false,
    ],
    // Labels are part of the card's identity: cancelling these would keep the
    // line that was there, override and all, and the re-add's would never land.
    [
      'a proxy re-add does not cancel the removal of a real copy',
      { action: 'add', cardName: 'Sol Ring', labels: ['proxy'] },
      { action: 'remove', cardName: 'Sol Ring' },
      false,
    ],
    [
      'a real re-add does not cancel the removal of a proxy copy',
      { action: 'add', cardName: 'Sol Ring' },
      { action: 'remove', cardName: 'Sol Ring', labels: ['proxy'] },
      false,
    ],
    [
      'add + remove under the same override cancel',
      { action: 'add', cardName: 'Sol Ring', labels: ['proxy'] },
      { action: 'remove', cardName: 'Sol Ring', labels: ['proxy'] },
      true,
    ],
    [
      'an empty override and none at all are the same thing',
      { action: 'add', cardName: 'Sol Ring', labels: [] },
      { action: 'remove', cardName: 'Sol Ring' },
      true,
    ],
    [
      'add + remove under different overrides do not cancel',
      { action: 'add', cardName: 'Sol Ring', labels: ['keep'] },
      { action: 'remove', cardName: 'Sol Ring', labels: ['proxy'] },
      false,
    ],
  ]

  test.each(cases)('%s', (_description, a, b, expected) => {
    expect(areOppositeChanges(makeChange(a), makeChange(b))).toBe(expected)
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
})

type FormatChangeCase = [description: string, change: MakeChangeOverrides, expected: string]

describe('formatChange', () => {
  const cases: FormatChangeCase[] = [
    [
      'includes card ID in add format',
      { action: 'add', cardName: 'Sol Ring', cardId: 5 },
      'Add Sol Ring &5',
    ],
    [
      'includes card ID with printing info',
      {
        action: 'add',
        cardName: 'Mana Crypt',
        set: '2xm',
        collectorNumber: '1',
        finish: 'foil',
        cardId: 42,
      },
      'Add Mana Crypt (2XM:1) [foil] &42',
    ],
    [
      'includes card ID for remove',
      { action: 'remove', cardName: 'Sol Ring', cardId: 3 },
      'Remove Sol Ring &3',
    ],
    [
      'includes card ID for set-commander',
      { action: 'set-commander', cardName: 'Kenrith', cardId: 1 },
      'Set Kenrith as commander &1',
    ],
    [
      'includes card ID for set-finish',
      { action: 'set-finish', cardName: 'Sol Ring', finish: 'foil', cardId: 7 },
      'Set Sol Ring finish to foil &7',
    ],
    ['omits card ID when undefined', { action: 'add', cardName: 'Sol Ring' }, 'Add Sol Ring'],
    [
      'formats set-note with the note text',
      { action: 'set-note', cardName: 'Sol Ring', note: 'starts the engine', cardId: 5 },
      'Set note on Sol Ring &5 to "starts the engine"',
    ],
    [
      'formats empty set-note as a clear',
      { action: 'set-note', cardName: 'Sol Ring', note: '', cardId: 5 },
      'Clear note on Sol Ring &5',
    ],
    [
      'formats set-printing with set, collector number and finish',
      {
        action: 'set-printing',
        cardName: 'Lightning Bolt',
        set: 'm10',
        collectorNumber: '146',
        finish: 'foil',
        cardId: 5,
      },
      'Set Lightning Bolt printing to M10:146 [foil] &5',
    ],
    [
      'formats set-printing with no specific printing',
      { action: 'set-printing', cardName: 'Lightning Bolt', cardId: 5 },
      'Set Lightning Bolt printing to no specific printing &5',
    ],
    [
      'formats move-from with destination list label',
      {
        action: 'move-from',
        cardName: 'Sol Ring',
        cardId: 5,
        to: { type: 'collection', name: 'Main' },
      },
      "Move Sol Ring &5 to Collection 'Main'",
    ],
    [
      'formats move-to with origin list label and printing annotation',
      {
        action: 'move-to',
        cardName: 'Lightning Bolt',
        set: 'm10',
        collectorNumber: '146',
        finish: 'foil',
        cardId: 7,
        from: { type: 'wanted', name: 'Burn' },
      },
      "Move Lightning Bolt (M10:146) [foil] &7 from Wanted list 'Burn'",
    ],
  ]

  test.each(cases)('%s', (_description, overrides, expected) => {
    expect(formatChange(makeChange(overrides))).toBe(expected)
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

  test('re-adding the same printing merges into the existing entry regardless of target section', () => {
    const deck = makeDeck()
    // findCardForAdd scans every section for a same-printing entry before consulting
    // change.section, so a Sideboard-targeted add merges into the Main entry.
    const result = applyChangeToDeck(deck, {
      action: 'add',
      cardName: 'Lightning Bolt',
      set: 'lea',
      collectorNumber: '161',
      finish: 'nonfoil',
      cardId: 99,
      section: 'Sideboard',
    })
    expect(result.sections.map((s) => s.name)).toEqual(['Main'])
    const cards = result.sections[0]!.cards
    expect(cards).toHaveLength(1)
    expect(cards[0]!.quantity).toBe(5)
  })

  test('add with a different language creates a separate entry (language is a variant dimension)', () => {
    const deck = makeDeck()
    // Same printing, but Japanese: must NOT merge into the English line.
    const result = applyChangeToDeck(deck, {
      action: 'add',
      cardName: 'Lightning Bolt',
      set: 'lea',
      collectorNumber: '161',
      finish: 'nonfoil',
      language: 'ja',
      cardId: 99,
    })
    const cards = result.sections[0]!.cards
    expect(cards).toHaveLength(2)
    expect(cards[0]!.quantity).toBe(4)
    expect(cards[1]!.language).toBe('ja')
    expect(cards[1]!.quantity).toBe(1)
  })

  test('add with the same language merges (missing folds to en on both sides)', () => {
    let deck = makeDeck()
    deck = applyChangeToDeck(deck, {
      action: 'add',
      cardName: 'Lightning Bolt',
      set: 'lea',
      collectorNumber: '161',
      finish: 'nonfoil',
      language: 'en',
    })
    const cards = deck.sections[0]!.cards
    expect(cards).toHaveLength(1)
    expect(cards[0]!.quantity).toBe(5)
  })

  test('set-language rewrites the card in place; en clears the stored value', () => {
    const deck = makeDeck()
    const toJa = applyChangeToDeck(deck, {
      action: 'set-language',
      cardName: 'Lightning Bolt',
      cardId: 5,
      language: 'ja',
    })
    expect(toJa.sections[0]!.cards[0]!.language).toBe('ja')

    const backToEn = applyChangeToDeck(toJa, {
      action: 'set-language',
      cardName: 'Lightning Bolt',
      cardId: 5,
      language: 'en',
    })
    // Cleared, matching what a re-parse of the bare serialized line yields.
    expect(backToEn.sections[0]!.cards[0]!.language).toBeUndefined()
  })

  test('set-language misses when no card matches', () => {
    const deck = makeDeck()
    let missed = ''
    applyChangeToDeck(
      deck,
      { action: 'set-language', cardName: 'Sol Ring', language: 'ja' },
      { onMiss: (reason) => (missed = reason) },
    )
    expect(missed).toBe('no-target')
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

  test('set-section moves the card to the named section, creating it when missing', () => {
    const deck = makeDeck()
    const result = applyChangeToDeck(deck, {
      action: 'set-section',
      cardName: 'Lightning Bolt',
      cardId: 5,
      section: 'Sideboard',
    })
    const main = result.sections.find((s) => s.name === 'Main')!
    const sideboard = result.sections.find((s) => s.name === 'Sideboard')!
    expect(main.cards).toHaveLength(0)
    expect(sideboard.cards).toHaveLength(1)
    expect(sideboard.cards[0]!.cardId).toBe(5)
    // The moved entry keeps its full line (quantity and printing travel with it).
    expect(sideboard.cards[0]!.quantity).toBe(4)
    expect(sideboard.cards[0]!.set).toBe('lea')
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

  test("set-note with empty string clears the existing note via noteOrUndefined('')", () => {
    // The application path runs `change.note` through `noteOrUndefined`, which
    // collapses '' to undefined so the field is removed from the card rather
    // than left as an empty string. Cleared notes are how the editor undoes
    // a previously-set note without a separate "clear-note" action.
    const deck = makeDeck()
    deck.sections[0]!.cards[0]!.note = 'burn spell'
    const result = applyChangeToDeck(deck, {
      action: 'set-note',
      cardName: 'Lightning Bolt',
      cardId: 5,
      note: '',
    })
    expect(result.sections[0]!.cards[0]!.note).toBeUndefined()
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

  test('move-from decrements one copy (behaves like remove)', () => {
    const deck = makeDeck()
    const result = applyChangeToDeck(deck, {
      action: 'move-from',
      cardName: 'Lightning Bolt',
      cardId: 5,
      set: 'lea',
      collectorNumber: '161',
      to: { type: 'collection', name: 'Binder' },
    })
    expect(result.sections[0]!.cards[0]!.quantity).toBe(3)
  })

  test('move-to adds the card with its printing (behaves like add)', () => {
    const deck = makeDeck()
    const result = applyChangeToDeck(deck, {
      action: 'move-to',
      cardName: 'Counterspell',
      set: 'lea',
      collectorNumber: '54',
      from: { type: 'deck', name: 'Other' },
    })
    const added = result.sections.flatMap((s) => s.cards).find((c) => c.name === 'Counterspell')
    expect(added).toBeDefined()
    expect(added!.set).toBe('lea')
    expect(added!.collectorNumber).toBe('54')
  })
})

describe('applyChangeToDeck — labels', () => {
  test('set-label writes the override; an empty set clears it', () => {
    const labeled = applyChangeToDeck(
      makeDeck(),
      makeChange({ action: 'set-label', cardName: 'Lightning Bolt', cardId: 5, labels: ['proxy'] }),
    )
    expect(labeled.sections[0]!.cards[0]!.labels).toEqual(['proxy'])

    const cleared = applyChangeToDeck(
      labeled,
      makeChange({ action: 'set-label', cardName: 'Lightning Bolt', cardId: 5, labels: [] }),
    )
    expect(cleared.sections[0]!.cards[0]!.labels).toBeUndefined()
  })

  test('an add carries its label override onto the new line', () => {
    const result = applyChangeToDeck(
      makeDeck(),
      makeChange({
        action: 'add',
        cardName: 'Sol Ring',
        set: 'ltc',
        collectorNumber: '284',
        labels: ['proxy'],
      }),
    )
    const added = result.sections[0]!.cards.find((c) => c.name === 'Sol Ring')!
    expect(added.labels).toEqual(['proxy'])
  })
})

describe('findDeckAddMergeTargetId', () => {
  /** The add an editing session builds: a freshly allocated id no line carries. */
  const addOf = (overrides: Partial<AddChange> = {}): ChangeInput => ({
    action: 'add',
    cardName: 'Lightning Bolt',
    set: 'lea',
    collectorNumber: '161',
    cardId: 99,
    ...overrides,
  })

  test('names the line the add merges into, whose id is not the one it carries', () => {
    const deck = makeDeck()
    const add = addOf()
    expect(findDeckAddMergeTargetId(deck, add)).toBe(5)
    // The reason it matters: the allocated `&99` reaches no card line, so
    // per-line metadata (custom art) aimed at it would be written for nothing.
    const result = applyChangeToDeck(deck, add)
    expect(result.sections[0]!.cards).toHaveLength(1)
    expect(result.sections[0]!.cards[0]!.quantity).toBe(5)
    expect(result.sections.flatMap((s) => s.cards).map((c) => c.cardId)).toEqual([5])
  })

  test('a printing the deck does not have starts its own line', () => {
    expect(
      findDeckAddMergeTargetId(makeDeck(), addOf({ set: 'm10', collectorNumber: '146' })),
    ).toBeUndefined()
  })

  test('a copy under a different label override starts its own line', () => {
    expect(findDeckAddMergeTargetId(makeDeck(), addOf({ labels: ['proxy'] }))).toBeUndefined()
  })

  test('a card the deck does not have starts its own line', () => {
    expect(findDeckAddMergeTargetId(makeDeck(), addOf({ cardName: 'Sol Ring' }))).toBeUndefined()
  })

  test('answers nothing for a change that is not an add', () => {
    expect(
      findDeckAddMergeTargetId(makeDeck(), {
        action: 'remove',
        cardName: 'Lightning Bolt',
        cardId: 5,
      }),
    ).toBeUndefined()
  })
})

describe('applyChangeToDeck — onMiss reporting', () => {
  const cases: MissMatrixCase<ChangeEvent>[] = [
    [
      'remove of an absent card misses',
      makeChange({ action: 'remove', cardName: 'Sol Ring' }),
      'no-target',
    ],
    [
      'remove with a wrong-case name misses (matching is case-sensitive)',
      makeChange({ action: 'remove', cardName: 'lightning bolt' }),
      'no-target',
    ],
    [
      'remove of a present card applies',
      makeChange({ action: 'remove', cardName: 'Lightning Bolt' }),
      null,
    ],
    [
      'remove by present cardId applies',
      makeChange({ action: 'remove', cardName: 'Wrong Name', cardId: 5 }),
      null,
    ],
    [
      // Documents the deliberate targeting fallback: a stale cardId with a
      // valid name resolves by name rather than missing.
      'remove with a stale cardId and a valid name applies via the name tier',
      makeChange({ action: 'remove', cardName: 'Lightning Bolt', cardId: 999 }),
      null,
    ],
    [
      'set-label on an absent card misses',
      makeChange({ action: 'set-label', cardName: 'Sol Ring', labels: ['proxy'] }),
      'no-target',
    ],
    [
      'set-label on a present card applies',
      makeChange({ action: 'set-label', cardName: 'Lightning Bolt', labels: ['proxy'] }),
      null,
    ],
    [
      'set-note on an absent card misses',
      makeChange({ action: 'set-note', cardName: 'Sol Ring', note: 'x' }),
      'no-target',
    ],
    [
      'set-finish on an absent card misses',
      makeChange({ action: 'set-finish', cardName: 'Sol Ring', finish: 'foil' }),
      'no-target',
    ],
    [
      'set-printing on an absent card misses',
      makeChange({
        action: 'set-printing',
        cardName: 'Sol Ring',
        set: 'c21',
        collectorNumber: '1',
      }),
      'no-target',
    ],
    [
      'set-section on an absent card misses',
      makeChange({ action: 'set-section', cardName: 'Sol Ring', section: 'Sideboard' }),
      'no-target',
    ],
    [
      'set-commander on an absent card misses',
      makeChange({ action: 'set-commander', cardName: 'Sol Ring' }),
      'no-target',
    ],
    [
      'set-commander on a present card applies',
      makeChange({ action: 'set-commander', cardName: 'Lightning Bolt' }),
      null,
    ],
    [
      // set-commander targets by cardId alone when one is given; a stale id
      // with a valid name must MISS, not silently succeed via a name fallback
      // the move itself never uses.
      'set-commander with a stale cardId misses even when the name matches',
      makeChange({ action: 'set-commander', cardName: 'Lightning Bolt', cardId: 999 }),
      'no-target',
    ],
    [
      // Idempotence: the card exists and is already not a commander (there is
      // no commander section at all) — the requested end state already holds.
      'unset-commander on an existing non-commander card is an idempotent success',
      makeChange({ action: 'unset-commander', cardName: 'Lightning Bolt' }),
      null,
    ],
    [
      'unset-commander on an absent card misses',
      makeChange({ action: 'unset-commander', cardName: 'Sol Ring' }),
      'no-target',
    ],
    [
      'move-from of an absent card misses',
      makeChange({ action: 'move-from', cardName: 'Sol Ring', to: { type: 'wanted', name: 'w' } }),
      'no-target',
    ],
    ['add never misses', makeChange({ action: 'add', cardName: 'Sol Ring' }), null],
    [
      // Section-structural actions are documented as outside the miss contract.
      'rename-section of an absent section is not reported',
      makeChange({
        action: 'rename-section',
        cardName: '',
        section: 'Nope',
        newSection: 'Also Nope',
      }),
      null,
    ],
    [
      'remove-section of a non-empty section is a silent safety refusal',
      makeChange({ action: 'remove-section', cardName: '', section: 'Main' }),
      null,
    ],
  ]

  runMissMatrix(applyChangeToDeck, makeDeck, cases)

  describe('set-finish needs a printing', () => {
    const nameOnlyDeck = (): DeckData => ({
      name: 'Test Deck',
      sections: [{ name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring', cardId: 9 }] }],
    })

    test('refuses foil on a line that pins no printing', () => {
      const deck = nameOnlyDeck()
      const seen: { reason: MissReason | null } = { reason: null }
      const result = applyChangeToDeck(
        deck,
        makeChange({ action: 'set-finish', cardName: 'Sol Ring', cardId: 9, finish: 'foil' }),
        { onMiss: (reason) => (seen.reason = reason) },
      )
      expect(seen.reason).toBe('needs-printing')
      expect(result.sections[0]!.cards[0]!.finish).toBeUndefined()
    })

    test('accepts foil once an earlier change in the batch pinned the printing', () => {
      let deck = nameOnlyDeck()
      const misses: MissReason[] = []
      const onMiss = { onMiss: (reason: MissReason) => misses.push(reason) }
      deck = applyChangeToDeck(
        deck,
        makeChange({
          action: 'set-printing',
          cardName: 'Sol Ring',
          cardId: 9,
          set: 'c19',
          collectorNumber: '221',
        }),
        onMiss,
      )
      deck = applyChangeToDeck(
        deck,
        makeChange({ action: 'set-finish', cardName: 'Sol Ring', cardId: 9, finish: 'foil' }),
        onMiss,
      )
      expect(misses).toEqual([])
      expect(deck.sections[0]!.cards[0]!.finish).toBe('foil')
    })

    test('refuses a set-printing that writes foil while clearing the printing', () => {
      // The one-field back door: set-printing writes the finish AND the printing,
      // so an omitted set/collector number would unpin the line while stamping
      // `[foil]` — exactly the state set-finish is refused for.
      const deck: DeckData = {
        name: 'Test Deck',
        sections: [
          {
            name: 'Main',
            cards: [
              { quantity: 1, name: 'Sol Ring', set: 'c19', collectorNumber: '221', cardId: 9 },
            ],
          },
        ],
      }
      const seen: { reason: MissReason | null } = { reason: null }
      const result = applyChangeToDeck(
        deck,
        makeChange({ action: 'set-printing', cardName: 'Sol Ring', cardId: 9, finish: 'foil' }),
        { onMiss: (reason) => (seen.reason = reason) },
      )
      expect(seen.reason).toBe('needs-printing')
      expect(result.sections[0]!.cards[0]!.set).toBe('c19')
      expect(result.sections[0]!.cards[0]!.finish).toBeUndefined()
    })

    test('allows a set-printing that clears the printing and the finish together', () => {
      const deck: DeckData = {
        name: 'Test Deck',
        sections: [
          {
            name: 'Main',
            cards: [
              {
                quantity: 1,
                name: 'Sol Ring',
                set: 'c19',
                collectorNumber: '221',
                finish: 'foil',
                cardId: 9,
              },
            ],
          },
        ],
      }
      const seen: { reason: MissReason | null } = { reason: null }
      const result = applyChangeToDeck(
        deck,
        makeChange({ action: 'set-printing', cardName: 'Sol Ring', cardId: 9 }),
        { onMiss: (reason) => (seen.reason = reason) },
      )
      expect(seen.reason).toBeNull()
      expect(result.sections[0]!.cards[0]!.set).toBeUndefined()
      expect(result.sections[0]!.cards[0]!.finish).toBeUndefined()
    })

    test('still clears a name-only line back to nonfoil', () => {
      const deck = nameOnlyDeck()
      deck.sections[0]!.cards[0]!.finish = 'foil'
      const seen: { reason: MissReason | null } = { reason: null }
      const result = applyChangeToDeck(
        deck,
        makeChange({ action: 'set-finish', cardName: 'Sol Ring', cardId: 9, finish: 'nonfoil' }),
        { onMiss: (reason) => (seen.reason = reason) },
      )
      expect(seen.reason).toBeNull()
      expect(result.sections[0]!.cards[0]!.finish).toBe('nonfoil')
    })
  })

  test('set-commander on a card already in the commander section is an idempotent success', () => {
    const deck: DeckData = {
      name: 'Test Deck',
      sections: [{ name: 'Commander', cards: [{ quantity: 1, name: 'Atraxa', cardId: 1 }] }],
    }
    let missed = false
    const result = applyChangeToDeck(
      deck,
      makeChange({ action: 'set-commander', cardName: 'Atraxa' }),
      { onMiss: () => (missed = true) },
    )
    expect(missed).toBe(false)
    // The card stays in the commander section — no move, no new section.
    expect(result.sections).toEqual(deck.sections)
  })

  test('unset-commander on a non-commander card with a commander section present is idempotent', () => {
    const deck: DeckData = {
      name: 'Test Deck',
      sections: [
        { name: 'Commander', cards: [{ quantity: 1, name: 'Atraxa', cardId: 1 }] },
        { name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring', cardId: 2 }] },
      ],
    }
    let missed = false
    const result = applyChangeToDeck(
      deck,
      makeChange({ action: 'unset-commander', cardName: 'Sol Ring' }),
      { onMiss: () => (missed = true) },
    )
    expect(missed).toBe(false)
    // Atraxa keeps the command zone; Sol Ring stays where it was.
    expect(result.sections).toEqual(deck.sections)
  })
})
