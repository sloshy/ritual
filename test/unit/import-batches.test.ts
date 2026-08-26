import { describe, expect, test } from 'bun:test'
import type { ChangeEvent } from '../../src/changes/change-event'
import type { ChangeBundle, ChangeBundleMove } from '../../src/changes/change-bundle'
import { planImportBatches } from '../../src/admin/api/import-batches'

const DECK = { kind: 'deck', slug: 'burn', name: 'Burn' } as const
const BINDER = { kind: 'collection', slug: 'binder', name: 'Binder' } as const

function add(id: string, timestamp: number, cardName: string): ChangeEvent {
  return { id, timestamp, action: 'add', cardName }
}

function bundle(lists: ChangeBundle['lists'], moves: ChangeBundleMove[] = []): ChangeBundle {
  return { format: 'ritual-change-bundle', version: 2, exportedAt: 'now', lists, moves }
}

describe('planImportBatches', () => {
  test('interleaves lists by timestamp and cuts a batch at every change of list', () => {
    const plan = planImportBatches(
      bundle([
        { ...DECK, changes: [add('d1', 1, 'Bolt'), add('d2', 3, 'Shock')] },
        { ...BINDER, changes: [add('c1', 2, 'Sol Ring')] },
      ]),
    )
    expect(plan.targets).toEqual([DECK, BINDER])
    expect(plan.batches.map((b) => [b.target, b.changes.map((c) => c.id)])).toEqual([
      [0, ['d1']],
      [1, ['c1']],
      [0, ['d2']],
    ])
  })

  test('a move becomes a move-to on its destination, carrying the source id hint and section', () => {
    const move: ChangeBundleMove = {
      id: 'm1',
      timestamp: 2,
      cardName: 'Sol Ring',
      from: BINDER,
      to: DECK,
      set: 'c21',
      collectorNumber: '263',
      finish: 'foil',
      cardId: 7,
      section: 'Sideboard',
    }
    const plan = planImportBatches(
      bundle([{ ...DECK, changes: [add('d1', 1, 'Bolt'), add('d2', 3, 'Shock')] }], [move]),
    )
    // The source list is a target too (so the report names every list the
    // import touched) but gets no batch: the destination's save takes the copy
    // out of it.
    expect(plan.targets).toEqual([DECK, BINDER])
    expect(plan.batches).toHaveLength(1)
    expect(plan.batches[0]!.changes.map((c) => c.id)).toEqual(['d1', 'm1', 'd2'])
    // The projection itself is moveToEventOf's contract (pinned in
    // change-bundle.test.ts); what the plan owns is where the event lands.
    expect(plan.batches[0]!.changes[1]).toMatchObject({
      action: 'move-to',
      from: { type: 'collection', name: 'Binder' },
      sourceCardId: 7,
      section: 'Sideboard',
    })
    expect(plan.batches[0]!.changes[1]).toHaveProperty('cardId', undefined)
  })

  test('a destination named only by a move is appended as its own target, reused by later moves', () => {
    const plan = planImportBatches(
      bundle(
        [{ ...DECK, changes: [] }],
        [
          {
            id: 'm1',
            timestamp: 1,
            cardName: 'A',
            from: DECK,
            to: { kind: 'collection', name: 'Binder' },
          },
          // The same list, this time with its slug known: one target, not two.
          { id: 'm2', timestamp: 2, cardName: 'B', from: DECK, to: BINDER },
        ],
      ),
    )
    expect(plan.targets).toEqual([DECK, { kind: 'collection', name: 'Binder' }])
    expect(plan.batches.map((b) => [b.target, b.changes.map((c) => c.id)])).toEqual([
      [1, ['m1', 'm2']],
    ])
  })

  test('two lists sharing a display name under different slugs are two targets', () => {
    const twin = { kind: 'deck', slug: 'burn-2', name: 'Burn' } as const
    const plan = planImportBatches(
      bundle([
        { ...DECK, changes: [add('d1', 1, 'Bolt')] },
        { ...twin, changes: [add('t1', 2, 'Shock')] },
      ]),
    )
    expect(plan.targets).toEqual([DECK, twin])
    expect(plan.batches.map((b) => b.target)).toEqual([0, 1])
  })

  test('events sharing a timestamp keep their recorded order: list changes before moves', () => {
    const plan = planImportBatches(
      bundle(
        [{ ...DECK, changes: [add('d1', 5, 'Bolt'), add('d2', 5, 'Shock')] }],
        [{ id: 'm1', timestamp: 5, cardName: 'Sol Ring', from: BINDER, to: DECK }],
      ),
    )
    expect(plan.batches).toHaveLength(1)
    expect(plan.batches[0]!.changes.map((c) => c.id)).toEqual(['d1', 'd2', 'm1'])
  })
})
