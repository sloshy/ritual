import { describe, expect, test } from 'bun:test'
import {
  collectionCsvOutcome,
  COLLECTION_CSV_UPLOAD,
  CSV_UPLOAD_THRESHOLD,
  planCollectionCsv,
} from '../../../src/collection-sync/csv'
// Browser-safe by design: the admin page renders the same counts when it replays
// a finished report, so the describers live beside the other shared wording.
import {
  describeCsvFailure,
  describeCsvFailureReasons,
  describeCsvSize,
} from '../../../src/collection-sync/describe'
import type { PushCreate } from '../../../src/collection-sync/diff'
import { validateArchidektCsvColumns } from '../../../src/importers/archidekt-collection'
import type { CollectionCsvUploadResult } from '../../../src/importers/archidekt-collection'
import type { CardLanguage } from '../../../src/card/card-language'
import type { Condition, Finish } from '../../../src/card/finish-condition'
import { noPrintings, printing, printingId, printingsLookup } from '../../fixtures/archidekt'

/**
 * The CSV a push uploads: rows resolved from the local Scryfall cache, in
 * Archidekt's own spellings, and the split between the additions that can ride it
 * and the ones that cannot. Pure and cache-only — nothing here goes near the
 * network, which is the whole reason the CSV path exists.
 */

type CreateOptions = {
  quantity?: number
  finish?: Finish
  condition?: Condition
  language?: CardLanguage
  lists?: string[]
}

function create(
  name: string,
  set: string,
  collectorNumber: string,
  options: CreateOptions = {},
): PushCreate {
  return {
    kind: 'create',
    key: `${set}|${collectorNumber}|${options.finish ?? 'nonfoil'}|${options.condition ?? 'NM'}|${options.language ?? 'en'}`,
    parts: {
      set,
      collectorNumber,
      finish: options.finish ?? 'nonfoil',
      condition: options.condition ?? 'NM',
      language: options.language,
    },
    name,
    lists: options.lists ?? ['blue-binder'],
    quantity: options.quantity ?? 1,
  }
}

const SOL_RING = create('Sol Ring', 'ltc', '284', { quantity: 2 })
const KARLACH = create('Karlach, Fury of Avernus', 'clb', '507', {
  finish: 'etched',
  condition: 'DMG',
})

const CACHE = printingsLookup([
  printing('Sol Ring', 'ltc', '284', ['nonfoil', 'foil']),
  printing('Karlach, Fury of Avernus', 'clb', '507', ['etched']),
])

