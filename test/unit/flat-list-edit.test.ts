import { describe, expect, test } from 'bun:test'
import {
  applyFlatListFieldEdit,
  entryPrinting,
  findFlatListEntry,
  lastFlatListEditLabel,
  listFlatListEntries,
  performFlatListRemoval,
  undoFlatListEdit,
  type FlatListFieldEdit,
} from '../../src/commands/flat-list-edit'
import {
  resetFlatListSessionTracking,
  type CollectionSession,
  type FlatListStrategyContext,
} from '../../src/commands/flat-list-session'
import type { CardSessionContext } from '../../src/commands/card-session'
import type { CollectionCardEntry } from '../../src/site/data-types'
import { applyChangeToCollection } from '../../src/editor/collection-changes'
import { collectionToMarkdown } from '../../src/editor/list-export'
import { formatCollectionLine } from '../../src/card-line'
import { allocateId, collectExistingIds, createIdPool } from '../../src/card-id'
import {
  consolidateSetNote,
  consolidateSetPrinting,
  createAddChange,
  createSetNoteChange,
  createSetPrintingChange,
  type ChangeEvent,
  type PrintingTuple,
} from '../../src/change-event'

function entry(
  name: string,
  cardId: number,
  overrides: Partial<CollectionCardEntry> = {},
): CollectionCardEntry {
  return {
    name,
    set: 'lea',
    collectorNumber: '161',
    finish: 'nonfoil',
    condition: 'NM',
    price: 0,
    fileOrder: cardId,
    section: 'Main',
    cardId,
    ...overrides,
  }
}

type Harness = {
  list: FlatListStrategyContext<CollectionCardEntry>
  ctx: CardSessionContext
  session: CollectionSession
}

function harness(entries: CollectionCardEntry[]): Harness {
  const session: CollectionSession = {
    filePath: '/tmp/unused.md',
    title: 'Binder',
    entries,
    sectionOrder: ['Main'],
    pool: createIdPool(collectExistingIds(entries)),
    dirty: false,
    apply: applyChangeToCollection,
    serialize: collectionToMarkdown,
  }
  const list: FlatListStrategyContext<CollectionCardEntry> = {
    session,
    state: { snapshot: null },
    renderLine: () => '',
    renderEntry: (e) =>
      formatCollectionLine(
        e.name,
        e.set,
        e.collectorNumber,
        e.finish,
        e.condition,
        e.note,
        e.cardId,
      ).trim(),
    sessionAdds: [],
    editUndo: [],
    originals: new Map(),
  }
  const ctx: CardSessionContext = {
    sessionChanges: [],
    lastChangeIndex: null,
    lastAdded: null,
    lastAddedCount: 0,
  }
  return { list, ctx, session }
}

/** A set-printing field edit built the same way the collection strategy builds it. */
function printingEdit(
  target: CollectionCardEntry,
  cardId: number,
  to: PrintingTuple,
): FlatListFieldEdit<CollectionCardEntry> {
  return {
    label: `printing on ${target.name}`,
    change: createSetPrintingChange(target.name, { ...to, cardId }),
    inverse: createSetPrintingChange(target.name, { ...entryPrinting(target), cardId }),
    consolidate: (changes, original) =>
      consolidateSetPrinting(changes, target.name, to, entryPrinting(original), cardId),
  }
}

const LTC: PrintingTuple = { set: 'ltc', collectorNumber: '284', finish: 'foil', condition: 'NM' }
const C19: PrintingTuple = {
  set: 'c19',
  collectorNumber: '221',
  finish: 'nonfoil',
  condition: 'NM',
}

