import { describe, expect, test } from 'bun:test'
import {
  parseHash,
  routeToHash,
  toRoute,
  type Page,
  type Route,
} from '../../../src/admin/site/routing'

/** Every page, with the hash it is addressed by. */
const PAGE_HASHES: Record<Page, string> = {
  dashboard: '#/',
  'list-editor': '#/edit',
  'move-cards': '#/move',
  'list-manager': '#/lists',
  history: '#/history',
  'import-deck': '#/import/deck',
  'import-csv': '#/import/csv',
  'import-changes': '#/import/changes',
  'build-site': '#/build',
  'cache-refresh': '#/cache',
  'deck-sync': '#/sync/decks',
  'collection-sync': '#/sync/collection',
  'archidekt-login': '#/archidekt',
  settings: '#/settings',
  'audit-log': '#/audit',
}

describe('admin routing', () => {
  test.each(Object.entries(PAGE_HASHES))('%s round-trips through %s', (page, hash) => {
    const route: Route = { page: page as Page }
    expect(routeToHash(route)).toBe(hash)
    expect(parseHash(hash)).toEqual(route)
  })

  test('the editor carries its tab and list', () => {
    expect(routeToHash({ page: 'list-editor', editing: { listType: 'collection' } })).toBe(
      '#/edit/collection',
    )
    expect(
      routeToHash({ page: 'list-editor', editing: { listType: 'wanted', slug: 'Buy List' } }),
    ).toBe('#/edit/wanted/Buy%20List')
    expect(parseHash('#/edit/collection')).toEqual({
      page: 'list-editor',
      editing: { listType: 'collection' },
    })
    expect(parseHash('#/edit/wanted/Buy%20List')).toEqual({
      page: 'list-editor',
      editing: { listType: 'wanted', slug: 'Buy List' },
    })
  })

  test('deep-link options only reach the page that has somewhere to put them', () => {
    // Every link builds its route this way, and `NavLink` allows options on any
    // page — so a stray editor target must not leak into another page's URL.
    expect(toRoute('list-editor', { listType: 'deck', slug: 'Aggro' })).toEqual({
      page: 'list-editor',
      editing: { listType: 'deck', slug: 'Aggro' },
    })
    expect(toRoute('settings', { listType: 'deck' })).toEqual({ page: 'settings' })
    expect(toRoute('list-editor')).toEqual({ page: 'list-editor' })
  })

  test.each([
    ['an unknown page', '#/nope'],
    ['a nested path under an unknown page', '#/nope/deeper'],
    ['a path prefix that is not a page of its own', '#/import'],
    ['a sync path naming neither sync', '#/sync'],
    ['an empty hash', ''],
    ['a bare hash', '#'],
    ['a bare slash', '#/'],
  ])('%s resolves to the dashboard', (_label, hash) => {
    expect(parseHash(hash)).toEqual({ page: 'dashboard' })
  })

  test.each([
    ['a trailing slash', '#/settings/', { page: 'settings' }],
    ['extra segments', '#/import/deck/extra', { page: 'import-deck' }],
    ['a query string', '#/settings?debug=1', { page: 'settings' }],
    ['an unknown editor tab', '#/edit/sideboard', { page: 'list-editor' }],
    [
      'a malformed escape in a slug',
      '#/edit/deck/100%',
      { page: 'list-editor', editing: { listType: 'deck', slug: '100%' } },
    ],
  ] as [string, string, Route][])('%s is tolerated', (_label, hash, expected) => {
    expect(parseHash(hash)).toEqual(expected)
  })

  test('a slug keeps the characters a list name allows', () => {
    // List files are named as typed, so slugs carry spaces, `&`, and `#` — all of
    // which would otherwise cut the hash short or split into another segment.
    const route: Route = {
      page: 'list-editor',
      editing: { listType: 'deck', slug: 'Tom & Jerry #2/3' },
    }
    const hash = routeToHash(route)
    expect(hash).toBe('#/edit/deck/Tom%20%26%20Jerry%20%232%2F3')
    expect(parseHash(hash)).toEqual(route)
  })
})