describe('planCollectionCsv', () => {
  test('renders the archidekt preset’s columns, spellings, and header', async () => {
    const plan = await planCollectionCsv([SOL_RING, KARLACH], CACHE)

    expect(plan.csv.split('\n')).toEqual([
      'Scryfall ID,Quantity,Variant,Condition,Language',
      // The uid comes from the cached printing — nothing about it can be spelled
      // out of the line's own set and collector number — and the quantity is the
      // copies the key holds: one row per printing, not one per copy.
      `${printingId('ltc', '284')},2,Normal,NM,EN`,
      // Etched is its own variant, and Damaged is `D` in a CSV cell (Ritual
      // spells it `DMG` everywhere else).
      `${printingId('clb', '507')},1,Etched,D,EN`,
    ])
    expect(plan.rows).toEqual([SOL_RING, KARLACH])
    // Index-aligned with rows — the identity map result pairing is built from.
    expect(plan.rowIds).toEqual([printingId('ltc', '284'), printingId('clb', '507')])
    expect(plan.copies).toBe(3)
    expect(plan.uncached).toEqual([])
    expect(plan.warnings).toEqual([])
  })

  test('the column mapping Ritual uploads is derived from the preset it renders', () => {
    // Derived from `ARCHIDEKT_EXPORT_SETTINGS.columns`, so this pins the *result*
    // of that derivation: reorder the preset and this fails rather than Archidekt
    // silently reading quantities as variants. Uid-keyed, so no row can be
    // ambiguous — and Archidekt's own rule agrees.
    expect(COLLECTION_CSV_UPLOAD.columns).toEqual([
      'uid',
      'quantity',
      'modifier',
      'condition',
      'language',
    ])
    expect(COLLECTION_CSV_UPLOAD.header).toBe(true)
    expect(validateArchidektCsvColumns(COLLECTION_CSV_UPLOAD.columns)).toBeUndefined()
  })

  test('a [ja] addition rides with Archidekt’s JP code and the printing’s default uid', async () => {
    const plan = await planCollectionCsv(
      [create('Sol Ring', 'ltc', '284', { language: 'ja' })],
      CACHE,
    )

    // The uid is the printing's default (English) object — Archidekt's own uid
    // — while the language rides its own column.
    expect(plan.csv.split('\n')[1]).toBe(`${printingId('ltc', '284')},1,Normal,NM,JP`)
    expect(plan.warnings).toEqual([])
  })

  test('a language Archidekt cannot model renders EN with a warning', async () => {
    const plan = await planCollectionCsv(
      [create('Urza’s Tower', 'atq', '85a', { language: 'ph' })],
      printingsLookup([printing('Urza’s Tower', 'atq', '85a', ['nonfoil'])]),
    )

    expect(plan.csv.split('\n')[1]).toBe(`${printingId('atq', '85a')},1,Normal,NM,EN`)
    expect(plan.warnings).toEqual([
      'Archidekt cannot represent Phyrexian [ph]; pushing Urza’s Tower (ATQ:85a) as English.',
    ])
  })

  test('keeps additions the cache cannot resolve out of the file', async () => {
    const plan = await planCollectionCsv([SOL_RING, KARLACH], CACHE)
    const missing = await planCollectionCsv(
      [SOL_RING, KARLACH],
      printingsLookup([printing('Sol Ring', 'ltc', '284', ['nonfoil'])]),
    )

    expect(plan.rows).toHaveLength(2)
    // A row with no uid is one Archidekt would have to guess about, so the
    // unresolvable printing is handed back to the caller instead.
    expect(missing.rows).toEqual([SOL_RING])
    // The id list must skip the uncached create with its row, staying aligned.
    expect(missing.rowIds).toEqual([printingId('ltc', '284')])
    expect(missing.uncached).toEqual([KARLACH])
    expect(missing.copies).toBe(2)
    expect(missing.csv.split('\n')).toHaveLength(2)
    expect(missing.warnings).toEqual([
      'No Scryfall ID for Karlach, Fury of Avernus (CLB:507): the printing is not in the Scryfall cache.',
    ])
  })

  test('an empty cache yields no file at all', async () => {
    const plan = await planCollectionCsv([SOL_RING], noPrintings)

    // Not even a header: the caller checks `rows` and falls back rather than
    // uploading (or writing) a file with nothing in it.
    expect(plan.csv).toBe('')
    expect(plan.rows).toEqual([])
    expect(plan.uncached).toEqual([SOL_RING])
  })

  test('no additions is no work', async () => {
    const plan = await planCollectionCsv([], CACHE)

    expect(plan).toEqual({ csv: '', rows: [], rowIds: [], copies: 0, uncached: [], warnings: [] })
  })
})