describe('applyFlatListFieldEdit', () => {
  test('records one consolidated changelog event; re-editing replaces it', () => {
    const { list, ctx } = harness([entry('Sol Ring', 1)])
    const target = findFlatListEntry(list, 1)!

    applyFlatListFieldEdit(list, ctx, target, 1, printingEdit(target, 1, LTC))
    expect(findFlatListEntry(list, 1)!.set).toBe('ltc')
    expect(ctx.sessionChanges).toHaveLength(1)
    expect(list.session.dirty).toBe(true)

    // A second edit consolidates: still one event, describing the latest state.
    const updated = findFlatListEntry(list, 1)!
    applyFlatListFieldEdit(list, ctx, updated, 1, printingEdit(updated, 1, C19))
    expect(findFlatListEntry(list, 1)!.set).toBe('c19')
    expect(ctx.sessionChanges).toHaveLength(1)
    expect(ctx.sessionChanges[0]).toMatchObject({ action: 'set-printing', set: 'c19' })
    expect(lastFlatListEditLabel(list)).toBe('printing on Sol Ring')
  })

  test('editing back to the session-start printing drops out of the changelog', () => {
    const { list, ctx } = harness([entry('Sol Ring', 1)])
    const original = entryPrinting(findFlatListEntry(list, 1)!)

    applyFlatListFieldEdit(
      list,
      ctx,
      findFlatListEntry(list, 1)!,
      1,
      printingEdit(findFlatListEntry(list, 1)!, 1, LTC),
    )
    expect(ctx.sessionChanges).toHaveLength(1)

    const updated = findFlatListEntry(list, 1)!
    applyFlatListFieldEdit(list, ctx, updated, 1, printingEdit(updated, 1, original))
    expect(findFlatListEntry(list, 1)!.set).toBe('lea')
    expect(ctx.sessionChanges).toHaveLength(0)
  })

  test('a note edit consolidates and drops out when cleared back to the original', () => {
    const { list, ctx } = harness([entry('Sol Ring', 1)])
    const noteEdit = (target: CollectionCardEntry, note: string, before: string) => ({
      label: `note on ${target.name}`,
      change: createSetNoteChange(target.name, { note, cardId: 1 }),
      inverse: createSetNoteChange(target.name, { note: before, cardId: 1 }),
      consolidate: (changes: ChangeEvent[], original: CollectionCardEntry) =>
        consolidateSetNote(changes, target.name, note, original.note ?? '', 1),
    })

    applyFlatListFieldEdit(
      list,
      ctx,
      findFlatListEntry(list, 1)!,
      1,
      noteEdit(findFlatListEntry(list, 1)!, 'signed', ''),
    )
    expect(findFlatListEntry(list, 1)!.note).toBe('signed')
    expect(ctx.sessionChanges).toMatchObject([{ action: 'set-note', note: 'signed' }])

    // Clearing the note back to the session-start (no note) state drops the event.
    const updated = findFlatListEntry(list, 1)!
    applyFlatListFieldEdit(list, ctx, updated, 1, noteEdit(updated, '', 'signed'))
    expect(findFlatListEntry(list, 1)!.note).toBeUndefined()
    expect(ctx.sessionChanges).toHaveLength(0)
  })

  test('undo restores the entry and the displaced changelog event', () => {
    const { list, ctx } = harness([entry('Sol Ring', 1)])

    applyFlatListFieldEdit(
      list,
      ctx,
      findFlatListEntry(list, 1)!,
      1,
      printingEdit(findFlatListEntry(list, 1)!, 1, LTC),
    )
    const firstEvent = ctx.sessionChanges[0]!
    const afterFirst = findFlatListEntry(list, 1)!
    applyFlatListFieldEdit(list, ctx, afterFirst, 1, printingEdit(afterFirst, 1, C19))

    // Undo the second edit: model returns to the first edit's state and the
    // first edit's event comes back as the changelog's record.
    undoFlatListEdit(list, ctx)
    expect(findFlatListEntry(list, 1)!.set).toBe('ltc')
    expect(ctx.sessionChanges).toEqual([firstEvent])

    // Undo the first edit too: back to the session-start state, empty changelog.
    undoFlatListEdit(list, ctx)
    expect(findFlatListEntry(list, 1)!.set).toBe('lea')
    expect(ctx.sessionChanges).toHaveLength(0)
    expect(lastFlatListEditLabel(list)).toBeNull()
  })
})

