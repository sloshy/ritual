import { describe, expect, test } from 'bun:test'
import {
  joinSentences,
  prunedCategoriesMessage,
  prunedCategoriesSentence,
  saveNoticeSentences,
} from '../../../src/editor/save-notices'
import { droppedNotesSentence } from '../../../src/list/dropped-notes'
import { en } from '../../../src/i18n/messages/en'
import { withSyntheticLocale } from '../../helpers/sync-text'

describe('prunedCategoriesSentence', () => {
  test('is null when the save pruned nothing', () => {
    expect(prunedCategoriesSentence([])).toBeNull()
  })

  // The caller must pass `count` as well as `items`: `t()` throws in strict mode
  // when the numeric plural parameter is missing, which no compiler catches.
  test('renders the singular for one name and the plural for two', () => {
    expect(prunedCategoriesSentence(['Sol Ring'])).toBe(
      'Categories dropped for a card the list no longer holds: Sol Ring.',
    )
    expect(prunedCategoriesSentence(['Sol Ring', 'Rhystic Study'])).toBe(
      'Categories dropped for cards the list no longer holds: Sol Ring, Rhystic Study.',
    )
  })

  test("lists the names the reader's way", () => {
    const names = ['Sol Ring', 'Rhystic Study', 'Mana Crypt']
    const german = withSyntheticLocale('de', {}, () => prunedCategoriesSentence(names))
    expect(german).toContain('Sol Ring, Rhystic Study und Mana Crypt')
  })
})

describe('prunedCategoriesMessage', () => {
  test('lists the names in English beside its English message, whatever the locale', () => {
    const names = ['Sol Ring', 'Rhystic Study', 'Mana Crypt']
    const message = withSyntheticLocale('de', {}, () => prunedCategoriesMessage(names))
    expect(message?.messageParams?.items).toBe('Sol Ring, Rhystic Study, Mana Crypt')
  })
})

describe('droppedNotesSentence', () => {
  const notes = [
    { cardName: 'Sol Ring', note: 'from trade' },
    { cardName: 'Mana Crypt', note: 'signed' },
    { cardName: 'Island', note: 'alt art' },
  ]

  test('names each card with its dropped note, singular for one', () => {
    expect(droppedNotesSentence([])).toBeNull()
    expect(droppedNotesSentence(notes.slice(0, 1))).toBe(
      'Note dropped on merge: Sol Ring ("from trade").',
    )
  })

  test('lists two and three in the plural', () => {
    expect(droppedNotesSentence(notes.slice(0, 2))).toBe(
      'Notes dropped on merge: Sol Ring ("from trade"), Mana Crypt ("signed").',
    )
    expect(droppedNotesSentence(notes)).toBe(
      'Notes dropped on merge: Sol Ring ("from trade"), Mana Crypt ("signed"), Island ("alt art").',
    )
  })

  test("lists them the reader's way", () => {
    const german = withSyntheticLocale('de', {}, () => droppedNotesSentence(notes))
    expect(german).toContain('Mana Crypt ("signed") und Island ("alt art")')
  })
})

describe('saveNoticeSentences', () => {
  test('is empty for a save with nothing to report', () => {
    expect(saveNoticeSentences({})).toEqual([])
  })

  test('orders dropped notes, pruned categories, then server warnings', () => {
    const sentences = saveNoticeSentences({
      droppedNotes: [{ cardName: 'Sol Ring', note: 'from trade' }],
      prunedCategories: ['Rhystic Study'],
      categoryWarnings: ['Categories sidecar could not be read: bad JSON'],
    })
    expect(sentences).toEqual([
      'Note dropped on merge: Sol Ring ("from trade").',
      'Categories dropped for a card the list no longer holds: Rhystic Study.',
      'Categories sidecar could not be read: bad JSON',
    ])
  })
})

describe('joinSentences', () => {
  test('runs sentences together with the catalog separator', () => {
    expect(joinSentences([])).toBe('')
    expect(joinSentences(['One.'])).toBe('One.')
    expect(joinSentences(['One.', 'Two.', 'Three.'])).toBe('One. Two. Three.')
  })

  test('takes its separator from the active locale', () => {
    const joined = withSyntheticLocale('ja', { 'ui.text.sentenceJoin': '{first}{second}' }, () =>
      joinSentences(['一。', '二。']),
    )
    expect(joined).toBe('一。二。')
    expect(en['ui.text.sentenceJoin']).toBe('{first} {second}')
  })
})
