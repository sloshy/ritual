import { describe, expect, test } from 'bun:test'
import prompts from 'prompts'
import {
  applyFlatListFieldEdit,
  discardFlatListSessionChange,
  editSharedFlatListAction,
  sharedFlatListEditActions,
  findFlatListEntry,
  lastFlatListEditLabel,
  listFlatListEntries,
  listFlatListSessionChanges,
  performFlatListMove,
  performFlatListRemoval,
  undoFlatListEdit,
} from '../../src/commands/session/flat-list-edit'
import { printingTupleOf, type FieldEdit } from '../../src/commands/session/edit-model'
import type { MoveDestination } from '../../src/commands/session/edit-move'
import { createSessionArtChanges } from '../../src/commands/session/art'
import { createSessionCategories } from '../../src/commands/session/categories'
import {
  discardFlatListAdd,
  listFlatListSessionAdds,
  resetFlatListSessionTracking,
  type CollectionSession,
  type FlatListStrategyContext,
} from '../../src/commands/session/flat-list-session'
import type { CardSessionContext } from '../../src/commands/session/strategy'
import { makeCollectionEntry, scratchListPath, stubTty } from '../test-utils'
import type { CollectionCardEntry } from '../../src/list/site-data'
import { applyChangeToCollection } from '../../src/changes/collection-changes'
import { collectionToMarkdown } from '../../src/list/list-export'
import { formatCollectionLine } from '../../src/card/card-line'
import { allocateId, collectExistingIds, createIdPool } from '../../src/card/card-id'
import {
  consolidateSetNote,
  consolidateSetPrinting,
  createAddChange,
  createSetNoteChange,
  createSetPrintingChange,
  type ChangeEvent,
  type PrintingTuple,
} from '../../src/changes/change-event'

function entry(
  name: string,
  cardId: number,
  overrides: Partial<CollectionCardEntry> = {},
): CollectionCardEntry {
  return makeCollectionEntry({
    name,
    set: 'lea',
    collectorNumber: '161',
    fileOrder: cardId,
    cardId,
    ...overrides,
  })
}

type Harness = {
  list: FlatListStrategyContext<CollectionCardEntry>
  ctx: CardSessionContext
  session: CollectionSession
}

function harness(entries: CollectionCardEntry[]): Harness {
  const session: CollectionSession = {
    filePath: scratchListPath('flat-list-edit-test.md'),
    title: 'Binder',
    entries,
    sectionOrder: ['Main'],
    pool: createIdPool(collectExistingIds(entries)),
    dirty: false,
    art: createSessionArtChanges(),
    categories: createSessionCategories(),
    apply: applyChangeToCollection,
    serialize: collectionToMarkdown,
  }
  const list: FlatListStrategyContext<CollectionCardEntry> = {
    session,
    state: { snapshot: null },
    renderLine: () => '',
    renderEntry: (e) =>
      formatCollectionLine({
        cardName: e.name,
        set: e.set,
        collectorNumber: e.collectorNumber,
        finish: e.finish,
        condition: e.condition,
        language: e.language,
        labels: e.labels,
        tags: e.tags,
        note: e.note,
        cardId: e.cardId,
      }).trim(),
    sessionAdds: [],
    editUndo: [],
    originals: new Map(),
  }
  const ctx: CardSessionContext = {
    sessionChanges: [],
    lastChangeIndex: null,
    lastAdded: null,
    lastAddedCount: 0,
    hasSavedChangelog: false,
  }
  return { list, ctx, session }
}

/** A set-printing field edit built the same way the collection strategy builds it. */
function printingEdit(
  target: CollectionCardEntry,
  cardId: number,
  to: PrintingTuple,
): FieldEdit<CollectionCardEntry> {
  return {
    label: `printing on ${target.name}`,
    change: createSetPrintingChange(target.name, { ...to, cardId }),
    inverse: createSetPrintingChange(target.name, { ...printingTupleOf(target), cardId }),
    consolidate: (changes, original) =>
      consolidateSetPrinting(changes, target.name, to, printingTupleOf(original), cardId),
  }
}

