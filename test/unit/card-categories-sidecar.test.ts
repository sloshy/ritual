import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  applyCategoryChangesToRecord,
  cardCategoriesOf,
  categoriesHashPath,
  categoriesSidecarPath,
  commitCategoryChanges,
  emptyCardCategoriesRecord,
  loadCardCategories,
  parseCardCategoriesSidecar,
  pruneCardCategories,
  recordFromJson,
  removeCategoryFromRecord,
  resolveCategoryOrder,
  saveCardCategories,
  serializeCardCategoriesSidecar,
} from '../../src/list/card-categories-sidecar'
import {
  createAddChange,
  createRenameCategoryChange,
  createSetCategoriesChange,
  createSetCategoryOrderChange,
} from '../../src/changes/change-event'
import { computeHash } from '../../src/changes/content-hash'
import { bindWorkspace, type BoundWorkspace } from '../helpers/workspace'
import { loadDictionary, resetI18nRuntime, setLocale } from '../../src/i18n/runtime'
import { localeTag } from '../../src/i18n/locale-tag'

import { categoriesOf as cardsOf, categoriesRecord as record } from '../helpers/card-categories'

describe('categoriesSidecarPath / categoriesHashPath', () => {
  test('derive the sidecar and its own hash from the list path', () => {
    expect(categoriesSidecarPath('/w/decks/Burn.md')).toBe('/w/decks/Burn.categories.json')
    expect(categoriesHashPath('/w/decks/Burn.md')).toBe('/w/decks/Burn.categories.json.sha256')
  })
})

describe('parseCardCategoriesSidecar', () => {
  const canonical = JSON.stringify(
    { order: ['Ramp', 'Draw'], cards: { 'Rhystic Study': ['Draw'], 'Sol Ring': ['Ramp'] } },
    null,
    2,
  )

  test('reads the vocabulary and the per-card lists, keyed by the folded name', () => {
    const parsed = parseCardCategoriesSidecar(canonical)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.categories.order).toEqual(['Ramp', 'Draw'])
    expect(parsed.categories.cards.get('sol ring')).toEqual({
      name: 'Sol Ring',
      categories: ['Ramp'],
    })
    expect(parsed.warnings).toEqual([])
  })

  test.each([
    ['malformed JSON', '{ nope'],
    ['a non-object root', '["Ramp"]'],
    ['a non-array order', '{"order":"Ramp"}'],
    ['a non-string order element', '{"order":[7]}'],
    ['a malformed category name', '{"cards":{"Sol Ring":["a,b"]}}'],
    ['an empty per-card array', '{"cards":{"Sol Ring":[]}}'],
    ['a duplicate folded name', '{"cards":{"Sol Ring":["Ramp"],"sol ring":["Draw"]}}'],
    ['an empty card key', '{"cards":{"  ":["Ramp"]}}'],
  ])('refuses %s as a whole, with a message', (_label, content) => {
    const parsed = parseCardCategoriesSidecar(content)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.message.length).toBeGreaterThan(0)
  })

  test('knownCardNames reports stale entries as a warning but KEEPS them', () => {
    const parsed = parseCardCategoriesSidecar(canonical, {
      knownCardNames: new Set(['sol ring']),
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.warnings).toEqual([{ kind: 'unknown-card-names', names: ['Rhystic Study'] }])
    expect(parsed.categories.cards.size).toBe(2)
  })

  test('omitting knownCardNames raises no warning at all', () => {
    const parsed = parseCardCategoriesSidecar(canonical)
    expect(parsed.ok && parsed.warnings).toEqual([])
  })
})