describe('performFlatListRemoval', () => {
  test('removes a pre-existing entry, releases its id, and records a remove event', () => {
    const { list, ctx, session } = harness([entry('Sol Ring', 1), entry('Lightning Bolt', 2)])

    performFlatListRemoval(list, ctx, findFlatListEntry(list, 2)!, 2)
    expect(session.entries.map((e) => e.name)).toEqual(['Sol Ring'])
    expect(ctx.sessionChanges).toMatchObject([{ action: 'remove', cardName: 'Lightning Bolt' }])
    // The id is back in the pool.
    expect(allocateId(session.pool)).toBe(2)
  })

  test("folds the removed entry's earlier edit events out of the changelog", () => {
    const { list, ctx } = harness([entry('Sol Ring', 1)])
    applyFlatListFieldEdit(
      list,
      ctx,
      findFlatListEntry(list, 1)!,
      1,
      printingEdit(findFlatListEntry(list, 1)!, 1, LTC),
    )
    expect(ctx.sessionChanges).toHaveLength(1)

    performFlatListRemoval(list, ctx, findFlatListEntry(list, 1)!, 1)
    // Only the remove remains; the moot set-printing folded out.
    expect(ctx.sessionChanges).toMatchObject([{ action: 'remove', cardName: 'Sol Ring' }])

    // Undoing the removal restores the entry (with its edit applied) AND the edit's event.
    undoFlatListEdit(list, ctx)
    expect(findFlatListEntry(list, 1)).toMatchObject({ name: 'Sol Ring', set: 'ltc' })
    expect(ctx.sessionChanges).toMatchObject([{ action: 'set-printing', set: 'ltc' }])
  })

  test('removal of a card added this session cancels its add instead of recording a remove', () => {
    const { list, ctx, session } = harness([entry('Sol Ring', 1)])
    // Simulate a session add of &2.
    const added = entry('Brainstorm', allocateId(session.pool), {
      set: 'ice',
      collectorNumber: '61',
    })
    session.entries = [...session.entries, added]
    list.sessionAdds.push(2)
    ctx.sessionChanges.push(
      createAddChange('Brainstorm', { set: 'ice', collectorNumber: '61', cardId: 2 }),
    )

    performFlatListRemoval(list, ctx, findFlatListEntry(list, 2)!, 2)
    expect(session.entries.map((e) => e.name)).toEqual(['Sol Ring'])
    // The add event vanished; no remove was recorded.
    expect(ctx.sessionChanges).toHaveLength(0)
    expect(allocateId(session.pool)).toBe(2)
  })

  test('restores the note and reclaims the id on undo', () => {
    const { list, ctx, session } = harness([entry('Sol Ring', 1, { note: 'signed' })])

    performFlatListRemoval(list, ctx, findFlatListEntry(list, 1)!, 1)
    expect(session.entries).toHaveLength(0)

    undoFlatListEdit(list, ctx)
    expect(findFlatListEntry(list, 1)).toMatchObject({
      name: 'Sol Ring',
      note: 'signed',
      cardId: 1,
    })
    expect(ctx.sessionChanges).toHaveLength(0)
    // The id is in use again: the pool hands out the next one.
    expect(allocateId(session.pool)).toBe(2)
  })

  test('a removal undone after its id was reused restores the entry under a fresh id', () => {
    const { list, ctx, session } = harness([entry('Sol Ring', 1), entry('Lightning Bolt', 2)])

    performFlatListRemoval(list, ctx, findFlatListEntry(list, 1)!, 1)
    // A later add reuses the released id 1.
    const reused = allocateId(session.pool)
    expect(reused).toBe(1)
    session.entries = [
      ...session.entries,
      entry('Brainstorm', reused, { set: 'ice', collectorNumber: '61' }),
    ]

    undoFlatListEdit(list, ctx)
    const restored = session.entries.find((e) => e.name === 'Sol Ring')!
    expect(restored.cardId).toBe(3)
    // Both the reusing card and the restored card coexist with distinct ids.
    expect(session.entries.map((e) => e.cardId).sort()).toEqual([1, 2, 3])
  })
})

describe('listFlatListEntries', () => {
  test('renders every entry with its card id', () => {
    const { list } = harness([entry('Sol Ring', 1), entry('Lightning Bolt', 2)])
    const items = listFlatListEntries(list)
    expect(items.map((i) => i.cardId)).toEqual([1, 2])
    expect(items[0]!.label).toContain('Sol Ring')
    expect(items[0]!.label).toContain('&1')
  })

  test('skips entries without a card id', () => {
    const idless: CollectionCardEntry = { ...entry('Mana Crypt', 0), cardId: undefined }
    const { list } = harness([entry('Sol Ring', 1), idless])
    expect(listFlatListEntries(list).map((i) => i.cardId)).toEqual([1])
  })
})

describe('resetFlatListSessionTracking', () => {
  test('clears the session adds, edit history, snapshots, and last-add state', () => {
    const { list, ctx } = harness([entry('Sol Ring', 1)])
    list.sessionAdds.push(1)
    list.state.snapshot = { options: {} }
    applyFlatListFieldEdit(
      list,
      ctx,
      findFlatListEntry(list, 1)!,
      1,
      printingEdit(findFlatListEntry(list, 1)!, 1, LTC),
    )
    expect(list.editUndo).toHaveLength(1)
    expect(list.originals.size).toBe(1)

    resetFlatListSessionTracking(list)
    expect(list.sessionAdds).toHaveLength(0)
    expect(list.editUndo).toHaveLength(0)
    expect(list.originals.size).toBe(0)
    expect(list.state.snapshot).toBeNull()
    expect(lastFlatListEditLabel(list)).toBeNull()
  })
})
