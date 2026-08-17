import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  createSessionArtChanges,
  currentSessionArt,
  noteArtArrival,
  noteArtLineRemoved,
  noteArtLineRestored,
  noteArtRepack,
  noteArtSet,
  pendingSessionArt,
  type SessionArtChanges,
} from '../../src/commands/session-art'
import type { CardArtRef } from '../../src/card-art'

const proxy: CardArtRef = { file: 'proxies/sol-ring.jpg' }
const alter: CardArtRef = { file: 'alters/island.webp' }
const remote: CardArtRef = { url: 'https://example.com/bolt.png' }

/** The reconcile input a save would apply, as plain data. */
function pending(art: SessionArtChanges): { removed: number[]; added: [number, CardArtRef][] } {
  const input = pendingSessionArt(art)
  return {
    removed: [...(input.removed ?? [])].sort((a, b) => a - b),
    added: [...(input.added ?? [])].sort((a, b) => a[0] - b[0]),
  }
}

describe('session art — staging an edit', () => {
  test('a set files the reference, a clear drops it', () => {
    const art = createSessionArtChanges()
    noteArtSet(art, 5, proxy)
    noteArtSet(art, 12, null)
    expect(pending(art)).toEqual({ removed: [12], added: [[5, proxy]] })
  })

  test('the newest set for a card wins', () => {
    const art = createSessionArtChanges()
    noteArtSet(art, 5, proxy)
    noteArtSet(art, 5, alter)
    expect(pending(art)).toEqual({ removed: [], added: [[5, alter]] })
  })

  test('an edit outranks the art a moved card arrived with', () => {
    const art = createSessionArtChanges()
    noteArtArrival(art, 5, proxy)
    noteArtSet(art, 5, remote)
    expect(pending(art)).toEqual({ removed: [], added: [[5, remote]] })
  })

  test('an arrival outranks an edit staged for the id the moved card took over', () => {
    // The id belonged to a different card, so the edit filed under it is not
    // about the card that has it now.
    const art = createSessionArtChanges()
    noteArtSet(art, 5, proxy)
    noteArtLineRemoved(art, 5)
    noteArtArrival(art, 5, remote)
    expect(pending(art)).toEqual({ removed: [], added: [[5, remote]] })
  })
})

describe('session art — edits meeting a removal', () => {
  test('removing the line wins over art set on it earlier', () => {
    const art = createSessionArtChanges()
    noteArtSet(art, 5, proxy)
    noteArtLineRemoved(art, 5)
    expect(pending(art)).toEqual({ removed: [5], added: [] })
  })

  test('undoing that removal brings the staged art back with the line', () => {
    const art = createSessionArtChanges()
    noteArtSet(art, 5, proxy)
    noteArtLineRemoved(art, 5)
    noteArtLineRestored(art, 5)
    expect(pending(art)).toEqual({ removed: [], added: [[5, proxy]] })
  })

  test('art set on a new line that took a freed id survives that removal', () => {
    const art = createSessionArtChanges()
    noteArtLineRemoved(art, 5)
    noteArtSet(art, 5, proxy)
    expect(pending(art)).toEqual({ removed: [], added: [[5, proxy]] })
  })
})

describe('session art — a discard re-packing ids', () => {
  test('the discarded line loses its staged art and survivors follow the re-pack', () => {
    const art = createSessionArtChanges()
    noteArtSet(art, 5, proxy)
    noteArtSet(art, 6, alter)
    noteArtRepack(art, new Map([[6, 5]]), 5)
    expect(pending(art)).toEqual({ removed: [], added: [[5, alter]] })
  })

  test('a discard with no re-pack only drops the discarded line', () => {
    const art = createSessionArtChanges()
    noteArtSet(art, 5, proxy)
    noteArtSet(art, 6, alter)
    noteArtRepack(art, new Map(), 6)
    expect(pending(art)).toEqual({ removed: [], added: [[5, proxy]] })
  })

  test('art a moved-in card arrived with follows the re-pack too', () => {
    // The `added` channel is re-packed exactly like `edited`: a cross-list
    // move's arrival is a session add, and discarding an earlier one renumbers
    // it down like any other line.
    const art = createSessionArtChanges()
    noteArtArrival(art, 5, proxy)
    noteArtArrival(art, 6, alter)
    noteArtRepack(art, new Map([[6, 5]]), 5)
    expect(pending(art)).toEqual({ removed: [], added: [[5, alter]] })
  })

  test('discarding an arrival drops the art it brought', () => {
    const art = createSessionArtChanges()
    noteArtArrival(art, 5, proxy)
    noteArtRepack(art, new Map(), 5)
    expect(pending(art)).toEqual({ removed: [], added: [] })
  })
})

