import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import prompts from 'prompts'
import { loadCardArt, saveCardArt, type CardArtRef } from '../../src/card-art'
import { buildInitialSessionConfig } from '../../src/commands/card-session'
import type { DeckSessionConfig } from '../../src/commands/deck-helpers'
import { openListSession, saveOpenList, type OpenList } from '../../src/commands/edit-lists'
import type { ListType } from '../../src/list-type'
import { stubTty } from '../test-utils'
import {
  bindWorkspace,
  writeCollectionFile,
  writeDeckFile,
  type BoundWorkspace,
} from './helpers/workspace'

/**
 * The editor's Set Custom Art action end to end: the action stages a reference,
 * and the session's save is what writes `<list>.art.json`. The staging rules
 * themselves are pinned by the unit tests (`session-art.test.ts` and the two
 * strategies'); this covers the wiring and the file side effects — including
 * that exiting without saving writes nothing.
 */

// `ask` refuses to prompt without a terminal; the action is answered with
// prompts.inject, so pretend stdin is one.
stubTty({ stdin: true })

let ws: BoundWorkspace
let tmpDir: string
let sessionConfig: DeckSessionConfig

beforeEach(async () => {
  sessionConfig = { ...buildInitialSessionConfig({}, undefined), targetSection: null }
  ws = await bindWorkspace({ config: false })
  tmpDir = ws.dir
  await writeCollectionFile(tmpDir, 'binder', {
    title: 'Binder',
    entries: [{ name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 1 }],
  })
  await writeDeckFile(tmpDir, 'my-deck', {
    frontMatter: { name: 'My Deck' },
    cards: [{ quantity: 1, name: 'Sol Ring', set: 'c19', collectorNumber: '221', cardId: 1 }],
  })
})

afterEach(async () => {
  await ws.dispose()
})

function openList(type: ListType, name: string, file: string): Promise<OpenList> {
  return openListSession({ type, name, file: path.join(tmpDir, file) }, sessionConfig, true)
}

const binderFile = (): string => path.join(tmpDir, 'collections', 'binder.md')
const deckFile = (): string => path.join(tmpDir, 'decks', 'my-deck.md')

