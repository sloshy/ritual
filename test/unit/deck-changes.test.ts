import { describe, test, expect } from 'bun:test'
import {
  areOppositeChanges,
  isAdditiveChange,
  createChangeId,
  formatChange,
} from '../../src/change-event'
import type { ChangeEvent, AddChange, RemoveChange } from '../../src/change-event'

/** Test helper — builds a ChangeEvent with add-change defaults.
 *  Uses assertion since overrides may switch to a different union branch. */
function makeChange(
  overrides: Record<string, unknown> & { action: string; cardName: string },
): ChangeEvent {
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
    const a = makeChange({ action: 'add', cardName: 'Sol Ring' }) as AddChange
    const b = makeChange({ action: 'remove', cardName: 'Sol Ring' }) as RemoveChange
    expect(a.set).toBeUndefined()
    expect(b.set).toBeUndefined()
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
    expect(a.cardId).toBeUndefined()
    expect(b.cardId).toBeUndefined()
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
})

describe('isAdditiveChange', () => {
  test('add is additive', () => {
    expect(isAdditiveChange('add')).toBe(true)
  })

  test('set-commander is additive', () => {
    expect(isAdditiveChange('set-commander')).toBe(true)
  })

  test('set-finish is additive', () => {
    expect(isAdditiveChange('set-finish')).toBe(true)
  })

  test('remove is not additive', () => {
    expect(isAdditiveChange('remove')).toBe(false)
  })

  test('unset-commander is not additive', () => {
    expect(isAdditiveChange('unset-commander')).toBe(false)
  })
})

describe('createChangeId', () => {
  test('returns a string', () => {
    const id = createChangeId()
    expect(typeof id).toBe('string')
  })

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
})
