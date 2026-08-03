import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createAddChange } from '../../src/change-event'
import { resetCardSessionTracking, saveCardSession } from '../../src/commands/card-session'
import { newListSession, pendingListCollision, type OpenList } from '../../src/commands/edit-lists'
import { listFilePath } from '../../src/resolve-list'
import type { DeckSessionConfig } from '../../src/commands/deck-helpers'
import type { ListType } from '../../src/list-type'
import { bindWorkspace, type BoundWorkspace } from './helpers/workspace'

/**
 * A list created in the `edit` command exists in memory only: its file and
 * changelog appear when the editor saves, and never if the session is
 * discarded. These tests drive that promise against a real filesystem.
 */

let ws: BoundWorkspace
let dir: string

const sessionConfig: DeckSessionConfig = {
  entryMode: 'name',
  collectorSets: [],
  activeSetIndex: 0,
  setCardMaps: new Map(),
  targetSection: null,
}

beforeEach(async () => {
  // No list subdirectories: these tests assert that nothing exists until save.
  ws = await bindWorkspace({ dirs: [] })
  dir = ws.dir
})

afterEach(async () => {
  await ws.dispose()
})

const exists = (file: string): Promise<boolean> => Bun.file(file).exists()

/** Build the in-memory session the `➕ New …` menu items create. */
function createList(type: ListType, name: string): OpenList {
  const file = listFilePath(type, name)!
  return newListSession(
    { type, name, file },
    type === 'deck' ? 'commander' : null,
    sessionConfig,
    true,
    () => {},
  )
}

describe('creating a list in the edit command (Integration)', () => {
  test.each([
    ['deck', 'Fresh Brew'],
    ['collection', 'New Binder'],
    ['wanted', 'Shopping List'],
  ] as const)('a new %s writes nothing until the session is saved', async (type, name) => {
    const open = createList(type, name)

    // Not even the directory is touched: discarding the session leaves no trace.
    expect(open.isNew()).toBe(true)
    expect(await exists(open.ref.file)).toBe(false)
    expect(await exists(path.dirname(open.ref.file))).toBe(false)

    // The creation is itself the pending change, so an empty new list still saves.
    expect(open.strategy.hasUnsavedChanges()).toBe(true)
    expect(open.ctx.sessionChanges).toEqual([])

    await saveCardSession(open.strategy, open.ctx)
    expect(await exists(open.ref.file)).toBe(true)
    // No card changed, so the list gets no changelog.
    expect(await exists(open.ref.file.replace(/\.md$/, '.changes.md'))).toBe(false)
  })

  test('a new deck is written at a path named as the deck is, with matching front matter', async () => {
    // A deck is named the same way a collection or wanted list is — see the
    // flat-list test below, which expects the same shape under its own directory.
    const open = createList('deck', 'Fresh Brew')
    expect(open.ref.file).toBe(path.join(dir, 'decks', 'Fresh Brew.md'))

    await saveCardSession(open.strategy, open.ctx)
    const content = await fs.readFile(open.ref.file, 'utf-8')
    expect(content).toContain('name: Fresh Brew')
    expect(content).toContain('format: commander')
    expect(content).toContain('## Main')
  })

  test('a new flat list is written with its title as the heading', async () => {
    const open = createList('collection', 'New Binder')
    expect(open.ref.file).toBe(path.join(dir, 'collections', 'New Binder.md'))

    await saveCardSession(open.strategy, open.ctx)
    expect(await fs.readFile(open.ref.file, 'utf-8')).toContain('# New Binder')
  })

  test('cards added before the first save land in the created file and its changelog', async () => {
    const open = createList('wanted', 'Shopping List')
    const change = createAddChange('Black Lotus', { cardId: 1, section: 'Main' })
    open.strategy.applyChange(change)
    open.ctx.sessionChanges.push(change)
    expect(await exists(open.ref.file)).toBe(false)

    await saveCardSession(open.strategy, open.ctx)
    expect(await fs.readFile(open.ref.file, 'utf-8')).toContain('- Black Lotus &1')
    const changelog = await fs.readFile(
      path.join(dir, 'wanted', 'Shopping List.changes.md'),
      'utf-8',
    )
    expect(changelog).toContain('Added "Black Lotus" &1')
  })

  test('saving twice keeps the list, and it is no longer unsaved or new', async () => {
    const open = createList('collection', 'New Binder')
    await saveCardSession(open.strategy, open.ctx)
    resetCardSessionTracking(open.strategy, open.ctx)

    // Persisting clears the dirty flag, so a second save has nothing to write,
    // and the creation is committed rather than still pending.
    expect(open.strategy.hasUnsavedChanges()).toBe(false)
    expect(open.isNew()).toBe(false)
    expect(open.strategy.listSessionChanges()).toEqual([])

    await saveCardSession(open.strategy, open.ctx)
    expect(await fs.readFile(open.ref.file, 'utf-8')).toContain('# New Binder')
  })
})

describe('a pending list creation as a session change (Integration)', () => {
  test('discarding the creation drops the list, and its file is never written', async () => {
    const dropped: string[] = []
    const file = listFilePath('collection', 'New Binder')!
    const open = newListSession(
      { type: 'collection', name: 'New Binder', file },
      null,
      sessionConfig,
      true,
      () => dropped.push(file),
    )

    await open.strategy.discardSessionChange(open.ctx, 0)

    expect(dropped).toEqual([file])
    expect(open.strategy.discarded?.()).toBe(true)
    expect(await exists(file)).toBe(false)
  })
})

describe('in-session name collisions (Integration)', () => {
  test('a second new list whose name folds onto the first is refused', async () => {
    // Neither list is on disk yet, so the on-disk check cannot see the first —
    // saving both would leave the pair mutually unaddressable.
    const first = createList('deck', 'Atraxa Superfriends')
    const open = [first]

    expect(pendingListCollision(open, 'deck', 'atraxa superfriends')).toBe(first)
    expect(pendingListCollision(open, 'deck', 'Atraxa: Superfriends')).toBe(first)
    // A different type is a different namespace, and a genuinely different name
    // is free.
    expect(pendingListCollision(open, 'collection', 'atraxa superfriends')).toBeUndefined()
    expect(pendingListCollision(open, 'deck', 'Atraxa Infect')).toBeUndefined()
  })

  test('a list already on disk is left to the on-disk check', () => {
    // Only *pending* creations are this check's business; an opened list is
    // already covered by `listNameCollision`, which enumerates the filesystem.
    const opened: OpenList = { ...createList('deck', 'Fresh Brew'), isNew: () => false }
    expect(pendingListCollision([opened], 'deck', 'fresh brew')).toBeUndefined()
  })
})
