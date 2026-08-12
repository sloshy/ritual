import { describe, expect, test } from 'bun:test'
import {
  areOppositeChanges,
  consolidateSetLanguage,
  createAddChange,
  createRemoveChange,
  createSetLanguageChange,
  createSetPrintingChange,
  formatChangeCore,
  formatPrintingAnnotation,
  isAdditiveChange,
  isSamePrinting,
  CHANGE_ACTIONS,
} from '../../src/change-event'
import { formatChange } from '../../src/change-message'

describe('set-language change events', () => {
  test('createSetLanguageChange carries the language and targeting fields', () => {
    const change = createSetLanguageChange('Sol Ring', { language: 'ja', cardId: 5 })
    expect(change.action).toBe('set-language')
    expect(change.language).toBe('ja')
    expect(change.cardName).toBe('Sol Ring')
    expect(change.cardId).toBe(5)
  })

  test('set-language is a registered, additive action', () => {
    expect(CHANGE_ACTIONS).toContain('set-language')
    expect(isAdditiveChange('set-language')).toBe(true)
  })

  test('formats as `Set language of X to <display name>`', () => {
    const change = createSetLanguageChange('Sol Ring', { language: 'ja', cardId: 5 })
    expect(formatChange(change)).toBe('Set language of Sol Ring to Japanese &5')
    expect(formatChangeCore(change, { tense: 'past', quoteCardName: true })).toBe(
      'Set language of "Sol Ring" to Japanese &5',
    )
  })

  test('add/remove/set-printing creators thread the language option through', () => {
    expect(createAddChange('Sol Ring', { language: 'ja' }).language).toBe('ja')
    expect(createRemoveChange('Sol Ring', { language: 'ja' }).language).toBe('ja')
    expect(createSetPrintingChange('Sol Ring', { set: 'neo', language: 'ja' }).language).toBe('ja')
    // Omitted stays omitted — a bare add means English.
    expect(createAddChange('Sol Ring').language).toBeUndefined()
  })
})

describe('isSamePrinting case fold', () => {
  test('collector numbers compare case-insensitively, like set codes', () => {
    // A printing is identified case-insensitively project-wide (printingKey):
    // (MKM:507A) and (mkm:507a) are the same printing.
    expect(
      isSamePrinting(
        { set: 'MKM', collectorNumber: '507A' },
        { set: 'mkm', collectorNumber: '507a' },
      ),
    ).toBe(true)
  })
})

describe('isSamePrinting language fold', () => {
  test('a missing language means en on both sides', () => {
    expect(
      isSamePrinting(
        { set: 'neo', collectorNumber: '234' },
        { set: 'neo', collectorNumber: '234', language: 'en' },
      ),
    ).toBe(true)
  })

  test('a differing language is a different printing variant', () => {
    expect(
      isSamePrinting(
        { set: 'neo', collectorNumber: '234', language: 'ja' },
        { set: 'neo', collectorNumber: '234' },
      ),
    ).toBe(false)
    expect(
      isSamePrinting(
        { set: 'neo', collectorNumber: '234', language: 'ja' },
        { set: 'neo', collectorNumber: '234', language: 'ja' },
      ),
    ).toBe(true)
  })
})

describe('areOppositeChanges language', () => {
  test('an add and remove differing only by language do not cancel', () => {
    const add = createAddChange('Sol Ring', { set: 'neo', collectorNumber: '234', language: 'ja' })
    const remove = createRemoveChange('Sol Ring', { set: 'neo', collectorNumber: '234' })
    expect(areOppositeChanges(add, remove)).toBe(false)
  })

  test('a bare add cancels an explicit-en remove', () => {
    const add = createAddChange('Sol Ring', { set: 'neo', collectorNumber: '234' })
    const remove = createRemoveChange('Sol Ring', {
      set: 'neo',
      collectorNumber: '234',
      language: 'en',
    })
    expect(areOppositeChanges(add, remove)).toBe(true)
  })
})

describe('formatPrintingAnnotation language token', () => {
  test('annotates a non-en language after finish/condition', () => {
    expect(
      formatPrintingAnnotation({
        set: 'neo',
        collectorNumber: '234',
        finish: 'foil',
        condition: 'LP',
        language: 'ja',
      }),
    ).toBe(' (NEO:234) [foil] [LP] [ja]')
  })

  test('omits the token for en or absent language', () => {
    expect(formatPrintingAnnotation({ set: 'neo', collectorNumber: '234', language: 'en' })).toBe(
      ' (NEO:234)',
    )
    expect(formatPrintingAnnotation({ set: 'neo', collectorNumber: '234' })).toBe(' (NEO:234)')
  })

  test('set-printing description carries the language token', () => {
    const change = createSetPrintingChange('Sol Ring', {
      set: 'neo',
      collectorNumber: '234',
      language: 'ja',
      cardId: 3,
    })
    expect(formatChange(change)).toBe('Set Sol Ring printing to NEO:234 [ja] &3')
  })
})

describe('consolidateSetLanguage', () => {
  test('adds the change when the language differs from the original', () => {
    const result = consolidateSetLanguage([], 'Sol Ring', 'ja', undefined, 5)
    expect(result.addedChange?.action).toBe('set-language')
    expect(result.changes).toHaveLength(1)
    expect(result.cancelledChange).toBeNull()
  })

  test('replaces a pending set-language for the same card (latest wins)', () => {
    const first = createSetLanguageChange('Sol Ring', { language: 'ja', cardId: 5 })
    const result = consolidateSetLanguage([first], 'Sol Ring', 'de', 'fr', 5)
    expect(result.cancelledChange).toBe(first)
    expect(result.changes).toHaveLength(1)
    expect(result.changes[0]?.action).toBe('set-language')
    if (result.changes[0]?.action === 'set-language') {
      expect(result.changes[0].language).toBe('de')
    }
  })

  test('restoring the original language drops the pending change without adding one', () => {
    const first = createSetLanguageChange('Sol Ring', { language: 'ja', cardId: 5 })
    // The original was a bare (en) line; en folds equal to undefined.
    const result = consolidateSetLanguage([first], 'Sol Ring', 'en', undefined, 5)
    expect(result.cancelledChange).toBe(first)
    expect(result.addedChange).toBeNull()
    expect(result.changes).toHaveLength(0)
  })
})