describe('resolveCategoryOrder', () => {
  test('stored order first, then used-but-unlisted names — defaults in config order', () => {
    const value = record(['Removal'], { 'Sol Ring': ['Ramp', 'Zenith'], Brainstorm: ['Draw'] })
    expect(resolveCategoryOrder(value, ['Ramp', 'Draw'])).toEqual([
      'Removal',
      'Ramp',
      'Draw',
      'Zenith',
    ])
  })

  test('names outside the defaults follow the pinned data collation', () => {
    const value = record([], { 'Sol Ring': ['Zenith', 'Alpha'] })
    expect(resolveCategoryOrder(value)).toEqual(['Alpha', 'Zenith'])
  })

  test('the resolved order — and so the sidecar bytes — do not follow the UI locale', () => {
    const value = record([], { 'Sol Ring': ['Zenith', 'alpha', 'Ändern'] })
    const english = serializeCardCategoriesSidecar(value)
    expect(resolveCategoryOrder(value)).toEqual(['alpha', 'Ändern', 'Zenith'])
    // Swedish sorts 'Ä' after 'Z'; English (the pinned data collation) does not.
    loadDictionary(localeTag('sv'), {})
    setLocale(localeTag('sv'))
    // Persisted bytes are hashed and diffed, so two collaborators running
    // different locales must serialize the same record identically.
    expect(serializeCardCategoriesSidecar(value)).toBe(english)
    resetI18nRuntime()
  })

  test('deduplicates by fold against the stored order', () => {
    const value = record(['Ramp'], { 'Sol Ring': ['ramp'] })
    expect(resolveCategoryOrder(value)).toEqual(['Ramp'])
  })
})

describe('serializeCardCategoriesSidecar', () => {
  test('writes canonical bytes: 2-space indent, trailing newline, data-ordered card keys', () => {
    const value = record(['Ramp', 'Draw'], {
      'Sol Ring': ['Ramp'],
      'Rhystic Study': ['Draw'],
    })
    expect(serializeCardCategoriesSidecar(value)).toBe(
      `{
  "order": [
    "Ramp",
    "Draw"
  ],
  "cards": {
    "Rhystic Study": [
      "Draw"
    ],
    "Sol Ring": [
      "Ramp"
    ]
  }
}
`,
    )
  })

  test('per-card order is left exactly as stored — the first is the primary', () => {
    const value = record([], { 'Sol Ring': ['Artifacts', 'Ramp'] })
    const back = parseCardCategoriesSidecar(serializeCardCategoriesSidecar(value))
    expect(back.ok && cardsOf(back.categories)).toEqual({ 'Sol Ring': ['Artifacts', 'Ramp'] })
  })
})

describe('pruneCardCategories', () => {
  test('drops only the entries no card backs, reporting stored spellings', () => {
    const value = record(['Ramp'], {
      'Sol Ring': ['Ramp'],
      'Rhystic Study': ['Draw'],
      Brainstorm: ['Draw'],
    })
    const result = pruneCardCategories(value, new Set(['sol ring']))
    expect(result.pruned).toEqual(['Brainstorm', 'Rhystic Study'])
    expect(result.changed).toBe(true)
    expect(cardsOf(result.categories)).toEqual({ 'Sol Ring': ['Ramp'] })
    // A vocabulary entry with no cards is still the owner's vocabulary.
    expect(result.categories.order).toEqual(['Ramp'])
  })

  test('reports no change when every entry survives', () => {
    const value = record([], { 'Sol Ring': ['Ramp'] })
    const result = pruneCardCategories(value, new Set(['sol ring']))
    expect(result).toEqual({ categories: value, pruned: [], changed: false })
  })
})

