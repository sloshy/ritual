import { afterAll, beforeAll, describe, expect, setSystemTime, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  createList,
  deleteList,
  isListLifecycleError,
  renameList,
  requireDeleteConfirmation,
} from '../../src/list/list-lifecycle'
import { ensureCardIdsForAllLists } from '../../src/list/ensure-card-ids'
import { applyDeckAdd, applyTargetedChanges } from '../../src/list/line-mutate'
import {
  isCardArtRefError,
  parseCardArtRef,
  reconcileCardArt,
  saveCardArt,
} from '../../src/list/card-art'
import { isListImageRefError, parseListImage } from '../../src/list/list-image'
import { applyDeckMetadata } from '../../src/list/deck-metadata'
import { invalidDeckFormatMessage } from '../../src/list/deck-format'
import { unreadableContentMessage, unreadableProblems } from '../../src/list/unreadable-content'
import { saveList } from '../helpers/list-save'
import {
  checkListImageCardId,
  readListImageFile,
  writeListImage,
} from '../../src/list/list-image-file'
import { applyFlatListMetadata } from '../../src/list/flat-list-metadata'
import { parseCollectionFile } from '../../src/list/collection-file'
import {
  createMoveFromChange,
  createSetCategoriesChange,
  createSetNoteChange,
  createSetSectionChange,
} from '../../src/changes/change-event'
import {
  isSyncMessage,
  renderSyncMessage,
  SyncMessageError,
  syncText,
  type SyncMessage,
} from '../../src/sync/message'
import { bindWorkspace, snapshotTree } from '../helpers/workspace'
import { expectLocaleInForce, foreignLocales, withSyntheticLocaleAsync } from '../helpers/sync-text'

/**
 * What the list-file engines write is the same bytes in every UI language.
 *
 * List files, their `.sha256` and `.changes.md` sidecars, the custom-art
 * `.art.json`, the categories sidecar and the front matter (a cover image, a
 * description, default labels) are workspace data a collaborator's Ritual reads
 * back. Each run below creates, renames and deletes lists, backfills `&N` ids
 * into hand-written lines, edits card lines, files and re-files custom art,
 * points a cover at a card, writes metadata and categories — and asks every
 * engine for a refusal along the way (a name collision, an unusable name, an
 * unreadable front-matter block, a cover naming no card, an engine guard).
 * Every byte written must match an English run, and every refusal's English
 * (what the admin API and MCP answer with) must match too, while its rendering
 * follows the locale.
 */

/** The workspace after a run, plus the English of every refusal the engines returned. */
type ListRun = { files: Record<string, string>; english: string[]; rendered: string[] }

/** A collection written by hand: no `&N` ids, a pasted quantity, an unusable `labels:` value. */
const BINDER = [
  '---',
  'labels: [sale, bogus]',
  '---',
  '# Binder',
  '',
  '- 2 Sol Ring (C19:221)',
  '- Arcane Signet (FDN:266)',
  '',
].join('\n')

/** A wanted list whose front matter is a YAML list, not a mapping. */
const UNMAPPED = ['---', '- just', '- a list', '---', '# Odd', '', '- Black Lotus', ''].join('\n')

