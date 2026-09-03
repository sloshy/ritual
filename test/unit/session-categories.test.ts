import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import path from 'node:path'
import prompts from 'prompts'
import {
  categoryMenuItems,
  commitSessionCategories,
  createSessionCategories,
  currentSessionCategories,
  handleCategoryMenuSentinel,
  noteCategoryChange,
  sessionCategoryVocabulary,
  warnUnreconciledCategories,
} from '../../src/commands/session/categories'
import { createSetCategoriesChange } from '../../src/changes/change-event'
import { loadCardCategories, saveCardCategories } from '../../src/list/card-categories-sidecar'
import { createCardSessionContext } from '../../src/commands/session/strategy'
import {
  categoriesOf,
  categoriesRecord,
  writeUnreadableCategoriesSidecar,
} from '../helpers/card-categories'
import { bindWorkspace, type BoundWorkspace } from '../helpers/workspace'
import { captureConsole } from '../helpers/capture'
import { stubTty } from '../test-utils'

/**
 * The session wrapper around the phase-1 sidecar engine. Only what the wrapper
 * itself adds is asserted here: the read-once baseline, the replay of staged
 * events over it, and the save's pass-through of `knownCardNames`. The sidecar
 * bytes, `writtenFiles` and the `unchanged` action are pinned by
 * `card-categories-sidecar.test.ts` and are not re-asserted.
 */

const listFile = (dir: string): string => path.join(dir, 'collections', 'Binder.md')

/**
 * A workspace whose configured `defaultCategories` is empty, so a list with no
 * categories of its own really does present an empty vocabulary. The shipped
 * fourteen are suggestions the prompts offer on top of the list's own — see
 * `sessionCategoryVocabulary` — and they are what the last case here seeds back.
 */
let ws: BoundWorkspace
beforeEach(async () => {
  ws = await bindWorkspace({ config: { defaultCategories: [] } })
})
afterEach(async () => {
  await ws.dispose()
})

describe('currentSessionCategories', () => {
  test('an absent sidecar reads as an empty record', async () => {
    const state = createSessionCategories()
    const lookup = await currentSessionCategories(listFile(ws.dir), state)
    expect(lookup.ok && categoriesOf(lookup.record)).toEqual({})
    expect(lookup.ok && lookup.record.order).toEqual([])
  })

  test('pending events replay over the on-disk baseline, which stays as loaded', async () => {
    await saveCardCategories(listFile(ws.dir), categoriesRecord(['Ramp'], { 'Sol Ring': ['Ramp'] }))
    const state = createSessionCategories()
    noteCategoryChange(state, createSetCategoriesChange('Sol Ring', ['Draw']))
    const lookup = await currentSessionCategories(listFile(ws.dir), state)
    expect(lookup.ok && categoriesOf(lookup.record)).toEqual({ 'Sol Ring': ['Draw'] })
    expect(lookup.ok && categoriesOf(lookup.baseline)).toEqual({ 'Sol Ring': ['Ramp'] })
  })

  test('the sidecar is read once per save cycle', async () => {
    await saveCardCategories(listFile(ws.dir), categoriesRecord(['Ramp'], { 'Sol Ring': ['Ramp'] }))
    const state = createSessionCategories()
    await currentSessionCategories(listFile(ws.dir), state)
    await saveCardCategories(listFile(ws.dir), categoriesRecord(['Draw'], { Ponder: ['Draw'] }))
    const again = await currentSessionCategories(listFile(ws.dir), state)
    expect(again.ok && categoriesOf(again.record)).toEqual({ 'Sol Ring': ['Ramp'] })
  })

  test('an unreadable sidecar is reported, never read as "no categories"', async () => {
    await writeUnreadableCategoriesSidecar(listFile(ws.dir))
    const lookup = await currentSessionCategories(listFile(ws.dir), createSessionCategories())
    expect(lookup.ok).toBe(false)
  })
})

