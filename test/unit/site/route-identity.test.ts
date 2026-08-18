import { describe, expect, test } from 'bun:test'
import { routeIdentity, type Route } from '../../../src/site/useRouting'

/**
 * `routeIdentity` decides two things at once: whether the page fades and scrolls
 * to the top, and whether the open dialogs (card modal, quick switch, combine)
 * are torn down. Both directions matter — an identity that is too coarse leaves
 * a modal open across a real navigation, and one that is too fine closes it when
 * a toolbar control merely mirrors itself into the hash.
 */
const SAME: [string, Route, Route][] = [
  [
    'a deck and the same deck with its primer open',
    { page: 'deck', slug: 'alpha' },
    { page: 'deck', slug: 'alpha', primerOpen: true, sectionId: 'Main' },
  ],
  [
    'the same combined view parsed twice',
    { page: 'combined', all: false, refs: [{ type: 'deck', slug: 'alpha' }] },
    { page: 'combined', all: false, refs: [{ type: 'deck', slug: 'alpha' }] },
  ],
  ['the trade page', { page: 'trade' }, { page: 'trade' }],
]

const DIFFERENT: [string, Route, Route][] = [
  ['two decks', { page: 'deck', slug: 'alpha' }, { page: 'deck', slug: 'beta' }],
  [
    'a deck and a collection of the same slug',
    { page: 'deck', slug: 'alpha' },
    { page: 'collection', slug: 'alpha' },
  ],
  ['two index tabs', { page: 'index', tab: 'decks' }, { page: 'index', tab: 'collections' }],
  [
    'combined views over different lists',
    { page: 'combined', all: false, refs: [{ type: 'deck', slug: 'alpha' }] },
    { page: 'combined', all: false, refs: [{ type: 'deck', slug: 'beta' }] },
  ],
  [
    'a combined view of everything versus one of a single list',
    { page: 'combined', all: true, refs: [] },
    { page: 'combined', all: false, refs: [{ type: 'deck', slug: 'alpha' }] },
  ],
  [
    'all decks versus all collections',
    { page: 'combined', all: true, allType: 'deck', refs: [] },
    { page: 'combined', all: true, allType: 'collection', refs: [] },
  ],
  ['trade and find', { page: 'trade' }, { page: 'find' }],
]

describe('routeIdentity', () => {
  test.each(SAME)('%s are one view', (_label, a, b) => {
    expect(routeIdentity(a)).toBe(routeIdentity(b))
  })

  test.each(DIFFERENT)('%s are different views', (_label, a, b) => {
    expect(routeIdentity(a)).not.toBe(routeIdentity(b))
  })
})