/** Run every engine into a fresh workspace, in whatever UI language is in force. */
async function writeEverything(): Promise<ListRun> {
  const ws = await bindWorkspace()
  const refusals: SyncMessage[] = []
  const refuse = (message: SyncMessage | null): void => {
    if (message === null) throw new Error('expected a refusal')
    refusals.push(message)
  }
  try {
    const decks = path.join(ws.dir, 'decks')
    const collections = path.join(ws.dir, 'collections')
    const wanted = path.join(ws.dir, 'wanted')

    // ── Lifecycle ──
    for (const [type, name, format] of [
      ['deck', 'Burn', 'modern'],
      ['collection', 'Binder', undefined],
      ['wanted', 'Wants', undefined],
      ['wanted', 'Gone', undefined],
    ] as const) {
      const created = await createList(type, name, format)
      if (isListLifecycleError(created)) throw new Error(created.message.message)
    }
    for (const refused of [
      await createList('deck', 'burn'),
      await createList('collection', '???'),
      await createList('deck', 'Cube', 'cube'),
      await renameList('wanted', path.join(wanted, 'Missing.md'), 'Elsewhere'),
    ]) {
      if (!isListLifecycleError(refused)) throw new Error('expected a lifecycle refusal')
      refuse(refused.message)
    }
    refuse(requireDeleteConfirmation('gone', 'Gone'))

    // ── Hand-written lines, then the `&N` backfill ──
    const deckPath = path.join(decks, 'Burn.md')
    await fs.appendFile(deckPath, '4 Lightning Bolt (M10:146)\n2 Lava Spike\n')
    const binderPath = path.join(collections, 'Binder.md')
    await fs.writeFile(binderPath, BINDER)
    await fs.writeFile(path.join(wanted, 'Odd.md'), UNMAPPED)
    await ensureCardIdsForAllLists()
    // What a read reports about the hand-written block.
    const parsed = parseCollectionFile(await fs.readFile(binderPath, 'utf-8'))
    for (const notice of parsed.notices) refusals.push(notice.message)

    // ── Rename and delete ──
    const renamed = await renameList('collection', binderPath, 'Trade Binder')
    if (isListLifecycleError(renamed)) throw new Error(renamed.message.message)
    const tradePath = renamed.newFilePath
    const deleted = await deleteList('wanted', path.join(wanted, 'Gone.md'))
    if (isListLifecycleError(deleted)) throw new Error(deleted.message.message)

    // ── Card lines ──
    await applyDeckAdd(deckPath, { name: 'Rift Bolt', set: 'tsp', collectorNumber: '176' }, 2)
    // A four-digit quantity: a number `Intl` would group (`1.000` in German) if
    // one ever reached a card line or the changelog.
    await applyDeckAdd(deckPath, { name: 'Mountain' }, 1000)
    // Targets are resolved entries, as every caller hands them over.
    const signet = { name: 'Arcane Signet', set: 'fdn', collectorNumber: '266' }
    await applyTargetedChanges('collection', tradePath, signet, [
      createSetNoteChange('Arcane Signet', { note: 'from the precon' }),
    ])
    try {
      await applyTargetedChanges('collection', tradePath, signet, [
        createSetSectionChange('Arcane Signet', 'Sideboard'),
      ])
      throw new Error('expected an engine guard')
    } catch (error) {
      if (!(error instanceof SyncMessageError)) throw error
      refusals.push(error.syncMessage)
    }

    // ── Custom art: filed, then re-filed after a renumber ──
    await saveCardArt(deckPath, new Map([[1, { file: 'alters/bolt.png' }]]))
    await reconcileCardArt(deckPath, { renumbered: new Map([[1, 2]]) })
    await fs.writeFile(path.join(decks, 'Broken.art.json'), '{ nope')
    await fs.writeFile(path.join(decks, 'Broken.md'), '# Broken\n\n## Main\n')
    const broken = await reconcileCardArt(path.join(decks, 'Broken.md'), { removed: [1] })
    if (broken.ok) throw new Error('expected an unreadable art sidecar')
    refusals.push(broken.message)

    // ── Covers, metadata and categories ──
    const cover = await writeListImage(deckPath, { card: 2 })
    if (isSyncMessage(cover)) throw new Error(cover.message)
    refuse(await checkListImageCardId(deckPath, { card: 99 }))
    const metadata = await applyFlatListMetadata(tradePath, {
      description: 'Cards for trade.',
      labels: ['trade'],
      image: { url: 'https://example.test/binder.png' },
    })
    if (isSyncMessage(metadata)) throw new Error(metadata.message)
    const oddPath = path.join(wanted, 'Odd.md')
    const unmapped = await applyFlatListMetadata(oddPath, { description: 'never written' })
    if (!isSyncMessage(unmapped)) throw new Error('expected a metadata refusal')
    refusals.push(unmapped)
    const unmappedCover = await writeListImage(oddPath, { url: 'https://example.test/x.png' })
    if (!isSyncMessage(unmappedCover)) throw new Error('expected a cover refusal')
    refusals.push(unmappedCover)
    const coverRead = await readListImageFile(oddPath)
    refuse(coverRead.advisory ?? null)
    // Two categories: a list `Intl` would join (`Removal und Burn`) if one ever
    // reached the sidecar or the changelog line this edit records.
    const bolt = { name: 'Lightning Bolt', set: 'm10', collectorNumber: '146' }
    await applyTargetedChanges('deck', deckPath, bolt, [
      createSetCategoriesChange('Lightning Bolt', ['Removal', 'Burn']),
    ])
    const deckMetadata = await applyDeckMetadata(deckPath, {
      description: 'Burn them out.',
      tags: ['aggro', 'red'],
    })
    if (isSyncMessage(deckMetadata)) throw new Error(deckMetadata.message)

    // ── A cross-list move, through the admin save: its art follows the card ──
    await saveCardArt(tradePath, new Map([[3, { url: 'https://example.test/signet.png' }]]))
    const moved = await saveList('collection', 'Trade Binder', tradePath, [
      createMoveFromChange('Arcane Signet', {
        set: 'fdn',
        collectorNumber: '266',
        cardId: 3,
        to: { type: 'deck', name: 'Burn' },
      }),
    ])
    if (moved.status !== 200) throw new Error(`the move was refused: ${await moved.text()}`)

    // ── Refusals whose English holds an `Intl` list ──
    const notImage = parseCardArtRef({ file: 'notes.txt' })
    if (!isCardArtRefError(notImage)) throw new Error('expected an art refusal')
    refusals.push(notImage.error)
    const unknownKeys = parseListImage({ card: 1, colour: 'red', size: 2 })
    if (!isListImageRefError(unknownKeys)) throw new Error('expected a cover refusal')
    refusals.push(unknownKeys.error)
    refusals.push(invalidDeckFormatMessage('cube'))
    refusals.push(
      unreadableContentMessage(
        deckPath,
        unreadableProblems({
          fencedLines: 2,
          // Text with no catalog entry, nested as it is.
          notices: [
            { severity: 'warning', message: syncText('first problem') },
            { severity: 'warning', message: syncText('second problem') },
          ],
        }),
        'saving',
      ),
    )

    // The workspace's own path is not data: each run gets a fresh one.
    const anchored = (text: string): string => text.replaceAll(ws.dir, '<workspace>')
    return {
      files: await snapshotTree(ws.dir),
      english: refusals.map((message) => anchored(message.message)),
      rendered: refusals.map((message) => anchored(renderSyncMessage(message))),
    }
  } finally {
    await ws.dispose()
  }
}