/** Apply a set-printing edit to card `cardId`, the way the edit flow does it. */
function editPrinting(h: Harness, cardId: number, to: PrintingTuple): void {
  const target = findFlatListEntry(h.list, cardId)!
  applyFlatListFieldEdit(h.list, h.ctx, target, cardId, printingEdit(target, cardId, to))
}

/** Simulate a session add of `name`, mirroring what applyFlatListCardEntry tracks. */
function simulateAdd(h: Harness, name: string): number {
  const cardId = allocateId(h.session.pool)
  h.session.entries = [...h.session.entries, entry(name, cardId)]
  h.list.sessionAdds.push(cardId)
  h.ctx.sessionChanges.push(createAddChange(name, { set: 'lea', cardId }))
  return cardId
}

const LTC: PrintingTuple = { set: 'ltc', collectorNumber: '284', finish: 'foil', condition: 'NM' }
const C19: PrintingTuple = {
  set: 'c19',
  collectorNumber: '221',
  finish: 'nonfoil',
  condition: 'NM',
}

describe('sharedFlatListEditActions', () => {
  // The shared actions prompt, and the art prompt gates on a terminal.
  stubTty({ stdin: true })

  const env = { sessionConfig: { sets: [] }, excludeDigitalOnly: true, moveTargets: async () => [] }

  test('offers the move row only with move targets', () => {
    expect(sharedFlatListEditActions(env).map((r) => r.value)).toEqual([
      'language',
      'tags',
      'art',
      'categories',
      'move-list',
      'note',
      'remove',
    ])
    expect(sharedFlatListEditActions({}).map((r) => r.value)).toEqual([
      'language',
      'tags',
      'art',
      'categories',
      'note',
      'remove',
    ])
  })

  test('slots afterLanguage rows between the language and tags rows', () => {
    const label = { title: 'Label', value: 'label' }
    expect(sharedFlatListEditActions({}, [label]).map((r) => r.value)).toEqual([
      'language',
      'label',
      'tags',
      'art',
      'categories',
      'note',
      'remove',
    ])
  })

  for (const row of sharedFlatListEditActions(env)) {
    test(`editSharedFlatListAction handles ${row.value}`, async () => {
      const h = harness([entry('Sol Ring', 1)])
      const target = findFlatListEntry(h.list, 1)!
      // Cancel whichever prompt the action opens; the move row opens none
      // with no targets and returns on its own.
      prompts.inject([new Error('cancelled')])
      expect(await editSharedFlatListAction(row.value, h.list, h.ctx, target, 1, env)).toBe(true)
    })
  }

  test("editSharedFlatListAction declines the strategies' own actions", async () => {
    const h = harness([entry('Sol Ring', 1)])
    const target = findFlatListEntry(h.list, 1)!
    for (const own of ['printing', 'finish', 'condition', 'label']) {
      expect(await editSharedFlatListAction(own, h.list, h.ctx, target, 1, env)).toBe(false)
    }
  })
})