describe('collectionCsvOutcome', () => {
  const SOL_UID = 'uid-sol-ring'
  const KARLACH_UID = 'uid-karlach'
  const IDS = [SOL_UID, KARLACH_UID]
  /** Same printing as SOL_RING — same Scryfall id — differing only in condition. */
  const SOL_RING_LP = create('Sol Ring', 'ltc', '284', { condition: 'LP' })

  type RowOutcome = {
    ambiguous?: boolean
    notFound?: boolean
    errors?: string[]
    raw?: string
    imported?: boolean
  }

  /** An upload result whose rows carry the given outcomes, in row order. */
  function result(outcomes: RowOutcome[]): CollectionCsvUploadResult {
    return {
      rowCount: outcomes.length,
      chunkCount: 1,
      rows: outcomes.map((outcome, row) => ({
        row,
        raw: outcome.raw,
        imported: outcome.imported,
        ambiguous: outcome.ambiguous ?? false,
        notFound: outcome.notFound ?? false,
        errors: outcome.errors ?? [],
      })),
      unreadable: [],
    }
  }

  /**
   * The `raw` echo Archidekt sends back for a row: its own re-serialization —
   * every cell quoted, CRLF-terminated — not the bytes Ritual uploaded.
   */
  function rawLine(
    uid: string,
    quantity: number,
    variant: string,
    condition: string,
    language = 'EN',
  ): string {
    return `"${uid}","${quantity}","${variant}","${condition}","${language}"\r\n`
  }

  const HEADER_ECHO = '"Scryfall ID","Quantity","Variant","Condition","Language"\r\n'

  test('names the card behind every row Archidekt did not import', () => {
    const outcome = collectionCsvOutcome(
      { rows: [SOL_RING, KARLACH], rowIds: IDS },
      result([{}, { notFound: true, errors: ['no such card'] }]),
    )

    // Paired to the create itself, so the caller credits and fails operations
    // rather than trusting the row number a second time.
    expect(outcome.failed).toEqual([KARLACH])
    expect(outcome.failures).toEqual([
      {
        row: 1,
        card: 'Karlach, Fury of Avernus (CLB:507) [etched] [DMG]',
        ambiguous: false,
        notFound: true,
        errors: ['no such card'],
      },
    ])
    expect(outcome.unpaired).toBe(0)
  })

  test('a clean import has no failures', () => {
    expect(
      collectionCsvOutcome({ rows: [SOL_RING, KARLACH], rowIds: IDS }, result([{}, {}])),
    ).toEqual({
      failures: [],
      failed: [],
      unpaired: 0,
    })
  })

  test('a row index no addition answers to is reported as a row number', () => {
    // The response numbered its results differently than they were sent; say
    // which row rather than inventing a card — and count it, so the engine can
    // say some refused copies were credited on faith.
    const outcome = collectionCsvOutcome(
      { rows: [SOL_RING], rowIds: [SOL_UID] },
      result([{}, { ambiguous: true }]),
    )

    expect(outcome.failures).toEqual([
      { row: 1, card: 'CSV row 2', ambiguous: true, notFound: false, errors: [] },
    ])
    // And no create is blamed for it: there is none to blame.
    expect(outcome.failed).toEqual([])
    expect(outcome.unpaired).toBe(1)
  })

  test('a header row the server processed as data fails no card (the live incident)', () => {
    // Verified live 2026-07-27: Archidekt honors `skip` only for chunk 1, so a
    // header repeated on chunk 2 came back as a refused row — and positional
    // pairing blamed the first real card of the chunk for it. The header echo
    // pairs with nothing, so no card is blamed for it (the shifted-index pairing
    // itself is the next test's subject).
    const outcome = collectionCsvOutcome(
      { rows: [SOL_RING, KARLACH], rowIds: IDS },
      result([
        {
          raw: HEADER_ECHO,
          imported: false,
          notFound: true,
          errors: ['Unknown condition: CONDITION'],
        },
        { raw: rawLine(SOL_UID, 2, 'Normal', 'NM'), imported: true },
        { raw: rawLine(KARLACH_UID, 1, 'Etched', 'D'), imported: true },
      ]),
    )

    expect(outcome).toEqual({ failures: [], failed: [], unpaired: 0 })
  })

  test('a refused row with an echo names its own card even at a shifted index', () => {
    const outcome = collectionCsvOutcome(
      { rows: [SOL_RING, KARLACH], rowIds: IDS },
      result([
        { raw: HEADER_ECHO, imported: false, notFound: true },
        { raw: rawLine(SOL_UID, 2, 'Normal', 'NM'), imported: true },
        // Positionally this is row 2, which no create answers to — the echo
        // still pins it to Karlach.
        { raw: rawLine(KARLACH_UID, 1, 'Etched', 'D'), imported: false, notFound: true },
      ]),
    )

    expect(outcome.failed).toEqual([KARLACH])
    expect(outcome.failures).toEqual([
      {
        row: 2,
        card: 'Karlach, Fury of Avernus (CLB:507) [etched] [DMG]',
        ambiguous: false,
        notFound: true,
        errors: [],
      },
    ])
  })

  test('two rows for one printing are told apart by condition, not by uid', () => {
    // One printing has one Scryfall id however many rows it fills — the push
    // key is (printing, finish, condition), so the identity must carry the
    // variant and condition cells too. The refused row comes first so a
    // uid-only identity (last insertion wins) would blame the LP copy.
    const outcome = collectionCsvOutcome(
      { rows: [SOL_RING, SOL_RING_LP], rowIds: [SOL_UID, SOL_UID] },
      result([
        { raw: rawLine(SOL_UID, 2, 'Normal', 'NM'), imported: false, notFound: true },
        { raw: rawLine(SOL_UID, 1, 'Normal', 'LP'), imported: true },
      ]),
    )

    expect(outcome.failed).toEqual([SOL_RING])
    expect(outcome.failures[0]?.card).toBe('Sol Ring (LTC:284)')
  })

  test('two rows for one printing are told apart by language, not by uid', () => {
    // Same printing, same uid, same variant and condition — only the language
    // cell separates the rows, so the identity must carry it. The refused row
    // comes first so a language-blind identity would blame the Japanese copy.
    const SOL_RING_JA = create('Sol Ring', 'ltc', '284', { quantity: 2, language: 'ja' })
    const outcome = collectionCsvOutcome(
      { rows: [SOL_RING, SOL_RING_JA], rowIds: [SOL_UID, SOL_UID] },
      result([
        { raw: rawLine(SOL_UID, 2, 'Normal', 'NM'), imported: false, notFound: true },
        { raw: rawLine(SOL_UID, 2, 'Normal', 'NM', 'JP'), imported: true },
      ]),
    )

    expect(outcome.failed).toEqual([SOL_RING])
    expect(outcome.failures[0]?.card).toBe('Sol Ring (LTC:284)')
  })

  test('echo matching is case-insensitive, header echo included', () => {
    const outcome = collectionCsvOutcome(
      { rows: [SOL_RING], rowIds: [SOL_UID] },
      result([
        {
          raw: '"scryfall id","quantity","variant","condition","language"\r\n',
          imported: false,
        },
        {
          raw: rawLine(SOL_UID.toUpperCase(), 2, 'normal', 'nm', 'en'),
          imported: false,
          notFound: true,
        },
      ]),
    )

    expect(outcome.failed).toEqual([SOL_RING])
    expect(outcome.failures).toHaveLength(1)
    expect(outcome.unpaired).toBe(0)
  })

  test("Archidekt's own imported verdict beats the failure flags", () => {
    // A row that imported is a success whatever else the response mumbled, and
    // an imported:false with no flag set is still a refusal.
    const outcome = collectionCsvOutcome(
      { rows: [SOL_RING, KARLACH], rowIds: IDS },
      result([
        { raw: rawLine(SOL_UID, 2, 'Normal', 'NM'), imported: true, errors: ['warning noise'] },
        { raw: rawLine(KARLACH_UID, 1, 'Etched', 'D'), imported: false },
      ]),
    )

    expect(outcome.failed).toEqual([KARLACH])
    expect(outcome.failures).toHaveLength(1)
  })

  test('an echo without a verdict still pairs, and the flags decide the refusal', () => {
    const outcome = collectionCsvOutcome(
      { rows: [SOL_RING, KARLACH], rowIds: IDS },
      result([
        { raw: rawLine(SOL_UID, 2, 'Normal', 'NM') },
        { raw: rawLine(KARLACH_UID, 1, 'Etched', 'D'), notFound: true },
      ]),
    )

    expect(outcome.failed).toEqual([KARLACH])
  })

  test('a garbled echo falls back to position when that position is unclaimed', () => {
    // Archidekt re-serializes `raw`, so a mangled echo must not orphan the
    // refusal — position is still good when no echo already claimed the card.
    const outcome = collectionCsvOutcome(
      { rows: [SOL_RING], rowIds: [SOL_UID] },
      result([{ raw: '"uid-sol-ring,2,Normal,NM\r\n', imported: false, notFound: true }]),
    )

    expect(outcome.failed).toEqual([SOL_RING])
    expect(outcome.failures[0]?.card).toBe('Sol Ring (LTC:284)')
    expect(outcome.unpaired).toBe(0)
  })

  test('the positional fallback never blames a card another echo claimed', () => {
    // Sol Ring's own echo says it imported; the refused stranger row sits at
    // Sol Ring's position but must not fail it — it is counted instead.
    const outcome = collectionCsvOutcome(
      { rows: [SOL_RING], rowIds: [SOL_UID] },
      result([
        { raw: rawLine('uid-stranger', 1, 'Normal', 'NM'), imported: false, notFound: true },
        { raw: rawLine(SOL_UID, 2, 'Normal', 'NM'), imported: true },
      ]),
    )

    expect(outcome.failed).toEqual([])
    expect(outcome.failures).toEqual([
      {
        row: 0,
        card: 'CSV row 1 ("uid-stranger","1","Normal","NM","EN")',
        ambiguous: false,
        notFound: true,
        errors: [],
      },
    ])
    expect(outcome.unpaired).toBe(1)
  })

  describe('CSV log wording', () => {
    test('counts each reason a row was dropped', () => {
      const { failures } = collectionCsvOutcome(
        {
          rows: [SOL_RING, KARLACH, create('Mox Pearl', 'lea', '263'), SOL_RING_LP],
          rowIds: [SOL_UID, KARLACH_UID, 'uid-mox-pearl', SOL_UID],
        },
        result([
          { notFound: true },
          { ambiguous: true },
          { errors: ['bad quantity'] },
          // Refused by the server's own verdict alone — no flag, no message.
          { raw: rawLine(SOL_UID, 1, 'Normal', 'LP'), imported: false },
        ]),
      )

      expect(describeCsvFailureReasons(failures)).toBe(
        '1 not found, 1 ambiguous, 1 rejected, 1 refused without a reason',
      )
      expect(describeCsvFailureReasons([])).toBe('')

      // And one row at a time, as both the run log and the admin page name them.
      expect(failures.map(describeCsvFailure)).toEqual([
        'not found on Archidekt',
        'matched more than one printing',
        'bad quantity',
        'Archidekt gave no reason',
      ])
    })

    test('pluralizes cards and rows independently', () => {
      expect(describeCsvSize(1, 1)).toBe('1 card (1 row)')
      expect(describeCsvSize(3, 2)).toBe('3 cards (2 rows)')
    })
  })
})

describe('CSV_UPLOAD_THRESHOLD', () => {
  test('is the documented 25 printings', () => {
    // Named in the CLI's help text, the prompt, the failure message, and the
    // docs — a change here has to be a deliberate one.
    expect(CSV_UPLOAD_THRESHOLD).toBe(25)
  })
})