describe('applyCategoryChangesToRecord', () => {
  test('set-categories sets an entry and appends its new names to the order', () => {
    const next = applyCategoryChangesToRecord(record(['Ramp'], {}), [
      createSetCategoriesChange('Sol Ring', ['Ramp', 'Artifacts']),
    ])
    expect(cardsOf(next)).toEqual({ 'Sol Ring': ['Ramp', 'Artifacts'] })
    expect(next.order).toEqual(['Ramp', 'Artifacts'])
  })

  test('set-categories with an empty list clears the entry', () => {
    const next = applyCategoryChangesToRecord(record(['Ramp'], { 'Sol Ring': ['Ramp'] }), [
      createSetCategoriesChange('Sol Ring', []),
    ])
    expect(cardsOf(next)).toEqual({})
  })

  test('rename-category rewrites the order and every card, preserving per-card order', () => {
    const next = applyCategoryChangesToRecord(
      record(['Ramp', 'Draw'], { 'Sol Ring': ['Draw', 'Ramp'] }),
      [createRenameCategoryChange('Draw', 'Card Draw')],
    )
    expect(next.order).toEqual(['Ramp', 'Card Draw'])
    expect(cardsOf(next)).toEqual({ 'Sol Ring': ['Card Draw', 'Ramp'] })
  })

  test('a rename onto an existing name merges the two into one', () => {
    const next = applyCategoryChangesToRecord(
      record(['Ramp', 'Draw'], { 'Sol Ring': ['Draw', 'Ramp'] }),
      [createRenameCategoryChange('Draw', 'Ramp')],
    )
    expect(next.order).toEqual(['Ramp'])
    expect(cardsOf(next)).toEqual({ 'Sol Ring': ['Ramp'] })
  })

  test('set-category-order replaces the vocabulary order', () => {
    const next = applyCategoryChangesToRecord(record(['Ramp', 'Draw'], {}), [
      createSetCategoryOrderChange(['Draw', 'Ramp']),
    ])
    expect(next.order).toEqual(['Draw', 'Ramp'])
  })

  test('a non-category event is ignored and the input record is never mutated', () => {
    const before = record(['Ramp'], { 'Sol Ring': ['Ramp'] })
    const next = applyCategoryChangesToRecord(before, [
      createAddChange('Brainstorm', { cardId: 2 }),
      createSetCategoriesChange('Brainstorm', ['Draw']),
    ])
    expect(cardsOf(before)).toEqual({ 'Sol Ring': ['Ramp'] })
    expect(before.order).toEqual(['Ramp'])
    expect(cardsOf(next)).toEqual({ 'Sol Ring': ['Ramp'], Brainstorm: ['Draw'] })
  })
})

