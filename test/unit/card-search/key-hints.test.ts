import { describe, expect, test } from 'bun:test'
import { keyHintsFor, type CardSearchHintFlags } from '../../../src/editor/card-search/key-hints'

const add: CardSearchHintFlags = {
  step: 'finish-condition',
  isAddFlow: true,
  usesQuantity: true,
  canAddAnother: true,
}

/** Each hint as `[chips, label]`, so a row pins the keys advertised as well as the wording. */
const hints = (flags: CardSearchHintFlags): [string, string][] =>
  keyHintsFor(flags).map((h) => [h.keys.join(' '), h.label])

describe('keyHintsFor', () => {
  test('each step advertises its own navigation', () => {
    expect(hints({ ...add, step: 'search' })).toEqual([
      ['↑ ↓', 'ui.hint.navigate'],
      ['Enter', 'ui.hint.select'],
      ['Esc', 'ui.hint.close'],
    ])
    expect(hints({ ...add, step: 'printing' })).toEqual([
      ['← →', 'ui.hint.printing'],
      ['↑ ↓', 'ui.hint.row'],
      ['A–Z 0–9', 'ui.hint.filterPrintings'],
      ['Enter', 'ui.hint.select'],
      ['Esc', 'ui.hint.close'],
    ])
    expect(hints({ ...add, step: 'language-notice' })).toEqual([
      ['Enter', 'ui.hint.continue'],
      ['Esc', 'ui.hint.close'],
    ])
  })

  test('the finish step in the add flow offers quantity and add-another', () => {
    expect(hints(add)).toEqual([
      ['← →', 'ui.hint.choose'],
      ['↑ ↓ Tab', 'ui.hint.nextGroup'],
      ['+ -', 'ui.hint.quantity'],
      ['Enter', 'ui.hint.addCard'],
      ['Ctrl Enter', 'ui.hint.addAnother'],
      ['Esc', 'ui.hint.close'],
    ])
  })

  test('change-printing mode updates one card: no quantity, no add-another', () => {
    expect(hints({ ...add, isAddFlow: false, usesQuantity: false, canAddAnother: false })).toEqual([
      ['← →', 'ui.hint.choose'],
      ['↑ ↓ Tab', 'ui.hint.nextGroup'],
      ['Enter', 'ui.hint.updateCard'],
      ['Esc', 'ui.hint.close'],
    ])
  })

  test('each flag flips exactly its own hint', () => {
    expect(hints({ ...add, isAddFlow: false })).toContainEqual(['Enter', 'ui.hint.updateCard'])
    expect(hints({ ...add, isAddFlow: false })).not.toContainEqual(['Enter', 'ui.hint.addCard'])

    const noQuantity = hints({ ...add, usesQuantity: false })
    expect(noQuantity).not.toContainEqual(['+ -', 'ui.hint.quantity'])
    expect(noQuantity).toContainEqual(['Ctrl Enter', 'ui.hint.addAnother'])

    const noAnother = hints({ ...add, canAddAnother: false })
    expect(noAnother).not.toContainEqual(['Ctrl Enter', 'ui.hint.addAnother'])
    expect(noAnother).toContainEqual(['+ -', 'ui.hint.quantity'])
  })
})
