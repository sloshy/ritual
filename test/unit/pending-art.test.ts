import { describe, expect, test } from 'bun:test'
import type { CardArtRef } from '../../src/list/card-art'
import type { CardArtRefs } from '../../src/editor/card-art-view'
import {
  addCardArtPlan,
  type AddedCopyOutcome,
  applyArtWrites,
  artAfterSave,
  artDisplayRefs,
  artIdRemap,
  artIdsClearedBySave,
  artBeforeActions,
  resolvePendingArt,
  savedCardIdsAfterSave,
} from '../../src/editor/pending-art'
import type { SaveEffect } from '../../src/changes/save-effects'

/**
 * The staged-art bookkeeping an editor does around a save: which write lands on
 * which `&N`, what an undo takes back, and what the list holds afterwards.
 *
 * These are the whole of the mechanism's decision-making — the hook around them
 * (`useCardArt`) only owns signals — so the cases that matter live here rather
 * than behind a browser.
 */

const RING: CardArtRef = { file: 'proxies/sol-ring.png' }
const BOLT: CardArtRef = { url: 'https://example.com/bolt.jpg' }

/** A minimal effect; only the fields the art bookkeeping reads are meaningful. */
function effect(
  action: SaveEffect['action'],
  cardId: number,
  extra: Partial<SaveEffect> = {},
): SaveEffect {
  return { action, cardId, name: 'Card', quantity: 1, ...extra }
}

describe('resolvePendingArt', () => {
  test('aims each staged write at the id the save gave its line', () => {
    const pending = new Map<number, CardArtRef | null>([
      [4, RING],
      [2, BOLT],
    ])
    const effects = [effect('updated', 9, { previousCardId: 4 }), effect('added', 2)]
    expect(resolvePendingArt(pending, effects, [2, 9])).toEqual([
      { cardId: 2, stagedId: 2, art: BOLT },
      { cardId: 9, stagedId: 4, art: RING },
    ])
  })

  test('keeps a renumbered line’s write, which only the post-save ids allow', () => {
    // The regression the liveness filter used to cause: the ids are checked
    // *after* remapping, so the set has to be the one the save produced. A
    // caller passing the ids it held before the save (`4`) would drop the very
    // write the remap exists for.
    const pending = new Map<number, CardArtRef | null>([[4, RING]])
    const effects = [effect('updated', 9, { previousCardId: 4 })]
    expect(resolvePendingArt(pending, effects, [9])).toEqual([
      { cardId: 9, stagedId: 4, art: RING },
    ])
    expect(resolvePendingArt(pending, effects, [4])).toEqual([])
  })

  test('drops a write whose card never made it into the saved list', () => {
    // Adding a card with art and then removing it again cancels both change
    // events: the art is left staged against an id the file has no line for,
    // and the art route would refuse it.
    const pending = new Map<number, CardArtRef | null>([
      [3, RING],
      [5, BOLT],
    ])
    expect(resolvePendingArt(pending, [], [5])).toEqual([{ cardId: 5, stagedId: 5, art: BOLT }])
  })

  test('carries a staged clear through as a write', () => {
    const pending = new Map<number, CardArtRef | null>([[7, null]])
    expect(resolvePendingArt(pending, [], [7])).toEqual([{ cardId: 7, stagedId: 7, art: null }])
  })
})

describe('artIdRemap', () => {
  test('reads only the lines the save renumbered', () => {
    const effects = [
      effect('updated', 8, { previousCardId: 3 }),
      effect('updated', 4),
      effect('added', 5),
    ]
    expect([...artIdRemap(effects)]).toEqual([[3, 8]])
  })
})

describe('artIdsClearedBySave', () => {
  test('clears removed ids and the ids a renumber moved away from', () => {
    const effects = [effect('removed', 2), effect('updated', 8, { previousCardId: 3 })]
    expect([...artIdsClearedBySave(effects)].sort()).toEqual([2, 3])
  })

  test('never clears an id the same save re-filed a line to', () => {
    // A line moved from `&5` to `&2` while the entry that had held `&2` was
    // removed: `&2` is reported removed *and* renumbered-to. The line living
    // there now is the one that arrived, so only `&5` goes stale.
    const effects = [effect('updated', 2, { previousCardId: 5 }), effect('removed', 2)]
    expect([...artIdsClearedBySave(effects)]).toEqual([5])
  })
})