describe('commitSessionCategories', () => {
  test('passes knownCardNames through, so a save prunes what the list no longer holds', async () => {
    await saveCardCategories(
      listFile(ws.dir),
      categoriesRecord(['Ramp', 'Draw'], { 'Sol Ring': ['Ramp'], 'Rhystic Study': ['Draw'] }),
    )
    const state = createSessionCategories()
    const result = await commitSessionCategories(listFile(ws.dir), state, new Set(['sol ring']))
    expect(result.pruned).toEqual(['Rhystic Study'])
    const loaded = await loadCardCategories(listFile(ws.dir))
    expect(loaded.ok && categoriesOf(loaded.categories)).toEqual({ 'Sol Ring': ['Ramp'] })
  })

  test('clears pending and baseline, including when the commit reports an error', async () => {
    const state = createSessionCategories()
    await saveCardCategories(listFile(ws.dir), categoriesRecord(['Ramp'], { 'Sol Ring': ['Ramp'] }))
    await currentSessionCategories(listFile(ws.dir), state)
    noteCategoryChange(state, createSetCategoriesChange('Sol Ring', ['Draw']))
    await commitSessionCategories(listFile(ws.dir), state, new Set(['sol ring']))
    expect(state.pending).toEqual([])
    expect(state.baseline).toBeNull()

    await writeUnreadableCategoriesSidecar(listFile(ws.dir))
    noteCategoryChange(state, createSetCategoriesChange('Sol Ring', ['Ramp']))
    await currentSessionCategories(listFile(ws.dir), state)
    const failed = await commitSessionCategories(listFile(ws.dir), state, new Set(['sol ring']))
    expect(failed.error).toBeDefined()
    expect(state.pending).toEqual([])
    expect(state.baseline).toBeNull()
  })
})

describe('warnUnreconciledCategories', () => {
  test('names the pruned cards, so a save that drops assignments says so', async () => {
    const capture = await captureConsole(['warn'], () => {
      warnUnreconciledCategories({ writtenFiles: [], pruned: ['Ponder', 'Sol Ring'], warnings: [] })
    })
    expect(capture.all.join('\n')).toContain('Ponder, Sol Ring')
  })

  test('reports a sidecar the save could not read', async () => {
    const capture = await captureConsole(['warn'], () => {
      warnUnreconciledCategories({ writtenFiles: [], pruned: [], warnings: [], error: 'not json' })
    })
    expect(capture.all.join('\n')).toContain('not json')
  })
})