describe('session art — a discard giving back a cancelled removal', () => {
  test('discarding the add that took a freed id restores the removal', () => {
    // `&5`'s card left, freeing the id; the next card added took it and had art
    // set on it, which cancelled the removal. Discarding that add leaves `&5`
    // free again — so the departed card's art must go after all, rather than
    // wait under a free number for the next card to inherit.
    const art = createSessionArtChanges()
    noteArtLineRemoved(art, 5)
    noteArtSet(art, 5, proxy)
    noteArtRepack(art, new Map(), 5)
    expect(pending(art)).toEqual({ removed: [5], added: [] })
  })

  test('discarding an arrival that took a freed id restores the removal', () => {
    const art = createSessionArtChanges()
    noteArtLineRemoved(art, 5)
    noteArtArrival(art, 5, remote)
    noteArtRepack(art, new Map(), 5)
    expect(pending(art)).toEqual({ removed: [5], added: [] })
  })

  test('a re-pack hands the cancellation to whichever line ends up on the id', () => {
    // Two ids were freed; two session adds took them and both got art. The
    // discard of the first re-packs the second down onto `&5`, so `&5` keeps
    // its cancellation while `&7` — vacated — gets its removal back.
    const art = createSessionArtChanges()
    noteArtLineRemoved(art, 5)
    noteArtLineRemoved(art, 7)
    noteArtSet(art, 5, proxy)
    noteArtSet(art, 7, alter)
    noteArtRepack(art, new Map([[7, 5]]), 5)
    expect(pending(art)).toEqual({ removed: [7], added: [[5, alter]] })
  })

  test('a survivor without art leaves the removal it lands on standing', () => {
    const art = createSessionArtChanges()
    noteArtLineRemoved(art, 5)
    noteArtSet(art, 5, proxy)
    noteArtRepack(art, new Map([[6, 5]]), 5)
    expect(pending(art)).toEqual({ removed: [5], added: [] })
  })

  test('an undone removal takes its cancellation record with it', () => {
    const art = createSessionArtChanges()
    noteArtLineRemoved(art, 5)
    noteArtSet(art, 5, proxy)
    noteArtLineRestored(art, 5)
    noteArtRepack(art, new Map(), 5)
    expect(pending(art)).toEqual({ removed: [], added: [] })
  })
})

describe('session art — what a card wears now', () => {
  // A real (empty) temp directory rather than a made-up absolute path: the
  // baseline read falls through to `<file>.art.json`, and a unit test must not
  // depend on what happens to sit at `/lists` on the machine running it.
  let dir: string
  let file: string

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ritual-session-art-'))
    file = path.join(dir, 'never-read.md')
  })

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  test('a staged set, clear, arrival, and removal all answer without the sidecar', async () => {
    const art = createSessionArtChanges()
    noteArtSet(art, 1, proxy)
    noteArtSet(art, 2, null)
    noteArtArrival(art, 3, remote)
    noteArtLineRemoved(art, 4)
    expect(await currentSessionArt(file, art, 1)).toEqual({ ok: true, ref: proxy })
    expect(await currentSessionArt(file, art, 2)).toEqual({ ok: true, ref: null })
    expect(await currentSessionArt(file, art, 3)).toEqual({ ok: true, ref: remote })
    expect(await currentSessionArt(file, art, 4)).toEqual({ ok: true, ref: null })
    // Nothing pending for this id, but the baseline read is what would go to
    // disk — an absent sidecar simply reads as no art.
    expect(await currentSessionArt(file, art, 9)).toEqual({ ok: true, ref: null })
  })

  test('the sidecar already on disk answers for an untouched card', async () => {
    const art = createSessionArtChanges()
    art.baseline = new Map([[7, proxy]])
    expect(await currentSessionArt(file, art, 7)).toEqual({ ok: true, ref: proxy })
    expect(await currentSessionArt(file, art, 8)).toEqual({ ok: true, ref: null })
  })
})