describe('artDisplayRefs', () => {
  test('lays the staged edits over what the list holds', () => {
    const baseline: CardArtRefs = new Map<number, CardArtRef>([
      [1, RING],
      [2, BOLT],
    ])
    const pending = new Map<number, CardArtRef | null>([
      [2, null],
      [3, RING],
    ])
    expect([...artDisplayRefs(baseline, pending)]).toEqual([
      [1, RING],
      [3, RING],
    ])
  })

  test('returns the baseline itself when nothing is staged', () => {
    const baseline: CardArtRefs = new Map([[1, RING]])
    expect(artDisplayRefs(baseline, new Map())).toBe(baseline)
  })
})

describe('artAfterSave', () => {
  test('re-files renumbered art, drops removed art, then applies the writes', () => {
    const baseline: CardArtRefs = new Map<number, CardArtRef>([
      [1, RING],
      [2, BOLT],
    ])
    const effects = [effect('removed', 2), effect('updated', 6, { previousCardId: 1 })]
    const after = artAfterSave(baseline, [{ cardId: 4, stagedId: 4, art: BOLT }], effects)
    expect([...after]).toEqual([
      [6, RING],
      [4, BOLT],
    ])
  })

  test('a staged clear wins over what the list held', () => {
    const baseline: CardArtRefs = new Map([[1, RING]])
    expect([...artAfterSave(baseline, [{ cardId: 1, stagedId: 1, art: null }], [])]).toEqual([])
  })

  test('re-files and drops even when no write landed', () => {
    // What the save did to the ids is settled whether or not the art writes
    // that followed it reached the sidecar.
    const baseline: CardArtRefs = new Map<number, CardArtRef>([
      [1, RING],
      [2, BOLT],
    ])
    const effects = [effect('removed', 2), effect('updated', 6, { previousCardId: 1 })]
    expect([...artAfterSave(baseline, [], effects)]).toEqual([[6, RING]])
  })
})

describe('applyArtWrites', () => {
  test('lays only the writes that landed over the list’s art', () => {
    const baseline: CardArtRefs = new Map<number, CardArtRef>([
      [1, RING],
      [2, BOLT],
    ])
    const after = applyArtWrites(baseline, [
      { cardId: 2, stagedId: 2, art: null },
      { cardId: 3, stagedId: 7, art: RING },
    ])
    expect([...after]).toEqual([
      [1, RING],
      [3, RING],
    ])
  })

  test('returns the list’s art itself when nothing landed', () => {
    // Every art write of a save failing must not invalidate the editors' memos.
    const baseline: CardArtRefs = new Map([[1, RING]])
    expect(applyArtWrites(baseline, [])).toBe(baseline)
  })
})

describe('savedCardIdsAfterSave', () => {
  test('adds what the save wrote and forgets what it removed', () => {
    const effects = [effect('added', 3), effect('removed', 2)]
    expect([...savedCardIdsAfterSave(new Set([1, 2]), effects)].sort()).toEqual([1, 3])
  })

  test('an id handed to a new card in the same save stays known', () => {
    // The pool gave the added card the `&2` the removal freed: both effects
    // carry id 2, and the card that arrived is the one now on disk.
    const effects = [effect('added', 2), effect('removed', 2)]
    expect([...savedCardIdsAfterSave(new Set([1, 2]), effects)].sort()).toEqual([1, 2])
  })

  test('a renumbered line is known by its new id only', () => {
    const effects = [effect('updated', 9, { previousCardId: 4 })]
    expect([...savedCardIdsAfterSave(new Set([4]), effects)]).toEqual([9])
  })

  test('lines the save did not touch stay known', () => {
    expect([...savedCardIdsAfterSave(new Set([1, 2]), [])].sort()).toEqual([1, 2])
  })
})

