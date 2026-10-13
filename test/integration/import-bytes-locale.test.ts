import { afterAll, beforeAll, describe, expect, setSystemTime, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { handleImportCsv } from '../../src/admin/api/import-csv'
import { handleImportDeck } from '../../src/admin/api/import-deck'
import type { ArchidektDeckResponse } from '../../src/importers/archidekt-types'
import type { MoxfieldDeckResponse } from '../../src/importers/moxfield-client'
import { DEFAULT_LOCALE } from '../../src/i18n/runtime'
import {
  renderSyncMessage,
  renderSyncParam,
  readSyncMessage,
  syncList,
} from '../../src/sync/message'
import { bindWorkspace, snapshotTree } from '../helpers/workspace'
import { stubFetch, type StubbedFetch } from '../helpers/stub-fetch'
import { foreignLocales, withSyntheticLocaleAsync } from '../helpers/sync-text'
import { apiRequest } from './helpers/request'
import { runCli } from './helpers/cli'

/**
 * What an import writes and answers is the same bytes in every UI language.
 *
 * The list files, their changelog and categories sidecars are workspace data a
 * collaborator's Ritual reads back; the routes' JSON (and `ritual import
 * --output json`) is what MCP and scripts read, English by contract. Each run
 * below performs the same imports — CSV creates into a collection and a wanted
 * list, a CSV whose first row is data, a CSV deck create and append (which
 * writes a changelog), a pasted decklist with a skipped line, dropped labels,
 * an Arena `About` line and an empty extras section, URL imports from Archidekt
 * (no deck name, refused categories), MTGGoldfish (no title) and Moxfield (tags),
 * and a CLI text import into a collection — and every byte must match an English
 * run. The full pseudo-locale changes every catalog message; German with no
 * dictionary changes what `Intl` joins (a three-item list), so both a leaked
 * catalog string and a leaked `Intl` rendering would show.
 */

/** Every route body, verbatim, the CLI's JSON payload, and the workspace after the run. */
type ImportRun = { bodies: string[]; cliOutput: string; files: Record<string, string> }

/** An Archidekt deck with no name and three category names Ritual refuses. */
const NAMELESS_ARCHIDEKT_DECK = {
  deckFormat: 3,
  categories: [{ id: 1, name: 'Main' }],
  cards: [
    {
      quantity: 1,
      card: {
        name: 'Sol Ring',
        oracleCard: { name: 'Sol Ring' },
        collectorNumber: '284',
        edition: { editioncode: 'ltc' },
      },
      categories: [1, 'Ramp', 'Mana, Rocks', 'Draw\tFilter', 'Tutors, Combo'],
    },
  ],
} as const satisfies ArchidektDeckResponse

/** A Moxfield deck whose author tagged its cards — Ritual's categories. */
const TAGGED_MOXFIELD_DECK: MoxfieldDeckResponse = {
  id: 'abc123',
  publicId: 'abc123',
  name: 'Tagged',
  description: '',
  format: 'commander',
  boards: {
    mainboard: {
      cards: {
        a: { quantity: 1, card: { name: 'Sol Ring', set: 'c21', cn: '263' }, finish: 'nonFoil' },
        b: { quantity: 1, card: { name: 'Arcane Signet', set: 'fdn', cn: '266' } },
      },
    },
  },
  authorTags: { 'Sol Ring': ['Ramp', 'Rocks'], 'Arcane Signet': ['Ramp'] },
}

/** An MTGGoldfish deck page with neither an `<h1>` nor a `<title>`. */
const UNTITLED_GOLDFISH_PAGE = '<html><body><a href="/deck/download/987">Download</a></body></html>'

const PASTED_DECK = [
  'About',
  'Name Pasted',
  'Format: commander',
  '',
  '## Main',
  '1 Sol Ring (C19:221) [sale]',
  'not a card line',
  '1 Arcane Signet [sale,no-sale]',
  '4 Lightning Bolt (M10) 146',
  '',
  '## Maybeboard',
  '',
].join('\n')

/** A text file for the CLI to import into a collection. */
const COLLECTION_TEXT = '2 Sol Ring (C19) 221\n1 Arcane Signet (FDN:266) *F*\nnot a card\n'

/** Run every import into a fresh workspace, with the CLI in `env`'s language. */
async function importEverything(cliEnv: Record<string, string>): Promise<ImportRun> {
  const ws = await bindWorkspace()
  try {
    const csv = (body: object): Promise<Response> =>
      handleImportCsv(apiRequest('POST', '/api/import-csv', body))
    const deck = (body: object): Promise<Response> =>
      handleImportDeck(apiRequest('POST', '/api/import-deck', body))
    const responses = [
      await csv({
        listType: 'collection',
        name: 'Binder',
        content: [
          'Name,Set,Collector Number,Finish,Categories,Quantity',
          'Sol Ring,c19,221,F,"Ramp, Ra\tmp",2',
          'Arcane Signet,,,,,1',
        ].join('\n'),
        columns: 'name=1,set=2,collector-number=3,finish=4,categories=5,quantity=6',
      }),
      await csv({
        listType: 'wanted',
        name: 'Wants',
        content: 'Name,Language,Quantity\nBlack Lotus,Japanese,1\nMox Pearl,klingon,1',
        columns: 'name=1,language=2,quantity=3',
      }),
      // No header at all, but hasHeader is left at its default: the first card
      // row is dropped as a header, and the route says it looked like data.
      await csv({
        listType: 'wanted',
        name: 'Headerless',
        content: 'Sol Ring,1\nArcane Signet,1',
        columns: 'name=1,quantity=2',
      }),
      await csv({
        listType: 'deck',
        name: 'Burn',
        format: 'modern',
        content: 'Name,Quantity,Categories\nLightning Bolt,4,"Removal, Sideboard"',
        columns: 'name=1,quantity=2,categories=3',
      }),
      await csv({
        listType: 'deck',
        name: 'Burn',
        mode: 'append',
        content: 'Lava Spike,4\nRift Bolt,x\n',
        columns: 'name=1,quantity=2',
        hasHeader: false,
      }),
      await deck({ mode: 'text', content: PASTED_DECK }),
      await deck({ mode: 'url', url: 'https://archidekt.com/decks/777', syncPrintings: true }),
      await deck({ mode: 'url', url: 'https://www.mtggoldfish.com/deck/987', syncPrintings: true }),
      await deck({ mode: 'url', url: 'https://moxfield.com/decks/abc123', syncPrintings: true }),
    ]
    const bodies: string[] = []
    for (const response of responses) {
      expect(response.status).toBe(200)
      bodies.push(await response.text())
    }

    await fs.writeFile(path.join(ws.dir, 'cards.txt'), COLLECTION_TEXT)
    const cli = await runCli(
      ['import', 'cards.txt', '--type', 'collection', '--no-input', '--output', 'json'],
      ws.dir,
      cliEnv,
    )
    expect(cli.exitCode).toBe(1)
    // The payload names the file it wrote; the workspace's own path is not data.
    const cliOutput = cli.stdout.replaceAll(ws.dir, '<workspace>')
    return { bodies, cliOutput, files: await snapshotTree(ws.dir) }
  } finally {
    await ws.dispose()
  }
}

describe('import bytes under a foreign UI language (Integration)', () => {
  let english: ImportRun
  let stub: StubbedFetch
  let userAgent: string | undefined

  beforeAll(async () => {
    // The changelog stamps its entries with the clock; every run reads one time.
    setSystemTime(new Date('2026-06-04T12:00:00.000Z'))
    userAgent = process.env.MOXFIELD_USER_AGENT
    process.env.MOXFIELD_USER_AGENT = 'ritual-tests'
    stub = stubFetch({
      'https://archidekt.com/api/decks/777/': () => Response.json(NAMELESS_ARCHIDEKT_DECK),
      'https://www.mtggoldfish.com/deck/987': () => new Response(UNTITLED_GOLDFISH_PAGE),
      'https://www.mtggoldfish.com/deck/download/987': () =>
        new Response('4 Lightning Bolt\n\n2 Pyroblast\n'),
      'https://api2.moxfield.com/v3/decks/all/abc123': () => Response.json(TAGGED_MOXFIELD_DECK),
      'https://api2.moxfield.com/v1/decks/abc123/primer': () => new Response('', { status: 404 }),
    })
    english = await importEverything({ RITUAL_LOCALE: DEFAULT_LOCALE })
  })

  afterAll(() => {
    stub.restore()
    setSystemTime()
    if (userAgent === undefined) delete process.env.MOXFIELD_USER_AGENT
    else process.env.MOXFIELD_USER_AGENT = userAgent
  })

  test('the English run exercises every file and notice the pins are about', () => {
    // Vacuity guard: the runs below compare like for like only if the sources
    // actually produced the warnings, refusals and files the pins are about.
    const files = Object.keys(english.files)
    for (const file of [
      'collections/Binder.md',
      'collections/Binder.categories.json',
      'collections/cards.md',
      'wanted/Wants.md',
      'wanted/Headerless.md',
      'decks/Burn.md',
      'decks/Burn.changes.md',
      'decks/Pasted.md',
      // The fallback names an import writes when the source has none.
      'decks/Archidekt Deck 777.md',
      'decks/Archidekt Deck 777.categories.json',
      'decks/MTGGoldfish Deck.md',
      'decks/Tagged.md',
      'decks/Tagged.categories.json',
    ]) {
      expect(files).toContain(file)
    }
    const [binder, wants, headerless, , appended, pasted, archidekt] = english.bodies
    expect(binder).toContain('domain.import.csv.categoryIgnored')
    expect(binder).toContain('domain.import.csv.missingSet')
    expect(wants).toContain('domain.import.csv.unknownLanguage')
    expect(headerless).toContain('admin.api.importCsv.headerSuspicious')
    expect(appended).toContain('domain.import.csv.invalidQuantity')
    expect(pasted).toContain('domain.import.text.malformedLine')
    expect(pasted).toContain('domain.import.text.labelsUnsupported')
    expect(pasted).toContain('domain.import.text.emptySectionDropped')
    expect(pasted).toContain('domain.import.text.aboutLineSkipped')
    expect(pasted).toContain('"labelsDropped":true')
    // Three refused names: a list `Intl` joins differently in German.
    expect(archidekt).toContain('domain.import.categoriesRefused')
    expect(archidekt).toContain('\\"Mana, Rocks\\", \\"Draw\\\\tFilter\\", \\"Tutors, Combo\\"')
    expect(english.cliOutput).toContain('domain.import.text.malformedLine')
  })

  test.each(foreignLocales())(
    'writes and answers the same bytes under $tag',
    async ({ tag, catalog }) => {
      const localized = await withSyntheticLocaleAsync(tag, catalog, async (locale) => {
        // Vacuity guard: the language is in force and differs from English for
        // what the routes word (the pseudo-locale) or what `Intl` joins (German).
        const summary = readSyncMessage(JSON.parse(english.bodies[5]!))
        if (summary === null) throw new Error('the deck import answered no message')
        if (tag === 'en-XA') {
          expect(renderSyncMessage(summary, locale)).not.toBe(summary.message)
        } else {
          const list = syncList(['A', 'B', 'C'], 'unit')
          expect(renderSyncParam(list, locale)).not.toBe(renderSyncParam(list, DEFAULT_LOCALE))
        }
        return importEverything({ RITUAL_LOCALE: tag })
      })
      expect(localized.files).toEqual(english.files)
      expect(localized.bodies).toEqual(english.bodies)
      expect(localized.cliOutput).toBe(english.cliOutput)
    },
  )
})