describe('applyFlatListFieldEdit', () => {
  test('records one consolidated changelog event; re-editing replaces it', () => {
    const h = harness([entry('Sol Ring', 1)])

    editPrinting(h, 1, LTC)
    expect(findFlatListEntry(h.list, 1)!.set).toBe('ltc')
    expect(h.ctx.sessionChanges).toHaveLength(1)
    expect(h.list.session.dirty).toBe(true)

    // A second edit consolidates: still one event, describing the latest state.
    editPrinting(h, 1, C19)
    expect(findFlatListEntry(h.list, 1)!.set).toBe('c19')
    expect(h.ctx.sessionChanges).toHaveLength(1)
    expect(h.ctx.sessionChanges[0]).toMatchObject({ action: 'set-printing', set: 'c19' })
    expect(lastFlatListEditLabel(h.list)).toBe('printing on Sol Ring')
  })

  test('editing back to the session-start printing drops out of the changelog', () => {
    const h = harness([entry('Sol Ring', 1)])
    const original = printingTupleOf(findFlatListEntry(h.list, 1)!)

    editPrinting(h, 1, LTC)
    expect(h.ctx.sessionChanges).toHaveLength(1)

    editPrinting(h, 1, original)
    expect(findFlatListEntry(h.list, 1)!.set).toBe('lea')
    expect(h.ctx.sessionChanges).toHaveLength(0)
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

    const target = findFlatListEntry(list, 1)!
    applyFlatListFieldEdit(list, ctx, target, 1, noteEdit(target, 'signed', ''))
    expect(findFlatListEntry(list, 1)!.note).toBe('signed')
    expect(ctx.sessionChanges).toMatchObject([{ action: 'set-note', note: 'signed' }])

    // Clearing the note back to the session-start (no note) state drops the event.
    const updated = findFlatListEntry(list, 1)!
    applyFlatListFieldEdit(list, ctx, updated, 1, noteEdit(updated, '', 'signed'))
    expect(findFlatListEntry(list, 1)!.note).toBeUndefined()
    expect(ctx.sessionChanges).toHaveLength(0)
  })

  test('undo restores the entry and the displaced changelog event', () => {
    const h = harness([entry('Sol Ring', 1)])

    editPrinting(h, 1, LTC)
    const firstEvent = h.ctx.sessionChanges[0]!
    editPrinting(h, 1, C19)

    // Undo the second edit: model returns to the first edit's state and the
    // first edit's event comes back as the changelog's record.
    undoFlatListEdit(h.list, h.ctx)
    expect(findFlatListEntry(h.list, 1)!.set).toBe('ltc')
    expect(h.ctx.sessionChanges).toEqual([firstEvent])

    // Undo the first edit too: back to the session-start state, empty changelog.
    undoFlatListEdit(h.list, h.ctx)
    expect(findFlatListEntry(h.list, 1)!.set).toBe('lea')
    expect(h.ctx.sessionChanges).toHaveLength(0)
    expect(lastFlatListEditLabel(h.list)).toBeNull()
  })
})