describe('addCardArtPlan', () => {
  const recorded = (cardId: number | undefined): AddedCopyOutcome => ({ kind: 'recorded', cardId })
  const cancelled = (cardId: number, survivorId: number | undefined): AddedCopyOutcome => ({
    kind: 'cancelled',
    cardId,
    survivorId,
  })

  test('a new line stages whatever the add carried, art or a clear', () => {
    expect(addCardArtPlan({ mergeTarget: null, art: RING, copies: [recorded(4)] })).toEqual([
      [{ kind: 'set', cardId: 4, art: RING }],
    ])
    // The clear matters as much as the write: the pool hands out the ids
    // removals freed, so a fresh line can land on an `&N` the sidecar still
    // files art under.
    expect(addCardArtPlan({ mergeTarget: null, art: null, copies: [recorded(4)] })).toEqual([
      [{ kind: 'set', cardId: 4, art: null }],
    ])
  })

  test('copies sharing one new line stage it once, under the first copy', () => {
    expect(
      addCardArtPlan({ mergeTarget: null, art: RING, copies: [recorded(4), recorded(4)] }),
    ).toEqual([[{ kind: 'set', cardId: 4, art: RING }], []])
  })

  test('per-entry copies each stage their own line', () => {
    expect(
      addCardArtPlan({ mergeTarget: null, art: RING, copies: [recorded(4), recorded(5)] }),
    ).toEqual([[{ kind: 'set', cardId: 4, art: RING }], [{ kind: 'set', cardId: 5, art: RING }]])
  })

  test('copies joining an existing line only speak up when art was named', () => {
    const mergeTarget = { cardId: 5 }
    expect(addCardArtPlan({ mergeTarget, art: RING, copies: [recorded(5)] })).toEqual([
      [{ kind: 'set', cardId: 5, art: RING }],
    ])
    // Adding a copy without art must never clear what the target line wears.
    expect(addCardArtPlan({ mergeTarget, art: null, copies: [recorded(5)] })).toEqual([[]])
  })

  test('a merging copy that cancels a pending decrement leaves the line’s art alone', () => {
    const mergeTarget = { cardId: 5 }
    expect(addCardArtPlan({ mergeTarget, art: null, copies: [cancelled(5, 5)] })).toEqual([[]])
    expect(addCardArtPlan({ mergeTarget, art: BOLT, copies: [cancelled(5, 5)] })).toEqual([
      [{ kind: 'set', cardId: 5, art: BOLT }],
    ])
  })

  test('a merge onto a line with no id stages nothing', () => {
    expect(
      addCardArtPlan({
        mergeTarget: { cardId: undefined },
        art: RING,
        copies: [recorded(undefined)],
      }),
    ).toEqual([[]])
  })

  test('a plain re-add that cancels a removal takes its staging back', () => {
    // The session now touches nothing, so the surviving line is left exactly as
    // the file has it — art included, and the carried id gives up its staging.
    expect(addCardArtPlan({ mergeTarget: null, art: null, copies: [cancelled(5, 5)] })).toEqual([
      [{ kind: 'reset', cardId: 5 }],
    ])
  })

  test('copies after one that restored its line join that line, never clearing its art', () => {
    // Deck `&5 ×1`, removed, then Add Card ×2 of the same printing: the first
    // copy cancels the removal (the line is back), the second merges onto it —
    // and must not stage a clear that would delete the line's art on save.
    expect(
      addCardArtPlan({ mergeTarget: null, art: null, copies: [cancelled(5, 5), recorded(5)] }),
    ).toEqual([[{ kind: 'reset', cardId: 5 }], []])
  })

  test('a re-add carrying art puts it on the line that survived', () => {
    // Owner rule: art returns after a removal either through undo or through a
    // re-add that names art. The pool hands the re-add the number the removal
    // released — which is why the two cancel — so one staging is all it takes,
    // and a reset would undo the write beside it.
    expect(addCardArtPlan({ mergeTarget: null, art: BOLT, copies: [cancelled(2, 2)] })).toEqual([
      [{ kind: 'set', cardId: 2, art: BOLT }],
    ])
  })

  test('a cancellation naming a different line retires the carried id first', () => {
    expect(addCardArtPlan({ mergeTarget: null, art: BOLT, copies: [cancelled(7, 2)] })).toEqual([
      [
        { kind: 'reset', cardId: 7 },
        { kind: 'set', cardId: 2, art: BOLT },
      ],
    ])
  })

  test('art is refused, not misfiled, when the cancelled removal names no line', () => {
    // A removal with no `&N` still cancels an add that has one, and then there
    // is no line to aim at: staging against the carried id would write to a
    // number no saved line holds, which the save's liveness filter drops without
    // a word. Taking the staging back keeps the sidecar honest instead.
    expect(
      addCardArtPlan({ mergeTarget: null, art: RING, copies: [cancelled(7, undefined)] }),
    ).toEqual([[{ kind: 'reset', cardId: 7 }]])
  })
})

describe('artBeforeActions', () => {
  test('records what each touched id held, once per id, nothing staged as undefined', () => {
    const staged = new Map<number, CardArtRef | null>([
      [2, RING],
      [3, null],
    ])
    expect(
      artBeforeActions(
        [
          { kind: 'reset', cardId: 7 },
          { kind: 'set', cardId: 2, art: BOLT },
          { kind: 'set', cardId: 3, art: BOLT },
          { kind: 'set', cardId: 2, art: null },
        ],
        (cardId) => (staged.has(cardId) ? (staged.get(cardId) ?? null) : undefined),
      ),
    ).toEqual([
      { cardId: 7, before: undefined },
      { cardId: 2, before: RING },
      { cardId: 3, before: null },
    ])
  })
})