describe('the editor’s Set Custom Art action', () => {
  test('a collection entry’s art is written by the save, not by the action', async () => {
    const binder = await openList('collection', 'Binder', 'collections/binder.md')

    prompts.inject(['art', 'url', 'https://example.test/bolt.png'])
    await binder.strategy.editEntry(binder.ctx, 1)
    // Nothing on disk yet — the sidecar rides the session's save.
    expect(await loadCardArt(binderFile())).toEqual({ ok: true, art: new Map(), warnings: [] })

    expect(await saveOpenList(binder, () => [binder])).toBe(true)

    const saved = await loadCardArt(binderFile())
    expect(saved.ok && [...saved.art.entries()]).toEqual([
      [1, { url: 'https://example.test/bolt.png' }],
    ])
    // Art is metadata: the card line is untouched and the changelog records nothing.
    expect(await fs.readFile(binderFile(), 'utf-8')).toContain('- Lightning Bolt (LEA:161) &1')
    expect(
      await Bun.file(path.join(tmpDir, 'collections', 'binder.changes.md')).exists(),
    ).toBeFalse()
  })

  test('clearing a deck line’s art deletes the sidecar it emptied', async () => {
    await saveCardArt(deckFile(), new Map<number, CardArtRef>([[1, { file: 'proxies/ring.png' }]]))
    const deck = await openList('deck', 'My Deck', 'decks/my-deck.md')

    // The clear row is offered because the card already has art — read from the
    // sidecar on disk, which is what the prompt shows as its current value.
    prompts.inject(['art', 'clear'])
    await deck.strategy.editEntry(deck.ctx, 1)
    expect(await saveOpenList(deck, () => [deck])).toBe(true)

    expect(await Bun.file(deckFile().replace(/\.md$/, '.art.json')).exists()).toBeFalse()
  })

  test('browsing the art directory stages the path of the file picked, two levels down', async () => {
    // The browser walks real directories, so the tree has to be real: the rows
    // it offers come from `fs.readdir` and the value it stages is the path it
    // built while descending.
    await fs.mkdir(path.join(tmpDir, 'art', 'proxies', 'mono'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'art', 'proxies', 'mono', 'sol-ring.jpg'), 'jpeg')
    const deck = await openList('deck', 'My Deck', 'decks/my-deck.md')

    prompts.inject([
      'art',
      'file',
      { kind: 'dir', path: 'proxies' },
      { kind: 'dir', path: 'proxies/mono' },
      { kind: 'file', path: 'proxies/mono/sol-ring.jpg' },
    ])
    await deck.strategy.editEntry(deck.ctx, 1)
    expect(await saveOpenList(deck, () => [deck])).toBe(true)

    const saved = await loadCardArt(deckFile())
    expect(saved.ok && [...saved.art.entries()]).toEqual([
      [1, { file: 'proxies/mono/sol-ring.jpg' }],
    ])
  })

  test('an art directory that is not there leaves the session untouched', async () => {
    // `artDir` is never created eagerly, so "browse for a file" before the user
    // has made one must back out rather than stage anything.
    const binder = await openList('collection', 'Binder', 'collections/binder.md')

    prompts.inject(['art', 'file'])
    await binder.strategy.editEntry(binder.ctx, 1)

    expect(binder.strategy.hasUnsavedChanges()).toBeFalse()
    expect(await Bun.file(binderFile().replace(/\.md$/, '.art.json')).exists()).toBeFalse()
  })

  test('submitting the URL prompt empty backs out rather than refusing a blank URL', async () => {
    // The parser would report `"" is not a valid URL`, which reads as a typo
    // rather than as the "never mind" it was; dropping art is the Clear row's job.
    await saveCardArt(binderFile(), new Map<number, CardArtRef>([[1, { file: 'alters/one.png' }]]))
    const binder = await openList('collection', 'Binder', 'collections/binder.md')

    const errors: string[] = []
    const originalError = console.error
    console.error = (...args: unknown[]) => void errors.push(args.join(' '))
    try {
      prompts.inject(['art', 'url', ''])
      await binder.strategy.editEntry(binder.ctx, 1)
    } finally {
      console.error = originalError
    }

    expect(errors).toEqual([])
    expect(binder.strategy.hasUnsavedChanges()).toBeFalse()
    expect(await saveOpenList(binder, () => [binder])).toBe(true)
    const saved = await loadCardArt(binderFile())
    expect(saved.ok && [...saved.art.entries()]).toEqual([[1, { file: 'alters/one.png' }]])
  })

  test('a sidecar that cannot be read refuses the action instead of overwriting it', async () => {
    // Saving re-files the whole sidecar, so an art edit staged against a file
    // Ritual cannot read would erase whatever is in it. The action stops before
    // it prompts for a reference — the only injection consumed is the menu row.
    const sidecar = binderFile().replace(/\.md$/, '.art.json')
    await fs.writeFile(sidecar, '{ "1": { "file": ')
    const binder = await openList('collection', 'Binder', 'collections/binder.md')

    prompts.inject(['art'])
    await binder.strategy.editEntry(binder.ctx, 1)

    expect(binder.strategy.hasUnsavedChanges()).toBeFalse()
    expect(await fs.readFile(sidecar, 'utf-8')).toBe('{ "1": { "file": ')
  })

  // The undo restore lives in each session kind's own edit module
  // (`flat-list-edit`'s and `deck-edit`'s `restoreArt` branch), so both are
  // pinned by the value that survives the save rather than by the undo label.
  const UNDO_LISTS: [ListType, string, string][] = [
    ['collection', 'Binder', 'collections/binder.md'],
    ['deck', 'My Deck', 'decks/my-deck.md'],
  ]

  test.each(UNDO_LISTS)(
    'a %s art edit taken back before the save leaves the sidecar as it was',
    async (type, name, file) => {
      const listFile = path.join(tmpDir, file)
      await saveCardArt(listFile, new Map<number, CardArtRef>([[1, { file: 'alters/one.png' }]]))
      const open = await openList(type, name, file)

      prompts.inject(['art', 'url', 'https://example.test/other.png'])
      await open.strategy.editEntry(open.ctx, 1)
      await open.strategy.undoLastEdit(open.ctx)
      expect(await saveOpenList(open, () => [open])).toBe(true)

      const saved = await loadCardArt(listFile)
      expect(saved.ok && [...saved.art.entries()]).toEqual([[1, { file: 'alters/one.png' }]])
    },
  )
})