describe('the sidecar on disk', () => {
  let workspace: BoundWorkspace
  let listPath: string
  let sidecarPath: string
  let hashFilePath: string

  beforeEach(async () => {
    workspace = await bindWorkspace()
    listPath = path.join(workspace.dir, 'decks', 'Burn.md')
    sidecarPath = categoriesSidecarPath(listPath)
    hashFilePath = categoriesHashPath(listPath)
    await fs.mkdir(path.dirname(listPath), { recursive: true })
    await fs.writeFile(listPath, '# Burn\n')
  })

  afterEach(async () => {
    await workspace.dispose()
  })

  test('saveCardCategories writes the sidecar and stamps its own .sha256', async () => {
    const value = record(['Ramp'], { 'Sol Ring': ['Ramp'] })
    const saved = await saveCardCategories(listPath, value)
    expect(saved.action).toBe('written')
    expect(saved.stamped).toBe(true)
    expect(saved.writtenFiles).toEqual([sidecarPath, hashFilePath])
    const content = await fs.readFile(sidecarPath, 'utf-8')
    expect((await fs.readFile(hashFilePath, 'utf-8')).trim()).toBe(computeHash(content))
  })

  test('a second identical save writes nothing at all', async () => {
    const value = record(['Ramp'], { 'Sol Ring': ['Ramp'] })
    await saveCardCategories(listPath, value)
    const before = await fs.readFile(sidecarPath, 'utf-8')
    const beforeHash = await fs.readFile(hashFilePath, 'utf-8')

    const again = await saveCardCategories(listPath, value)
    expect(again.action).toBe('unchanged')
    expect(again.writtenFiles).toEqual([])
    expect(await fs.readFile(sidecarPath, 'utf-8')).toBe(before)
    expect(await fs.readFile(hashFilePath, 'utf-8')).toBe(beforeHash)
  })

  test('an empty record unlinks the sidecar and its hash, and reports both paths', async () => {
    await saveCardCategories(listPath, record(['Ramp'], { 'Sol Ring': ['Ramp'] }))
    const removed = await saveCardCategories(listPath, emptyCardCategoriesRecord())
    expect(removed.action).toBe('removed')
    // A deletion has to be staged like any other change, so the caller's commit
    // set must learn about both paths.
    expect(removed.writtenFiles).toEqual([sidecarPath, hashFilePath])
    expect(await Bun.file(sidecarPath).exists()).toBe(false)
    expect(await Bun.file(hashFilePath).exists()).toBe(false)
  })

  test('an empty record with no file on disk reports absent and creates nothing', async () => {
    const absent = await saveCardCategories(listPath, emptyCardCategoriesRecord())
    expect(absent.action).toBe('absent')
    expect(absent.writtenFiles).toEqual([])
    expect(await Bun.file(sidecarPath).exists()).toBe(false)
  })

  test('a hand-edited sidecar is overwritten WITHOUT a new stamp', async () => {
    await fs.writeFile(sidecarPath, '{"order":[],"cards":{"Sol Ring":["Draw"]}}\n')
    await fs.writeFile(hashFilePath, `${computeHash('stale bytes')}\n`)
    const staleHash = await fs.readFile(hashFilePath, 'utf-8')

    const saved = await saveCardCategories(listPath, record([], { 'Sol Ring': ['Ramp'] }))
    expect(saved.action).toBe('written')
    expect(saved.stamped).toBe(false)
    expect(saved.writtenFiles).toEqual([sidecarPath])
    expect(await fs.readFile(hashFilePath, 'utf-8')).toBe(staleHash)
  })

  test('an already-canonical hand-edited sidecar is left alone, stale hash and all', async () => {
    const value = record([], { 'Sol Ring': ['Ramp'] })
    await fs.writeFile(sidecarPath, serializeCardCategoriesSidecar(value))
    await fs.writeFile(hashFilePath, `${computeHash('stale bytes')}\n`)
    const staleHash = await fs.readFile(hashFilePath, 'utf-8')

    const saved = await saveCardCategories(listPath, value)
    expect(saved.action).toBe('unchanged')
    expect(await fs.readFile(hashFilePath, 'utf-8')).toBe(staleHash)
  })

  test('loadCardCategories reads an absent sidecar as an empty record', async () => {
    const loaded = await loadCardCategories(listPath)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.categories.cards.size).toBe(0)
    expect(loaded.categories.order).toEqual([])
  })

  test('loadCardCategories reports a malformed sidecar, naming the path', async () => {
    await fs.writeFile(sidecarPath, '{ nope')
    const loaded = await loadCardCategories(listPath)
    expect(loaded.ok).toBe(false)
    if (!loaded.ok) expect(loaded.message).toContain(sidecarPath)
  })

  test('commitCategoryChanges replays, prunes and writes in one call', async () => {
    await saveCardCategories(
      listPath,
      record([], { 'Sol Ring': ['Ramp'], 'Rhystic Study': ['Draw'] }),
    )
    const committed = await commitCategoryChanges(
      listPath,
      [createSetCategoriesChange('Brainstorm', ['Draw'])],
      { knownCardNames: new Set(['sol ring', 'brainstorm']) },
    )
    expect(committed.pruned).toEqual(['Rhystic Study'])
    expect(committed.writtenFiles).toEqual([sidecarPath, categoriesHashPath(listPath)])
    expect(committed.action).toBe('written')
    expect(committed.error).toBeUndefined()
    // The load's own warning names the stale entry the commit is about to drop.
    expect(committed.warnings).toEqual([{ kind: 'unknown-card-names', names: ['Rhystic Study'] }])

    const loaded = await loadCardCategories(listPath)
    expect(loaded.ok && cardsOf(loaded.categories)).toEqual({
      'Sol Ring': ['Ramp'],
      Brainstorm: ['Draw'],
    })
  })

  test('commitCategoryChanges reports a malformed sidecar and writes nothing', async () => {
    await fs.writeFile(sidecarPath, '{ nope')
    const committed = await commitCategoryChanges(
      listPath,
      [createSetCategoriesChange('Sol Ring', ['Ramp'])],
      { knownCardNames: new Set(['sol ring']) },
    )
    expect(committed.error).toBeDefined()
    expect(committed.writtenFiles).toEqual([])
    expect(await fs.readFile(sidecarPath, 'utf-8')).toBe('{ nope')
  })

  test('commitCategoryChanges short-circuits when there is nothing to do', async () => {
    const committed = await commitCategoryChanges(listPath, [
      createAddChange('Sol Ring', { cardId: 1 }),
    ])
    expect(committed).toEqual({ writtenFiles: [], pruned: [], warnings: [] })
    expect(await Bun.file(sidecarPath).exists()).toBe(false)
  })
})