describe('edit-mode tag edits', () => {
  // The tags prompt goes through `ask`, which refuses to open without a terminal.
  stubTty({ stdin: true })

  const env = { sessionConfig: { sets: [] }, excludeDigitalOnly: true }

  async function editTagsTo(h: Harness, typed: string): Promise<void> {
    prompts.inject([typed])
    const target = findFlatListEntry(h.list, 1)!
    expect(await editSharedFlatListAction('tags', h.list, h.ctx, target, 1, env)).toBe(true)
  }

  test('records one add-tag per new tag, undoable as a single operation', async () => {
    const h = harness([entry('Sol Ring', 1)])

    await editTagsTo(h, 'staple, ramp')

    expect(findFlatListEntry(h.list, 1)!.tags).toEqual(['ramp', 'staple'])
    expect(
      h.ctx.sessionChanges.map((c) => ({ action: c.action, tag: 'tag' in c && c.tag })),
    ).toEqual([
      { action: 'add-tag', tag: 'ramp' },
      { action: 'add-tag', tag: 'staple' },
    ])
    expect(h.list.editUndo).toHaveLength(1)
    expect(lastFlatListEditLabel(h.list)).toBe('tags on Sol Ring')

    undoFlatListEdit(h.list, h.ctx)
    expect(findFlatListEntry(h.list, 1)!.tags).toBeUndefined()
    expect(h.ctx.sessionChanges).toHaveLength(0)
  })

  test('clearing the field removes every tag, one remove-tag each', async () => {
    const h = harness([entry('Sol Ring', 1, { tags: ['ramp', 'staple'] })])

    await editTagsTo(h, '')

    expect(findFlatListEntry(h.list, 1)!.tags).toBeUndefined()
    expect(h.ctx.sessionChanges.map((c) => c.action)).toEqual(['remove-tag', 'remove-tag'])
  })

  test('re-adding a tag removed earlier in the session cancels the pending removal', async () => {
    const h = harness([entry('Sol Ring', 1, { tags: ['ramp'] })])

    await editTagsTo(h, '')
    expect(h.ctx.sessionChanges.map((c) => c.action)).toEqual(['remove-tag'])

    await editTagsTo(h, 'ramp')
    expect(findFlatListEntry(h.list, 1)!.tags).toEqual(['ramp'])
    // Back to the session-start state: nothing left to log.
    expect(h.ctx.sessionChanges).toHaveLength(0)
    expect(h.list.editUndo).toHaveLength(2)

    // Undoing the re-add puts the pending removal back.
    undoFlatListEdit(h.list, h.ctx)
    expect(findFlatListEntry(h.list, 1)!.tags).toBeUndefined()
    expect(h.ctx.sessionChanges.map((c) => c.action)).toEqual(['remove-tag'])
  })

  test('a mixed edit is one undo entry whose inverse restores both halves', async () => {
    const h = harness([entry('Sol Ring', 1, { tags: ['old', 'kept'] })])

    await editTagsTo(h, 'kept, new')

    expect(findFlatListEntry(h.list, 1)!.tags).toEqual(['kept', 'new'])
    expect(
      h.ctx.sessionChanges.map((c) => ({ action: c.action, tag: 'tag' in c && c.tag })),
    ).toEqual([
      { action: 'add-tag', tag: 'new' },
      { action: 'remove-tag', tag: 'old' },
    ])
    expect(h.list.editUndo).toHaveLength(1)

    undoFlatListEdit(h.list, h.ctx)
    expect(findFlatListEntry(h.list, 1)!.tags).toEqual(['kept', 'old'])
    expect(h.ctx.sessionChanges).toHaveLength(0)
  })

  test('re-entering the current tags (in any order) is a no-op', async () => {
    const h = harness([entry('Sol Ring', 1, { tags: ['ramp', 'staple'] })])

    await editTagsTo(h, ' staple ,ramp')

    expect(h.ctx.sessionChanges).toHaveLength(0)
    expect(h.list.editUndo).toHaveLength(0)
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
    const h = harness([entry('Sol Ring', 1)])
    editPrinting(h, 1, LTC)
    expect(h.ctx.sessionChanges).toHaveLength(1)

    performFlatListRemoval(h.list, h.ctx, findFlatListEntry(h.list, 1)!, 1)
    // Only the remove remains; the moot set-printing folded out.
    expect(h.ctx.sessionChanges).toMatchObject([{ action: 'remove', cardName: 'Sol Ring' }])

    // Undoing the removal restores the entry (with its edit applied) AND the edit's event.
    undoFlatListEdit(h.list, h.ctx)
    expect(findFlatListEntry(h.list, 1)).toMatchObject({ name: 'Sol Ring', set: 'ltc' })
    expect(h.ctx.sessionChanges).toMatchObject([{ action: 'set-printing', set: 'ltc' }])
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

  test('restores the note, labels and tags and reclaims the id on undo', () => {
    const { list, ctx, session } = harness([
      entry('Sol Ring', 1, { note: 'signed', labels: ['keep'], tags: ['ramp', 'staple'] }),
    ])

    performFlatListRemoval(list, ctx, findFlatListEntry(list, 1)!, 1)
    expect(session.entries).toHaveLength(0)

    undoFlatListEdit(list, ctx)
    expect(findFlatListEntry(list, 1)).toMatchObject({
      name: 'Sol Ring',
      note: 'signed',
      labels: ['keep'],
      tags: ['ramp', 'staple'],
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

describe('custom-art bookkeeping', () => {
  const dest: MoveDestination = {
    target: { type: 'wanted', name: 'To Buy', file: '/wanted/to-buy.md' },
    printing: null,
  }

  // The sidecar is keyed by `&N` and the session reuses the ids its removals
  // free, so what the save re-files against is recorded here rather than
  // derived from the entries at write time.
  test('a removal records the freed id; undoing it under the same id takes it back', () => {
    const h = harness([entry('Sol Ring', 1), entry('Lightning Bolt', 2)])

    performFlatListRemoval(h.list, h.ctx, findFlatListEntry(h.list, 1)!, 1)
    expect([...h.session.art.removed]).toEqual([1])

    undoFlatListEdit(h.list, h.ctx)
    expect([...h.session.art.removed]).toEqual([])
  })

  test('a removal undone under a fresh id leaves the art dropped', () => {
    const h = harness([entry('Sol Ring', 1)])
    performFlatListRemoval(h.list, h.ctx, findFlatListEntry(h.list, 1)!, 1)
    // A later add takes &1, so the restored entry gets a new id — and the art
    // filed under &1 now belongs to a different card.
    simulateAdd(h, 'Brainstorm')
    expect(findFlatListEntry(h.list, 1)!.name).toBe('Brainstorm')

    undoFlatListEdit(h.list, h.ctx)
    expect([...h.session.art.removed]).toEqual([1])
  })

  test('a move out records the freed id, and undoing the move takes it back', () => {
    const h = harness([entry('Sol Ring', 1)])
    performFlatListMove(h.list, h.ctx, findFlatListEntry(h.list, 1)!, 1, dest)
    expect([...h.session.art.removed]).toEqual([1])

    undoFlatListEdit(h.list, h.ctx)
    expect([...h.session.art.removed]).toEqual([])
  })

  test('discarding a card added this session records nothing: it never had a line on disk', () => {
    const h = harness([entry('Sol Ring', 1)])
    const addedId = simulateAdd(h, 'Brainstorm')

    performFlatListRemoval(h.list, h.ctx, findFlatListEntry(h.list, addedId)!, addedId)
    expect(findFlatListEntry(h.list, addedId)).toBeUndefined()
    expect([...h.session.art.removed]).toEqual([])
  })
})

describe('listFlatListSessionChanges', () => {
  test('lists adds, edits, and removals in order', () => {
    const h = harness([entry('Sol Ring', 1), entry('Lightning Bolt', 2)])
    simulateAdd(h, 'Brainstorm')
    editPrinting(h, 1, LTC)
    performFlatListRemoval(h.list, h.ctx, findFlatListEntry(h.list, 2)!, 2)

    const items = listFlatListSessionChanges(h.list)
    expect(items).toHaveLength(3)
    expect(items[0]!.label).toContain('Added')
    expect(items[0]!.label).toContain('Brainstorm')
    expect(items[1]!.label).toContain('printing on Sol Ring')
    expect(items[2]!.label).toContain('removal of Lightning Bolt')
    expect(items.every((i) => i.blocked === undefined)).toBe(true)
  })

  test('an edit shadowed by a newer same-card change is blocked, naming the newer one', () => {
    const h = harness([entry('Sol Ring', 1)])
    editPrinting(h, 1, LTC)
    performFlatListRemoval(h.list, h.ctx, findFlatListEntry(h.list, 1)!, 1)

    const items = listFlatListSessionChanges(h.list)
    expect(items[0]!.blocked).toBe('discard the newer "removal of Sol Ring" first')
    expect(items[1]!.blocked).toBeUndefined()
  })

  test('discarding a middle edit reverts only that change and keeps the rest replayable', () => {
    const h = harness([entry('Sol Ring', 1), entry('Lightning Bolt', 2)])
    editPrinting(h, 1, LTC)
    editPrinting(h, 2, C19)

    // Discard the older edit (different card, so unblocked).
    discardFlatListSessionChange(h.list, h.ctx, 0)
    expect(findFlatListEntry(h.list, 1)!.set).toBe('lea')
    expect(findFlatListEntry(h.list, 2)!.set).toBe('c19')
    expect(h.ctx.sessionChanges).toMatchObject([{ action: 'set-printing', cardId: 2 }])

    // The surviving edit is still undoable afterwards.
    undoFlatListEdit(h.list, h.ctx)
    expect(findFlatListEntry(h.list, 2)!.set).toBe('lea')
    expect(h.ctx.sessionChanges).toHaveLength(0)
  })

  test('a blocked discard is refused and changes nothing', () => {
    const h = harness([entry('Sol Ring', 1)])
    editPrinting(h, 1, LTC)
    performFlatListRemoval(h.list, h.ctx, findFlatListEntry(h.list, 1)!, 1)
    const changesBefore = [...h.ctx.sessionChanges]

    discardFlatListSessionChange(h.list, h.ctx, 0)
    expect(h.list.editUndo).toHaveLength(2)
    expect(h.ctx.sessionChanges).toEqual(changesBefore)
    expect(h.session.entries).toHaveLength(0)
  })

  test('discarding a removal out of order restores the entry', () => {
    const h = harness([entry('Sol Ring', 1), entry('Lightning Bolt', 2)])
    performFlatListRemoval(h.list, h.ctx, findFlatListEntry(h.list, 1)!, 1)
    editPrinting(h, 2, C19)

    discardFlatListSessionChange(h.list, h.ctx, 0)
    expect(findFlatListEntry(h.list, 1)).toMatchObject({ name: 'Sol Ring', cardId: 1 })
    // Only the surviving edit's event remains in the changelog.
    expect(h.ctx.sessionChanges).toMatchObject([{ action: 'set-printing', cardId: 2 }])
    expect(h.list.editUndo.map((e) => e.label)).toEqual(['printing on Lightning Bolt'])
  })

  test('discarding an add routes through the session-add machinery', () => {
    const h = harness([entry('Sol Ring', 1)])
    simulateAdd(h, 'Brainstorm')
    editPrinting(h, 1, LTC)

    // Index 0 is the add (adds precede edits in the unified list).
    discardFlatListSessionChange(h.list, h.ctx, 0)
    expect(h.session.entries.map((e) => e.name)).toEqual(['Sol Ring'])
    expect(h.list.sessionAdds).toHaveLength(0)
    // The add's id returns to the pool, and the discard clears the edit history.
    expect(allocateId(h.session.pool)).toBe(2)
    expect(h.list.editUndo).toHaveLength(0)
  })
})

describe('discardFlatListAdd', () => {
  test('discarding a middle add re-packs survivors, frees the top id, and remaps the changelog', () => {
    const h = harness([])
    const names = ['Sol Ring', 'Lightning Bolt', 'Brainstorm', 'Counterspell', 'Dark Ritual']
    for (const name of names) simulateAdd(h, name)
    expect(h.list.sessionAdds).toEqual([1, 2, 3, 4, 5])
    expect(listFlatListSessionAdds(h.list).map((i) => i.name)).toEqual(names)

    // Discard the 3rd add (Brainstorm, &3).
    discardFlatListAdd(h.list, h.ctx, 2)

    // Survivors stay in add order and re-pack to a dense 1..4; the top id (5) frees up.
    const survivors = ['Sol Ring', 'Lightning Bolt', 'Counterspell', 'Dark Ritual']
    expect(h.session.entries.map((e) => e.name)).toEqual(survivors)
    expect(h.session.entries.map((e) => e.cardId)).toEqual([1, 2, 3, 4])
    expect(h.list.sessionAdds).toEqual([1, 2, 3, 4])
    expect(allocateId(h.session.pool)).toBe(5)

    // The discarded card's changelog event is gone; the rest are remapped to the new ids.
    expect(h.ctx.sessionChanges.map((c) => ('cardId' in c ? c.cardId : undefined))).toEqual([
      1, 2, 3, 4,
    ])
    expect(h.ctx.sessionChanges.map((c) => ('cardName' in c ? c.cardName : undefined))).toEqual(
      survivors,
    )
  })

  test('a re-pack leaves pre-existing (non-session) entries and their ids untouched', () => {
    // The list already has two cards (&1, &2) that were not added this session.
    const h = harness([entry('Mox Emerald', 1), entry('Black Lotus', 2)])
    simulateAdd(h, 'Sol Ring') // &3
    simulateAdd(h, 'Lightning Bolt') // &4
    simulateAdd(h, 'Brainstorm') // &5

    // Discard the middle session add (Lightning Bolt, &4).
    discardFlatListAdd(h.list, h.ctx, 1)

    // The two pre-existing entries keep &1/&2; only the session ids re-pack
    // (Brainstorm &5 → &4), and the freed top id (5) returns to the pool.
    const byName = (n: string) => h.session.entries.find((e) => e.name === n)!
    expect(byName('Mox Emerald').cardId).toBe(1)
    expect(byName('Black Lotus').cardId).toBe(2)
    expect(byName('Sol Ring').cardId).toBe(3)
    expect(byName('Brainstorm').cardId).toBe(4)
    expect(h.session.entries.find((e) => e.name === 'Lightning Bolt')).toBeUndefined()
    expect(h.list.sessionAdds).toEqual([3, 4])
    expect(allocateId(h.session.pool)).toBe(5)
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
    const h = harness([entry('Sol Ring', 1)])
    const { list } = h
    list.sessionAdds.push(1)
    list.state.snapshot = { options: {} }
    editPrinting(h, 1, LTC)
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

describe('performFlatListMove', () => {
  const dest: MoveDestination = {
    target: { type: 'wanted', name: 'To Buy', file: '/wanted/to-buy.md' },
    printing: null,
  }

  test('removes the entry, reserves its id, and records a move-from naming the destination', () => {
    const h = harness([entry('Sol Ring', 1), entry('Mana Crypt', 2)])
    performFlatListMove(h.list, h.ctx, findFlatListEntry(h.list, 1)!, 1, dest)

    expect(h.session.entries.map((e) => e.name)).toEqual(['Mana Crypt'])
    expect(h.ctx.sessionChanges).toMatchObject([
      {
        action: 'move-from',
        cardName: 'Sol Ring',
        set: 'lea',
        to: { type: 'wanted', name: 'To Buy' },
      },
    ])
    expect(h.session.dirty).toBe(true)
    // The id stays reserved while the move is pending — a new add must not
    // take over an id the move-from event still references.
    expect(allocateId(h.session.pool)).toBe(3)
  })

  test("folds the entry's earlier edits out; the move-from carries the final printing", () => {
    const h = harness([entry('Sol Ring', 1)])
    editPrinting(h, 1, LTC)
    performFlatListMove(h.list, h.ctx, findFlatListEntry(h.list, 1)!, 1, dest)

    expect(h.ctx.sessionChanges).toMatchObject([{ action: 'move-from', set: 'ltc' }])
    // The displaced printing edit comes back if the move is undone.
    const undo = h.list.editUndo[h.list.editUndo.length - 1]!
    expect(undo.removedFromChangelog).toMatchObject([{ action: 'set-printing', set: 'ltc' }])
  })

  test('a session-added entry keeps its add event but stops being discardable as an add', () => {
    const h = harness([])
    const movedId = simulateAdd(h, 'Sol Ring')
    const keptId = simulateAdd(h, 'Mana Crypt')
    performFlatListMove(h.list, h.ctx, findFlatListEntry(h.list, movedId)!, movedId, dest)

    expect(h.ctx.sessionChanges).toMatchObject([
      { action: 'add', cardName: 'Sol Ring' },
      { action: 'add', cardName: 'Mana Crypt' },
      { action: 'move-from', cardName: 'Sol Ring' },
    ])
    // Only the moved add leaves the discard menu; the other one survives.
    expect(h.list.sessionAdds).toEqual([keptId])
  })

  test('a printing resolved for the destination rides the event, not the model removal', () => {
    const h = harness([entry('Sol Ring', 1)])
    performFlatListMove(h.list, h.ctx, findFlatListEntry(h.list, 1)!, 1, {
      ...dest,
      printing: { set: '2xm', collectorNumber: '270' },
    })

    expect(h.session.entries).toHaveLength(0)
    expect(h.ctx.sessionChanges).toMatchObject([
      { action: 'move-from', set: '2xm', collectorNumber: '270' },
    ])

    // The undo inverse was built from the entry's own fields, not the
    // destination-resolved printing — the source line never carried 2XM.
    undoFlatListEdit(h.list, h.ctx)
    expect(findFlatListEntry(h.list, 1)).toMatchObject({ set: 'lea', collectorNumber: '161' })
  })

  test('undo restores the entry with its note and swaps the move-from back out', () => {
    const h = harness([
      entry('Sol Ring', 1, { note: 'from Dad', labels: ['keep'], tags: ['ramp'] }),
    ])
    performFlatListMove(h.list, h.ctx, findFlatListEntry(h.list, 1)!, 1, dest)
    expect(lastFlatListEditLabel(h.list)).toBe('move of Sol Ring to 🎯 To Buy')

    undoFlatListEdit(h.list, h.ctx)
    const restored = findFlatListEntry(h.list, 1)!
    expect(restored).toMatchObject({
      name: 'Sol Ring',
      note: 'from Dad',
      labels: ['keep'],
      tags: ['ramp'],
    })
    expect(h.ctx.sessionChanges).toHaveLength(0)
    expect(h.session.pool.usedIds.has(1)).toBe(true)
  })

  test('an add after a move cannot reuse the reserved id, so discarding it leaves the move intact', () => {
    const h = harness([entry('Sol Ring', 1)])
    performFlatListMove(h.list, h.ctx, findFlatListEntry(h.list, 1)!, 1, dest)

    const newId = simulateAdd(h, 'Brainstorm')
    expect(newId).not.toBe(1)

    // Discarding the new add filters the session changelog by its id — which
    // must never catch the pending move-from of the card that left.
    discardFlatListAdd(h.list, h.ctx, 0)
    expect(h.ctx.sessionChanges).toMatchObject([{ action: 'move-from', cardName: 'Sol Ring' }])
  })
})

describe('edit-mode category edits', () => {
  // The categories prompt goes through `ask`, which refuses to open without a terminal.
  stubTty({ stdin: true })

  const env = { sessionConfig: { sets: [] }, excludeDigitalOnly: true }

  async function editCategoriesTo(h: Harness, typed: string): Promise<void> {
    prompts.inject([typed])
    const target = findFlatListEntry(h.list, 1)!
    expect(await editSharedFlatListAction('categories', h.list, h.ctx, target, 1, env)).toBe(true)
  }

  test('stages the event on the session and the changelog, leaving the line untouched', async () => {
    const h = harness([entry('Sol Ring', 1)])
    const before = { ...findFlatListEntry(h.list, 1)! }

    await editCategoriesTo(h, 'Ramp, Artifacts')

    expect(findFlatListEntry(h.list, 1)).toEqual(before)
    expect(h.session.dirty).toBe(true)
    expect(h.session.categories.pending).toMatchObject([
      { action: 'set-categories', cardName: 'Sol Ring', categories: ['Ramp', 'Artifacts'] },
    ])
    expect(h.ctx.sessionChanges).toMatchObject([
      { action: 'set-categories', cardName: 'Sol Ring', categories: ['Ramp', 'Artifacts'] },
    ])
    expect(lastFlatListEditLabel(h.list)).toBe('categories on Sol Ring')
  })

  test('a second category edit of the same NAME blocks the first, though the ids differ', async () => {
    // Two collection copies of one card: different `&N`, one categories entry.
    // A category edit restores a whole-list `set-categories` for the name, so an
    // out-of-order undo of the older one would overwrite the newer assignment.
    const h = harness([
      entry('Sol Ring', 1, { collectorNumber: '221', set: 'c19' }),
      entry('Sol Ring', 2, { collectorNumber: '263', set: 'c21' }),
    ])
    await editCategoriesTo(h, 'Ramp')
    prompts.inject(['Ramp, Artifacts'])
    expect(
      await editSharedFlatListAction(
        'categories',
        h.list,
        h.ctx,
        findFlatListEntry(h.list, 2)!,
        2,
        env,
      ),
    ).toBe(true)

    const items = listFlatListSessionChanges(h.list)
    expect(items[0]!.blocked).toBe('discard the newer "categories on Sol Ring" first')
    expect(items[1]!.blocked).toBeUndefined()
  })

  test('undo re-stages the previous categories and drops the changelog event', async () => {
    const h = harness([entry('Sol Ring', 1)])
    await editCategoriesTo(h, 'Ramp')
    undoFlatListEdit(h.list, h.ctx)

    expect(h.ctx.sessionChanges).toHaveLength(0)
    expect(h.session.categories.pending).toMatchObject([
      { action: 'set-categories', categories: ['Ramp'] },
      { action: 'set-categories', categories: [] },
    ])
  })

  test('setting the session-start value back records nothing (latest wins)', async () => {
    const h = harness([entry('Sol Ring', 1)])
    await editCategoriesTo(h, 'Ramp')
    expect(h.ctx.sessionChanges).toHaveLength(1)
    await editCategoriesTo(h, '')
    expect(h.ctx.sessionChanges).toHaveLength(0)
  })
})
