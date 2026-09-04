import { describe, expect, test } from 'bun:test'
import {
  applyCardTagsEdit,
  bulkAddTags,
  tagEditInputs,
  tagSuggestions,
} from '../../src/editor/card-tags-edit'
import { closeTagsPrompt, pendingTagsPrompt } from '../../src/editor/tags-prompt'
import type { CardTag } from '../../src/card/card-tags'
import { useCardChanges } from '../../src/editor/useCardChanges'
import { applyChangeToCollection } from '../../src/changes/collection-changes'
import type { CollectionCardEntry } from '../../src/list/site-data'
import { makeCollectionEntry } from '../test-utils'

/**
 * The shared body behind "Edit Tags…": the live-data inputs a tag edit turns
 * into, the suggestion set, and the whole gesture applied to a collection
 * session (events recorded, entries updated) through the real apply engine.
 */
describe('tagEditInputs', () => {
  test('one add-tag per new tag and one remove-tag per dropped tag, canonical order', () => {
    expect(
      tagEditInputs({
        cardName: 'Sol Ring',
        cardId: 3,
        tags: ['staple', ' alpha', 'ramp'],
        currentTags: ['ramp', 'old', 'zed'],
      }),
    ).toMatchObject([
      { action: 'add-tag', cardName: 'Sol Ring', tag: 'alpha', cardId: 3 },
      { action: 'add-tag', cardName: 'Sol Ring', tag: 'staple', cardId: 3 },
      { action: 'remove-tag', cardName: 'Sol Ring', tag: 'old', cardId: 3 },
      { action: 'remove-tag', cardName: 'Sol Ring', tag: 'zed', cardId: 3 },
    ])
  })

  test('an unchanged set yields nothing to apply', () => {
    expect(tagEditInputs({ cardName: 'Sol Ring', tags: ['ramp'], currentTags: ['ramp'] })).toEqual(
      [],
    )
  })
})

describe('tagSuggestions', () => {
  test('is the canonical union of every entry tag set', () => {
    expect(tagSuggestions([{ tags: ['ramp', 'staple'] }, {}, { tags: ['draw', 'ramp'] }])).toEqual([
      'draw',
      'ramp',
      'staple',
    ])
  })
})

describe('applyCardTagsEdit', () => {
  test('records the events and updates the live entry in one gesture', () => {
    const changes = useCardChanges<CollectionCardEntry>()
    let data: CollectionCardEntry[] | null = [
      makeCollectionEntry({ name: 'Sol Ring', cardId: 1, tags: ['old'] }),
      // A second copy of the same name: only a `cardId`-targeted edit leaves it alone.
      makeCollectionEntry({ name: 'Sol Ring', cardId: 2, tags: ['old'] }),
    ]
    const session = {
      changes,
      setData: ((update: (prev: CollectionCardEntry[] | null) => CollectionCardEntry[] | null) => {
        data = update(data)
        return data
      }) as unknown as import('solid-js').Setter<CollectionCardEntry[] | null>,
      applyChange: applyChangeToCollection,
    }

    applyCardTagsEdit(session, {
      cardName: 'Sol Ring',
      cardId: 1,
      tags: ['ramp'],
      currentTags: ['old'],
    })

    expect(changes.changes().map((c) => c.action)).toEqual(['add-tag', 'remove-tag'])
    expect(data?.[0]?.tags).toEqual(['ramp'])
    // The edit is per copy: the same-named other line keeps its tags.
    expect(data?.[1]?.tags).toEqual(['old'])

    // Reverting within the session cancels both pending events and clears the tag.
    applyCardTagsEdit(session, {
      cardName: 'Sol Ring',
      cardId: 1,
      tags: ['old'],
      currentTags: ['ramp'],
    })
    expect(changes.changes()).toHaveLength(0)
    expect(data?.[0]?.tags).toEqual(['old'])
  })
})

/** One `setTags` call the bulk add made, as the controller's setter would see it. */
type SetTagsCall = {
  cardName: string
  tags: readonly CardTag[]
  currentTags: readonly CardTag[] | undefined
  cardId: number | undefined
}

describe('bulkAddTags', () => {
  test("opens the dialog in add mode and unions onto each target's live tags on save", () => {
    const calls: SetTagsCall[] = []
    let applied = 0
    bulkAddTags({
      suggestions: ['ramp', 'staple'],
      targets: [
        { cardName: 'Sol Ring', cardId: 1 },
        { cardName: 'Mox Opal', cardId: 3 },
        // A card added this session, with no `&N` yet.
        { cardName: 'New Card' },
      ],
      liveTagsOf: (_name, cardId) => {
        if (cardId === 1) return ['ramp']
        if (cardId === 3) return ['Signed']
        return undefined
      },
      setTags: (cardName, tags, currentTags, cardId) =>
        calls.push({ cardName, tags, currentTags, cardId }),
      onApplied: () => applied++,
    })

    const prompt = pendingTagsPrompt()
    expect(prompt?.mode).toBe('add')
    expect(prompt?.current).toBeUndefined()
    expect(prompt?.suggestions).toEqual(['ramp', 'staple'])
    // Nothing is applied — and the selection is not cleared — until a save.
    expect(calls).toHaveLength(0)
    expect(applied).toBe(0)

    prompt?.onSave(['Signed', 'ramp'])
    // Each target's own live set is the baseline, and a tag it already has is
    // kept rather than doubled; the union is canonical.
    expect(calls).toEqual([
      { cardName: 'Sol Ring', tags: ['ramp', 'Signed'], currentTags: ['ramp'], cardId: 1 },
      { cardName: 'Mox Opal', tags: ['ramp', 'Signed'], currentTags: ['Signed'], cardId: 3 },
      { cardName: 'New Card', tags: ['ramp', 'Signed'], currentTags: undefined, cardId: undefined },
    ])
    expect(calls[2]?.cardId).toBeUndefined()
    expect(applied).toBe(1)
    closeTagsPrompt()
  })
})
