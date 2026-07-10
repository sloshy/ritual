import { describe, expect, test } from 'bun:test'
import { formatChangeText, isAdditiveAction } from '../../../src/site/changelog-format'
import type { ChangelogAction, ChangelogChange } from '../../../src/changelog-parser'

type ChangeOverrides = Partial<ChangelogChange> & { action: ChangelogAction }

function change(overrides: ChangeOverrides): ChangelogChange {
  return { cardName: 'Lightning Bolt', ...overrides }
}

describe('formatChangeText', () => {
  test('Added — plain mainboard', () => {
    expect(formatChangeText(change({ action: 'Added' }))).toEqual({
      prefix: 'Added ',
      suffix: '',
    })
  })

  test('Added — with printing annotation', () => {
    expect(
      formatChangeText(
        change({ action: 'Added', set: 'lea', collectorNumber: '161', finish: 'foil' }),
      ),
    ).toEqual({ prefix: 'Added ', suffix: ' (LEA:161) [foil]' })
  })

  test('Added — to a non-main board', () => {
    expect(formatChangeText(change({ action: 'Added', board: 'Maybeboard' }))).toEqual({
      prefix: 'Added ',
      suffix: ' to Maybeboard',
    })
  })

  test('Removed — from a non-main board', () => {
    expect(formatChangeText(change({ action: 'Removed', board: 'Sideboard' }))).toEqual({
      prefix: 'Removed ',
      suffix: ' from Sideboard',
    })
  })

  test('Set as commander', () => {
    expect(formatChangeText(change({ action: 'Set as commander' }))).toEqual({
      prefix: 'Set ',
      suffix: ' as commander',
    })
  })

  test('Unset as commander', () => {
    expect(formatChangeText(change({ action: 'Unset as commander' }))).toEqual({
      prefix: 'Unset ',
      suffix: ' as commander',
    })
  })

  test('Set finish', () => {
    expect(formatChangeText(change({ action: 'Set finish', finish: 'etched' }))).toEqual({
      prefix: 'Set ',
      suffix: ' finish to etched',
    })
  })

  test('Set finish — defaults to nonfoil when missing', () => {
    expect(formatChangeText(change({ action: 'Set finish' }))).toEqual({
      prefix: 'Set ',
      suffix: ' finish to nonfoil',
    })
  })

  test('Set printing — includes set, collector number and finish', () => {
    expect(
      formatChangeText(
        change({ action: 'Set printing', set: 'm10', collectorNumber: '146', finish: 'foil' }),
      ),
    ).toEqual({
      prefix: 'Set ',
      suffix: ' printing to M10:146 [foil]',
    })
  })

  test('Set printing — renders "no specific printing" when set is absent', () => {
    expect(formatChangeText(change({ action: 'Set printing' }))).toEqual({
      prefix: 'Set ',
      suffix: ' printing to no specific printing',
    })
  })

  test('Set note — includes the note text', () => {
    expect(formatChangeText(change({ action: 'Set note', note: 'great vs aggro' }))).toEqual({
      prefix: 'Set note on ',
      suffix: ' to "great vs aggro"',
    })
  })

  test('Set note — preserves quotes in the note text', () => {
    expect(formatChangeText(change({ action: 'Set note', note: 'a "quoted" note' }))).toEqual({
      prefix: 'Set note on ',
      suffix: ' to "a "quoted" note"',
    })
  })

  test('Set note — empty note renders as a clear (mirrors formatChangeCore)', () => {
    expect(formatChangeText(change({ action: 'Set note', note: '' }))).toEqual({
      prefix: 'Cleared note on ',
      suffix: '',
    })
  })

  test('Cleared note', () => {
    expect(formatChangeText(change({ action: 'Cleared note' }))).toEqual({
      prefix: 'Cleared note on ',
      suffix: '',
    })
  })
})

describe('isAdditiveAction', () => {
  // 'Set as commander', 'Unset as commander', and 'Cleared note' are pinned end-to-end by
  // test/e2e/public-site/view-changes.spec.ts via changelog-change-item--remove class assertions.
  const additive: ChangelogAction[] = ['Added', 'Set finish', 'Set printing', 'Set note']
  const destructive: ChangelogAction[] = ['Removed']

  for (const action of additive) {
    test(`${action} is additive`, () => {
      expect(isAdditiveAction(action)).toBe(true)
    })
  }

  for (const action of destructive) {
    test(`${action} is destructive`, () => {
      expect(isAdditiveAction(action)).toBe(false)
    })
  }
})
