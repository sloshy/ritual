import { describe, expect, test } from 'bun:test'
import { createSignal } from 'solid-js'
import { applyChangeToDeck } from '../../src/changes/deck-changes'
import { applyDeckChangePrinting } from '../../src/editor/deck-config'
import type { ChangePrintingTools } from '../../src/editor/editor-config'
import type { DeckData } from '../../src/list/deck'
import { makeContextInfo } from '../test-utils'

type DecrementCall = Parameters<ChangePrintingTools['decrementCard']>
type AddCall = Parameters<ChangePrintingTools['addCard']>

/**
 * A partial "change printing" on a deck line splits copies off into a fresh
 * line. Those copies are the same cards in a new printing, so they keep the
 * line's label override and tags — in the recorded events and in the data.
 */
describe('applyDeckChangePrinting — partial split', () => {
  test('the split-off copies keep the line’s override, tags and section', () => {
    const deck: DeckData = {
      name: 'Proxies',
      sections: [
        {
          name: 'Sideboard',
          cards: [
            {
              quantity: 3,
              name: 'Sol Ring',
              set: 'c21',
              collectorNumber: '263',
              labels: ['proxy'],
              tags: ['Ramp'],
              cardId: 1,
            },
          ],
        },
      ],
    }
    const [data, setData] = createSignal<DeckData | null>(deck)
    const decrements: DecrementCall[] = []
    const adds: AddCall[] = []
    applyDeckChangePrinting({
      applyChange: (d, change, options) =>
        applyChangeToDeck(d, change, { ...options, listLabels: undefined }),
      data: deck,
      original: deck,
      target: makeContextInfo({
        cardName: 'Sol Ring',
        cardIds: [1],
        quantity: 3,
        set: 'c21',
        collectorNumber: '263',
      }),
      count: 1,
      options: { set: 'lea', collectorNumber: '270' },
      tools: {
        setPrinting: () => {
          throw new Error('a partial split never retargets in place')
        },
        decrementCard: (...args) => decrements.push(args),
        addCard: (...args) => adds.push(args),
        allocateId: () => 2,
      },
      setData,
    })

    expect(decrements).toEqual([['Sol Ring', 1, ['proxy'], ['Ramp']]])
    expect(adds).toEqual([
      [
        'Sol Ring',
        {
          set: 'lea',
          collectorNumber: '270',
          labels: ['proxy'],
          tags: ['Ramp'],
          section: 'Sideboard',
          cardId: 2,
        },
      ],
    ])
    // Both lines stay in the Sideboard the split came from.
    expect(data()?.sections.map((s) => s.name)).toEqual(['Sideboard'])
    expect(
      data()?.sections[0]?.cards.map((c) => [c.cardId, c.quantity, c.set, c.labels, c.tags]),
    ).toEqual([
      [1, 2, 'c21', ['proxy'], ['Ramp']],
      [2, 1, 'lea', ['proxy'], ['Ramp']],
    ])
  })
})
