import { describe, expect, test } from 'bun:test'
import {
  csvRowChange,
  printingOf,
  pushOperationChange,
  recordCardChange,
} from '../../../src/collection-sync/card-changes'
import type { CollectionKeyParts } from '../../../src/collection-sync/describe'
import {
  pullChangesByList,
  type PushCreate,
  type PushOperation,
} from '../../../src/collection-sync/diff'
import type { ArchidektCollectionRecord } from '../../../src/importers/archidekt-collection'
import type { CollectionSyncCardChange } from '../../../src/collection-sync/types'

/**
 * The structured per-card changes a collection sync reports for each list. The
 * wording rendered from them is pinned in describe.test.ts; the engine wiring
 * (which lists are credited, what a failure drops) in engine.test.ts.
 */

const SOL_RING: CollectionKeyParts = {
  set: 'ltc',
  collectorNumber: '284',
  finish: 'nonfoil',
  condition: 'NM',
}
const DELVER: CollectionKeyParts = {
  set: 'isd',
  collectorNumber: '51',
  finish: 'foil',
  condition: 'LP',
  language: 'ja',
}

/** A record the update and delete operations name; only its identity matters here. */
const RECORD = { id: 1 } as ArchidektCollectionRecord

const CREATE: PushCreate = {
  kind: 'create',
  key: 'k',
  parts: SOL_RING,
  name: 'Sol Ring',
  lists: ['binder'],
  quantity: 2,
}

describe('pullChangesByList cardChanges', () => {
  test('names a removal as the local line spells it, an addition as the resolver does', () => {
    const changes = pullChangesByList(
      {
        removals: [
          {
            key: 'k',
            parts: DELVER,
            name: 'Delver of Secrets',
            list: 'long-box',
            copies: [
              {
                list: 'long-box',
                name: 'Delver of Secrets // Insectile Aberration',
                parts: DELVER,
                fileOrder: 3,
              },
              {
                list: 'long-box',
                name: 'Delver of Secrets // Insectile Aberration',
                parts: DELVER,
                fileOrder: 4,
              },
            ],
          },
        ],
        additions: [
          { key: 'k2', parts: DELVER, name: 'Delver of Secrets', scryfallId: 'id', quantity: 1 },
        ],
        ambiguous: [],
        skipped: 0,
      },
      'inbox',
      () => 'Delver of Secrets // Insectile Aberration',
    )
    expect(changes.map((list) => [list.list, list.cardChanges])).toEqual([
      [
        'long-box',
        [
          {
            kind: 'removed',
            name: 'Delver of Secrets // Insectile Aberration',
            quantity: 2,
            printing: DELVER,
          },
        ],
      ],
      [
        'inbox',
        [
          {
            kind: 'added',
            name: 'Delver of Secrets // Insectile Aberration',
            quantity: 1,
            printing: DELVER,
          },
        ],
      ],
    ])
  })
})

describe('pushOperationChange', () => {
  test('a create or a grown record adds copies; a trim or a delete removes them', () => {
    const base = { key: 'k', parts: SOL_RING, name: 'Sol Ring', lists: ['binder'] }
    const operations: PushOperation[] = [
      CREATE,
      { ...base, kind: 'update', record: RECORD, quantity: 5, delta: 2 },
      { ...base, kind: 'update', record: RECORD, quantity: 1, delta: -3 },
      { ...base, kind: 'delete', records: [RECORD], removed: 4 },
    ]
    expect(operations.map(pushOperationChange)).toEqual([
      { kind: 'added', name: 'Sol Ring', quantity: 2, printing: SOL_RING },
      { kind: 'added', name: 'Sol Ring', quantity: 2, printing: SOL_RING },
      { kind: 'removed', name: 'Sol Ring', quantity: 3, printing: SOL_RING },
      { kind: 'removed', name: 'Sol Ring', quantity: 4, printing: SOL_RING },
    ])
  })

  test('a CSV row is added via the CSV, or pending when the CSV went to a file', () => {
    expect(csvRowChange(CREATE, 'added')).toEqual({
      kind: 'added',
      via: 'csv',
      name: 'Sol Ring',
      quantity: 2,
      printing: SOL_RING,
    })
    expect(csvRowChange(CREATE, 'pending')).toEqual({
      kind: 'pending',
      name: 'Sol Ring',
      quantity: 2,
      printing: SOL_RING,
    })
  })
})

describe('printingOf', () => {
  test('an explicit English language is dropped, like an absent one', () => {
    expect(printingOf({ ...SOL_RING, language: 'en' })).toEqual(SOL_RING)
    expect(printingOf(DELVER)).toEqual(DELVER)
  })
})

describe('recordCardChange', () => {
  test('one entry per card, printing and kind: a trim and a delete fold together', () => {
    const changes: CollectionSyncCardChange[] = []
    const removed = (quantity: number): CollectionSyncCardChange => ({
      kind: 'removed',
      name: 'Sol Ring',
      quantity,
      printing: SOL_RING,
    })
    recordCardChange(changes, removed(1))
    recordCardChange(changes, removed(2))
    recordCardChange(changes, { kind: 'added', name: 'Sol Ring', quantity: 1, printing: SOL_RING })
    recordCardChange(changes, { ...removed(1), printing: DELVER })
    expect(changes).toEqual([
      removed(3),
      { kind: 'added', name: 'Sol Ring', quantity: 1, printing: SOL_RING },
      { ...removed(1), printing: DELVER },
    ])
  })
})
