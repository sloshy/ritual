import { describe, test, expect } from 'bun:test'
import { areOppositeChanges, isAdditiveChange, createChangeId } from '../../src/change-event'
import type { ChangeEvent } from '../../src/change-event'

function makeChange(
  overrides: Partial<ChangeEvent> & Pick<ChangeEvent, 'action' | 'cardName'>,
): ChangeEvent {
  return {
    id: createChangeId(),
    timestamp: Date.now(),
    ...overrides,
  }
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
    expect(a.set).toBeUndefined()
    expect(b.set).toBeUndefined()
    expect(areOppositeChanges(a, b)).toBe(true)
  })

  test('one with set, other without returns false', () => {
    const a = makeChange({ action: 'add', cardName: 'Sol Ring', set: '2XM', collectorNumber: '1' })
    const b = makeChange({ action: 'remove', cardName: 'Sol Ring' })
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