describe('categoryMenuItems / handleCategoryMenuSentinel', () => {
  stubTty({ stdin: true })

  test('the two rows come back in order, on their own sentinels', () => {
    expect(categoryMenuItems().map((row) => row.value)).toEqual([
      '__RENAME_CATEGORY__',
      '__REORDER_CATEGORIES__',
    ])
  })

  test('a value that is neither sentinel is not handled', async () => {
    const handled = await handleCategoryMenuSentinel(createCardSessionContext(), '__SAVE__', {
      filePath: listFile(ws.dir),
      categories: createSessionCategories(),
      markDirty: () => {},
    })
    expect(handled).toBe(false)
  })

  test('rename stages the event on the session AND in the changelog, and marks dirty', async () => {
    await saveCardCategories(
      listFile(ws.dir),
      categoriesRecord(['Ramp', 'Draw'], { 'Sol Ring': ['Ramp'] }),
    )
    const state = createSessionCategories()
    const ctx = createCardSessionContext()
    let dirty = false
    prompts.inject([1, 'Card Draw'])
    const handled = await handleCategoryMenuSentinel(ctx, '__RENAME_CATEGORY__', {
      filePath: listFile(ws.dir),
      categories: state,
      markDirty: () => {
        dirty = true
      },
    })
    expect(handled).toBe(true)
    expect(dirty).toBe(true)
    const staged = state.pending
    expect(staged).toHaveLength(1)
    expect(staged[0]).toMatchObject({
      action: 'rename-category',
      category: 'Draw',
      newCategory: 'Card Draw',
    })
    expect(ctx.sessionChanges).toEqual(staged)
  })

  test('renaming a category to a case variant of itself stages nothing', async () => {
    await saveCardCategories(
      listFile(ws.dir),
      categoriesRecord(['Ramp', 'Draw'], { 'Sol Ring': ['Ramp'] }),
    )
    const state = createSessionCategories()
    const ctx = createCardSessionContext()
    let dirty = false
    prompts.inject([1, 'draw'])
    const handled = await handleCategoryMenuSentinel(ctx, '__RENAME_CATEGORY__', {
      filePath: listFile(ws.dir),
      categories: state,
      markDirty: () => {
        dirty = true
      },
    })
    // Handled — the row ran — but a rename to the same name is not a change,
    // and a `rename-category` event would record one the user never made.
    expect(handled).toBe(true)
    expect(state.pending).toEqual([])
    expect(ctx.sessionChanges).toEqual([])
    expect(dirty).toBe(false)
  })

  test('reorder stages the order event on the session AND in the changelog, and marks dirty', async () => {
    await saveCardCategories(
      listFile(ws.dir),
      categoriesRecord(['Ramp', 'Draw'], { 'Sol Ring': ['Ramp'] }),
    )
    const state = createSessionCategories()
    const ctx = createCardSessionContext()
    let dirty = false
    prompts.inject(['Draw, Ramp'])
    const handled = await handleCategoryMenuSentinel(ctx, '__REORDER_CATEGORIES__', {
      filePath: listFile(ws.dir),
      categories: state,
      markDirty: () => {
        dirty = true
      },
    })
    expect(handled).toBe(true)
    expect(dirty).toBe(true)
    expect(state.pending).toHaveLength(1)
    expect(state.pending[0]).toMatchObject({
      action: 'set-category-order',
      order: ['Draw', 'Ramp'],
    })
    expect(ctx.sessionChanges).toEqual(state.pending)
  })

  test('an empty vocabulary says so, stages nothing, and still counts as handled', async () => {
    const state = createSessionCategories()
    const capture = await captureConsole(['log'], () =>
      handleCategoryMenuSentinel(createCardSessionContext(), '__REORDER_CATEGORIES__', {
        filePath: listFile(ws.dir),
        categories: state,
        markDirty: () => {},
      }),
    )
    expect(capture.result).toBe(true)
    expect(state.pending).toEqual([])
    expect(capture.all.join('\n')).toContain('no categories yet')
  })

  test('an unreadable sidecar refuses the row rather than overwriting it', async () => {
    await writeUnreadableCategoriesSidecar(listFile(ws.dir))
    const state = createSessionCategories()
    const capture = await captureConsole(['error'], () =>
      handleCategoryMenuSentinel(createCardSessionContext(), '__RENAME_CATEGORY__', {
        filePath: listFile(ws.dir),
        categories: state,
        markDirty: () => {},
      }),
    )
    expect(capture.result).toBe(true)
    expect(state.pending).toEqual([])
    expect(capture.all.join('\n')).toContain('could not be read')
  })
})

/**
 * The prompts' suggestion list is wider than the sidecar's persisted `order`:
 * design §6 asks for "the list's vocabulary then config defaults", and the
 * union happens in `sessionCategoryVocabulary` rather than in
 * `resolveCategoryOrder`, whose value is hashed into the file.
 */
describe('sessionCategoryVocabulary', () => {
  test("offers the list's own categories first, then the configured defaults", async () => {
    const configured = await bindWorkspace({ config: { defaultCategories: ['Ramp', 'Removal'] } })
    try {
      const record = categoriesRecord(['Draw'], { 'Sol Ring': ['Draw'] })
      expect(await sessionCategoryVocabulary(record)).toEqual(['Draw', 'Ramp', 'Removal'])
    } finally {
      await configured.dispose()
    }
  })

  test('a fresh list still offers the configured defaults', async () => {
    const configured = await bindWorkspace({ config: { defaultCategories: ['Ramp'] } })
    try {
      expect(await sessionCategoryVocabulary(categoriesRecord([], {}))).toEqual(['Ramp'])
    } finally {
      await configured.dispose()
    }
  })
})