describe('cardCategoriesOf', () => {
  test('answers by the sidecar fold, and never with an empty list', () => {
    const base = record(['Ramp'], { 'Sol Ring': ['Ramp'] })
    expect(cardCategoriesOf(base, 'Sol Ring')).toEqual(['Ramp'])
    // The fold is the sidecar's own: case and inner whitespace do not matter.
    expect(cardCategoriesOf(base, 'sol  ring')).toEqual(['Ramp'])
    expect(cardCategoriesOf(base, 'SOL RING')).toEqual(['Ramp'])
    // Absent means none — never `[]`, which a body would advertise as a value.
    expect(cardCategoriesOf(base, 'Rhystic Study')).toBeUndefined()
    // And an entry that holds an empty list answers the same way: a hand-edited
    // sidecar can carry one, and every load body relies on "absent means none".
    const empty = record([], {})
    empty.cards.set('sol ring', { name: 'Sol Ring', categories: [] })
    expect(cardCategoriesOf(empty, 'Sol Ring')).toBeUndefined()
  })
})

describe('removeCategoryFromRecord', () => {
  const base = record(['Ramp', 'Draw', 'Removal'], {
    'Sol Ring': ['Ramp', 'Artifacts'],
    'Rhystic Study': ['Draw'],
    'Swords to Plowshares': ['Removal'],
  })

  test('drops the name from the vocabulary and from every card, folding case', () => {
    const next = removeCategoryFromRecord(base, 'ramp')
    expect(next.order).toEqual(['Draw', 'Removal'])
    expect(cardsOf(next)['Sol Ring']).toEqual(['Artifacts'])
  })

  test('a card left with no categories loses its entry', () => {
    const next = removeCategoryFromRecord(base, 'Draw')
    expect(next.cards.has('rhystic study')).toBe(false)
    expect(Object.keys(cardsOf(next)).sort()).toEqual(['Sol Ring', 'Swords to Plowshares'])
  })

  test('leaves the other categories in their stored order', () => {
    const next = removeCategoryFromRecord(base, 'Removal')
    expect(next.order).toEqual(['Ramp', 'Draw'])
    expect(cardsOf(next)['Sol Ring']).toEqual(['Ramp', 'Artifacts'])
  })

  test('an unused name changes nothing', () => {
    const next = removeCategoryFromRecord(base, 'Combo')
    expect(next.order).toEqual(base.order)
    expect(cardsOf(next)).toEqual(cardsOf(base))
  })
})

describe('recordFromJson', () => {
  test('parses a baked detail into a record', () => {
    const rec = recordFromJson({ order: ['Ramp'], cards: { 'Sol Ring': ['Ramp'] } })
    expect(rec.order).toEqual(['Ramp'])
    expect(rec.cards.get('sol ring')?.categories).toEqual(['Ramp'])
  })

  test('returns the empty record for absent, null and malformed input, never throwing', () => {
    expect(recordFromJson(undefined).cards.size).toBe(0)
    expect(recordFromJson(null).cards.size).toBe(0)
    expect(recordFromJson({ cards: 3 }).cards.size).toBe(0)
    expect(recordFromJson('nonsense').order).toEqual([])
  })
})