describe('list-file bytes under a foreign UI language (Integration)', () => {
  let english: ListRun

  beforeAll(async () => {
    // The changelog stamps its entries with the clock; every run reads one time.
    setSystemTime(new Date('2026-06-04T12:00:00.000Z'))
    english = await writeEverything()
  })

  afterAll(() => {
    setSystemTime()
  })

  test('the English run exercises every file and refusal the pins are about', () => {
    // Vacuity guard: the runs below compare like for like only if the engines
    // actually wrote the files and returned the refusals the pins are about.
    const files = Object.keys(english.files)
    for (const file of [
      'decks/Burn.md',
      'decks/Burn.md.sha256',
      'decks/Burn.changes.md',
      'decks/Burn.art.json',
      'decks/Burn.categories.json',
      'collections/Trade Binder.md',
      'collections/Trade Binder.changes.md',
      'wanted/Wants.md',
      'wanted/Odd.md',
    ]) {
      expect(files).toContain(file)
    }
    expect(files).not.toContain('collections/Binder.md')
    expect(files).not.toContain('wanted/Gone.md')
    // The backfill stamped ids and expanded the pasted quantity.
    expect(english.files['collections/Trade Binder.md']).toContain('- Sol Ring (C19:221) &2')
    // The cover follows the renumbered art; the metadata keys are English YAML.
    expect(english.files['decks/Burn.md']).toContain('card: 2')
    expect(english.files['collections/Trade Binder.md']).toContain('description: Cards for trade.')
    expect(english.files['decks/Burn.md']).toContain('description: Burn them out.')
    expect(english.files['decks/Burn.md']).toContain('- 1000x Mountain &4')
    // The move landed on both sides, its art with it, and both changelogs say so.
    expect(english.files['decks/Burn.md']).toContain('Arcane Signet (FDN:266)')
    expect(english.files['collections/Trade Binder.md']).not.toContain('Arcane Signet')
    expect(english.files['decks/Burn.art.json']).toContain('signet.png')
    expect(english.files['decks/Burn.changes.md']).toContain("from Collection 'Trade Binder'")
    expect(english.files['collections/Trade Binder.changes.md']).toContain("to Deck 'Burn'")
    expect(english.files['decks/Burn.changes.md']).toMatch(/categor.*Removal, Burn/i)
    // `unknown[]`: the asymmetric matchers below are typed `any`.
    const expected: unknown[] = [
      "A deck named 'Burn' already exists (it matches 'burn' under list-name folding).",
      "'???' contains no characters usable in a file name.",
      expect.stringContaining("Invalid deck format 'cube'."),
      "Wanted list 'Missing' not found.",
      "Confirmation name does not match. Expected 'Gone'.",
      expect.stringContaining("Front matter 'labels' ignored:"),
      "applyTargetedChanges cannot apply 'set-section' to a collection",
      expect.stringContaining('Broken.art.json: not valid JSON:'),
      'image references card &99, which is not a card in this list.',
      "The file's front matter is not a key/value mapping, so a metadata write would overwrite it. Fix the block by hand first.",
      "The file's front matter is not a key/value mapping, so a list image write would overwrite it. Fix the block by hand first.",
      'Front matter is not a key/value mapping, so any list image it names was ignored.',
      '"notes.txt" is not an image file — custom art must be one of: .avif, .gif, .jpeg, .jpg, .png, .webp',
      'a list image has no such key: colour, size',
      expect.stringContaining("Invalid deck format 'cube'. Valid formats: commander, oathbreaker,"),
      '<workspace>/decks/Burn.md holds content the parser cannot re-emit, and saving would delete it (releasing any &N ids it carries). Fix the file first — first problem; second problem; Fenced code block content (2 lines) — read as prose, but a whole-file rewrite would delete it',
    ]
    expect<unknown[]>(english.english).toEqual(expected)
  })

  test.each(foreignLocales())(
    'writes the same bytes, and answers the same English, under $tag',
    async ({ tag, catalog }) => {
      const localized = await withSyntheticLocaleAsync(tag, catalog, async (locale) => {
        // Vacuity guard: the language is in force and differs from English for
        // what the catalog words (the pseudo-locale) or what `Intl` joins (German)
        // — before the run and after it, so a run that reset it part way fails.
        expectLocaleInForce(locale)
        const run = await writeEverything()
        expectLocaleInForce(locale)
        return run
      })
      expect(localized.files).toEqual(english.files)
      expect(localized.english).toEqual(english.english)
      // …while what a reader in that language sees follows it.
      if (tag === 'en-XA') {
        for (const [index, rendered] of localized.rendered.entries()) {
          expect(rendered).not.toBe(english.english[index])
        }
      }
    },
  )
})
