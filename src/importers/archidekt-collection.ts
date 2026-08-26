import { displayLanguage, type CardLanguage } from '../card/card-language'
import {
  VALID_CONDITIONS,
  VALID_FINISHES,
  type Condition,
  type Finish,
} from '../card/finish-condition'
import { isRecord } from '../util/json'
import type { ArchidektCard, ArchidektCardModifier } from './archidekt-types'

/**
 * Types and enum mapping for Archidekt's collection API
 * (`/api/collection/…`), the remote side of `ritual collection-sync`.
 * See `research/archidekt-collection-api.md` for the endpoint reference.
 */

/** Archidekt game id for Paper — the only game Ritual syncs. */
export const ARCHIDEKT_GAME_PAPER = 1

/** Archidekt language id for English — the fallback for languages Archidekt cannot model. */
export const ARCHIDEKT_LANGUAGE_ENGLISH = 1

/**
 * Archidekt's numeric language ids (1–11) ↔ Ritual's {@link CardLanguage}
 * codes, from `research/archidekt-collection-api.md`. Archidekt models only
 * these eleven; Ritual's remaining codes (`ph`, `la`, `grc`, `he`, `ar`, `sa`)
 * have no id and push as English with a warning. Declared as literal pairs —
 * like `CONDITIONS_BY_ID` below, the types are proven by the table rather than
 * asserted back on — and both direction maps derive from this one table, so
 * the two directions can never disagree.
 */
export const ARCHIDEKT_LANGUAGE_PAIRS = [
  [1, 'en'],
  [2, 'zht'],
  [3, 'de'],
  [4, 'fr'],
  [5, 'it'],
  [6, 'ja'],
  [7, 'ko'],
  [8, 'pt'],
  [9, 'ru'],
  [10, 'zhs'],
  [11, 'es'],
] as const satisfies readonly (readonly [number, CardLanguage])[]

const ARCHIDEKT_LANGUAGES_BY_ID = new Map<number, CardLanguage>(ARCHIDEKT_LANGUAGE_PAIRS)
const ARCHIDEKT_IDS_BY_LANGUAGE = new Map<CardLanguage, number>(
  ARCHIDEKT_LANGUAGE_PAIRS.map(([id, language]) => [language, id]),
)

/**
 * The short language codes Archidekt's **CSV** import/export uses
 * (`EN CT DE FR IT JP KR PT RU CS SP`) — the reverse of
 * `normalizeLanguageValue`'s alias table. Same coverage as the numeric ids:
 * a language with no id has no CSV code either.
 */
const ARCHIDEKT_CSV_LANGUAGE_CODES: Partial<Record<CardLanguage, string>> = {
  en: 'EN',
  zht: 'CT',
  de: 'DE',
  fr: 'FR',
  it: 'IT',
  ja: 'JP',
  ko: 'KR',
  pt: 'PT',
  ru: 'RU',
  zhs: 'CS',
  es: 'SP',
}

/**
 * Parse an Archidekt language id into a {@link CardLanguage}, or null for an id
 * outside the documented 1–11 range. Callers degrade a null to English with a
 * warning rather than skipping the record — the card itself is still real.
 */
export function parseArchidektLanguage(languageId: number): CardLanguage | null {
  return ARCHIDEKT_LANGUAGES_BY_ID.get(languageId) ?? null
}

/**
 * The Archidekt language id for a Ritual language, or null when Archidekt
 * cannot represent it (`ph`, `la`, `grc`, `he`, `ar`, `sa`). A missing entry
 * language resolves to English, like everywhere else.
 */
export function archidektLanguageId(language: CardLanguage | undefined): number | null {
  return ARCHIDEKT_IDS_BY_LANGUAGE.get(displayLanguage(language)) ?? null
}

/**
 * The code an Archidekt CSV cell carries for a Ritual language (`ja` → `JP`),
 * or null when Archidekt has no code for it. A missing entry language resolves
 * to English (`EN`).
 */
export function archidektCsvLanguage(language: CardLanguage | undefined): string | null {
  return ARCHIDEKT_CSV_LANGUAGE_CODES[displayLanguage(language)] ?? null
}

/** Record ids per `/api/collection/bulk/` request, matching Archidekt's own batching. */
export const ARCHIDEKT_BULK_BATCH_SIZE = 25

/**
 * CSV data rows per `/api/collection/upload/v2/` request. Archidekt's own
 * uploader splits a file into chunks of this size and posts them one at a time;
 * {@link ARCHIDEKT_CSV_CHUNK_SIZE} is also sent as the `chunkSize` form field.
 */
export const ARCHIDEKT_CSV_CHUNK_SIZE = 2000

/** A collection tag. Ritual never creates tags; it preserves what a record already has. */
export interface ArchidektCollectionTag {
  id: number
  name: string
  color: string
}

/** The collection owner, as returned on every list page. */
export interface ArchidektCollectionOwner {
  id: number
  username: string
  avatar?: string
}

/**
 * One row of an Archidekt collection. The same printing may appear in several
 * records that differ by condition, language, finish, or tags — so a record is
 * the unit of update/delete, not a card.
 *
 * `modifier` and `condition` are the raw wire values: run them through
 * {@link parseArchidektModifier} / {@link parseArchidektCondition} rather than
 * asserting them into Ritual's enums.
 */
export interface ArchidektCollectionRecord {
  id: number
  card: ArchidektCard
  quantity: number
  modifier: string
  language: number
  condition: number
  purchasePrice: number | null
  tags: ArchidektCollectionTag[]
  createdAt: string
  modifiedAt: string
}

/** One page of `GET /api/collection/{userId}/v2/`. */
export interface ArchidektCollectionPage {
  count: number
  results: ArchidektCollectionRecord[]
  /** Full URL of the next page, or null on the last page. */
  next: string | null
  previous: string | null
  page: number
  totalPages: number
  /** The owner's full tag list, included on every page. */
  tags: ArchidektCollectionTag[]
  isPublic: boolean
  owner: ArchidektCollectionOwner
}

/**
 * Body for `POST /api/collection/v2/` (create) and
 * `PATCH /api/collection/v2/{id}/` (update). The record id is deliberately not
 * part of it — `ArchidektClient.updateCollectionRecord` merges the id from its
 * own parameter, so a body can never disagree with the URL it is sent to.
 */
export interface CollectionUpsertBody {
  game: number
  quantity: number
  /** Archidekt printing id (`ArchidektCard.id`), not the Scryfall UUID. */
  card: number
  modifier: ArchidektCardModifier
  language: number
  condition: number
  tags: ArchidektCollectionTag[]
  purchasePrice: number | null
}

/**
 * What create/update return. Archidekt echoes the full record, but only these
 * fields are documented from the site's own client, so only these are declared.
 */
export interface CollectionUpsertResponse {
  id: number
  createdAt: string
  modifiedAt: string
}

/** Ritual condition ↔ Archidekt condition id (1–5). */
const CONDITION_IDS: Record<Condition, number> = {
  NM: 1,
  LP: 2,
  MP: 3,
  HP: 4,
  DMG: 5,
}

/**
 * Ritual condition → the short code Archidekt's **CSV** importer reads. The
 * JSON API takes the numeric {@link CONDITION_IDS} instead; these codes exist
 * only in CSV cells, and differ from Ritual's own spelling in exactly one place:
 * Damaged is `D`, not `DMG`.
 */
const CSV_CONDITION_CODES: Record<Condition, string> = {
  NM: 'NM',
  LP: 'LP',
  MP: 'MP',
  HP: 'HP',
  DMG: 'D',
}

// Built from the canonical condition list rather than `Object.entries`, so the
// key type is proven by the array instead of asserted back on.
const CONDITIONS_BY_ID = new Map<number, Condition>(
  VALID_CONDITIONS.map((condition) => [CONDITION_IDS[condition], condition]),
)

/** Ritual finish ↔ Archidekt modifier string. */
const MODIFIERS: Record<Finish, ArchidektCardModifier> = {
  nonfoil: 'Normal',
  foil: 'Foil',
  etched: 'Etched',
}

const FINISHES_BY_MODIFIER = new Map<string, Finish>(
  VALID_FINISHES.map((finish) => [MODIFIERS[finish].toLowerCase(), finish]),
)

/**
 * The outcome of parsing one of Archidekt's enum fields.
 *
 * Structured rather than a `T | string` union: `Condition` and `Finish` are
 * themselves string unions, so such a union would collapse to plain `string` and
 * nothing would stop a caller from using the error message as a value. The
 * `ok` discriminant makes the guard impossible to skip.
 */
export type ArchidektEnumResult<T> = { ok: true; value: T } | { ok: false; message: string }

/**
 * Parse an Archidekt condition id into a Ritual {@link Condition}. Anything that
 * is not one of the five known ids comes back as a message naming the raw id.
 */
export function parseArchidektCondition(conditionId: number): ArchidektEnumResult<Condition> {
  const condition = CONDITIONS_BY_ID.get(conditionId)
  if (condition === undefined) {
    return {
      ok: false,
      message: `Unknown Archidekt condition id '${conditionId}'. Expected one of: ${[...CONDITIONS_BY_ID.keys()].join(', ')}.`,
    }
  }
  return { ok: true, value: condition }
}

/** The Archidekt condition id for a Ritual condition. Total — no error case. */
export function archidektConditionId(condition: Condition): number {
  return CONDITION_IDS[condition]
}

/**
 * The condition code an Archidekt CSV cell carries for a Ritual condition
 * (`NM`/`LP`/`MP`/`HP`/`D`). Total — no error case.
 */
export function archidektCsvCondition(condition: Condition): string {
  return CSV_CONDITION_CODES[condition]
}

/**
 * Parse an Archidekt modifier string (`Normal` / `Foil` / `Etched`,
 * case-insensitively) into a Ritual {@link Finish}. An unknown modifier comes
 * back as a message naming the raw value.
 */
export function parseArchidektModifier(modifier: string): ArchidektEnumResult<Finish> {
  const finish = FINISHES_BY_MODIFIER.get(modifier.trim().toLowerCase())
  if (finish === undefined) {
    return {
      ok: false,
      message: `Unknown Archidekt modifier '${modifier}'. Expected one of: ${Object.values(MODIFIERS).join(', ')}.`,
    }
  }
  return { ok: true, value: finish }
}

/** The Archidekt modifier for a Ritual finish. Total — no error case. */
export function archidektModifier(finish: Finish): ArchidektCardModifier {
  return MODIFIERS[finish]
}

// ── CSV bulk upload (`POST /api/collection/upload/v2/`) ───────────────

/**
 * Archidekt's CSV column vocabulary: what a `columns[n]` form field may name,
 * one per column of the uploaded file. `ignore` skips a column.
 * (`multiversid` is Archidekt's own spelling — sic.)
 */
export const ARCHIDEKT_CSV_VOCABULARY = [
  'quantity',
  'oracleCard__name',
  'modifier',
  'condition',
  'language',
  'purchasePrice',
  'tags',
  'edition__editionname',
  'edition__editioncode',
  'multiversid',
  'uid',
  'collectorNumber',
  'ignore',
] as const

export type ArchidektCsvColumn = (typeof ARCHIDEKT_CSV_VOCABULARY)[number]

/** Columns per uploaded file, enforced by Archidekt's own importer. */
export const ARCHIDEKT_CSV_MAX_COLUMNS = 20

/**
 * Validate a column mapping the way Archidekt's importer does, returning an
 * error message or undefined. A mapping identifies printings either by Scryfall
 * id (`uid`) or by name + collector number + an edition column; anything else
 * cannot be matched to a printing at all.
 */
export function validateArchidektCsvColumns(
  columns: readonly ArchidektCsvColumn[],
): string | undefined {
  if (columns.length === 0) return 'A CSV upload needs at least one column.'
  if (columns.length > ARCHIDEKT_CSV_MAX_COLUMNS) {
    return `A CSV upload takes at most ${ARCHIDEKT_CSV_MAX_COLUMNS} columns, got ${columns.length}.`
  }
  if (columns.includes('uid')) return undefined
  const byName =
    columns.includes('oracleCard__name') &&
    columns.includes('collectorNumber') &&
    (columns.includes('edition__editionname') || columns.includes('edition__editioncode'))
  if (byName) return undefined
  return (
    "A CSV upload's columns must include 'uid', or 'oracleCard__name' plus " +
    "'collectorNumber' plus 'edition__editionname' or 'edition__editioncode'; " +
    `got: ${columns.join(', ')}.`
  )
}

/**
 * How the upload treats a row whose printing the collection already holds:
 * `add` sums the quantities. Ritual only ever uploads *new* printings, where
 * "new" means new to Ritual's key — set, collector number, finish **and**
 * condition — so quantity changes (which go through the record API, whose
 * semantics are verified) never ride the CSV.
 *
 * **Unverified**: whether Archidekt reads "found" the same way. A uid-keyed row
 * may well match on the printing alone, in which case uploading a Damaged copy
 * of a printing the account already holds Near Mint would grow the NM record
 * rather than create a DMG one — leaving the DMG key absent remotely and
 * re-uploaded on every subsequent push. Confirm against a real account (see
 * `research/archidekt-collection-api.md`) before relying on the distinction.
 */
export const ARCHIDEKT_CSV_IF_FOUND = 'add'

/**
 * Skip rows Archidekt cannot pin to exactly one printing — the import page's own
 * default, and moot for uid-keyed rows, which are unambiguous by construction.
 */
export const ARCHIDEKT_CSV_SKIP_AMBIGUOUS = true

/** How a row result reads once Ritual has made sense of it. */
export type CollectionCsvRowResult = {
  /** 0-based index among the upload's data rows (header excluded), across chunks. */
  row: number
  /**
   * The CSV line this result answers, as Archidekt re-serializes it (verified
   * live 2026-07-27: every cell quoted, CRLF-terminated — NOT byte-identical to
   * the line Ritual sent, so never compare it by string equality). The reliable
   * way to pair a result with the card it was about — positional pairing breaks
   * the moment the server reports a row Ritual did not count as one. Undefined
   * when the response omitted it.
   */
  raw: string | undefined
  /**
   * Archidekt's own success flag for the row (verified live). Undefined when
   * the response omitted it — callers then fall back to the failure flags.
   */
  imported: boolean | undefined
  /** Archidekt matched several printings and (with skipAmbiguousImports) imported none. */
  ambiguous: boolean
  /** Archidekt matched no printing at all. */
  notFound: boolean
  /** Per-row messages Archidekt reported; empty when it reported none. */
  errors: string[]
}

/**
 * A chunk response Ritual could not fully make sense of, carried through
 * verbatim rather than guessed at. The known row shape (live-verified) is
 * `data[].raw|imported|ambiguous|notFound|errors` (plus `lineNumber` and `id`,
 * deliberately unmodeled), so anything else — a non-JSON body, a missing `data`
 * array, row entries that are not objects, a row count that does not match the
 * chunk — lands here for the caller to show the user.
 */
export type CollectionCsvUnreadableResponse = {
  /** 1-based chunk index, as sent in the `chunk` form field. */
  chunk: number
  /** What could not be read. Never the body itself. */
  message: string
  /** The response body, truncated to {@link UNREADABLE_BODY_LIMIT} characters. */
  body: string
}

/** One chunk's parsed outcome. */
export type CollectionCsvChunkResult = {
  rows: CollectionCsvRowResult[]
  unreadable: CollectionCsvUnreadableResponse[]
}

/** Where a chunk sat in the upload, so row results can be numbered globally. */
export type CollectionCsvChunkContext = {
  /** 1-based chunk index, as sent. */
  chunk: number
  /** How many data rows preceded this chunk. */
  rowOffset: number
  /** How many data rows this chunk carried. */
  rowCount: number
}

/** Longest response body carried into a {@link CollectionCsvUnreadableResponse}. */
const UNREADABLE_BODY_LIMIT = 500

function truncateBody(body: string): string {
  return body.length > UNREADABLE_BODY_LIMIT ? `${body.slice(0, UNREADABLE_BODY_LIMIT)}…` : body
}

/** Read a boolean flag leniently (Archidekt sends JSON booleans; strings are tolerated). */
function csvResultFlag(value: unknown): boolean {
  return value === true || value === 'true'
}

/**
 * Archidekt's own verdict for a row; undefined when it said nothing usable. A
 * flag can safely degrade to false ("no problem reported"), but the verdict is
 * the authoritative refusal signal — a garbled value must collapse to "no
 * verdict" and let the flags decide, never to a refusal.
 */
function csvImportedVerdict(value: unknown): boolean | undefined {
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  return undefined
}

/** Every per-row message, keeping non-string entries readable instead of dropping them. */
function csvResultErrors(value: unknown): string[] {
  if (value === undefined || value === null) return []
  const items: unknown[] = Array.isArray(value) ? (value as unknown[]) : [value]
  // Everything here came out of `JSON.parse`, so `JSON.stringify` always has a
  // string for it — no undefined-returning input can reach this.
  return items.map((item) => (typeof item === 'string' ? item : JSON.stringify(item)))
}

/**
 * Parse one `upload/v2` chunk response body: `{ data: [...] }` with one entry
 * per uploaded row. Shape surprises never throw — they come back in
 * {@link CollectionCsvChunkResult.unreadable} with the raw body attached, while
 * whatever rows *did* parse are still reported.
 */
export function parseCollectionCsvUploadResponse(
  body: string,
  context: CollectionCsvChunkContext,
): CollectionCsvChunkResult {
  const unreadable: CollectionCsvUnreadableResponse[] = []
  const report = (message: string): void => {
    unreadable.push({ chunk: context.chunk, message, body: truncateBody(body) })
  }

  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    report('the response was not JSON')
    return { rows: [], unreadable }
  }

  const data: unknown = isRecord(payload) ? payload.data : undefined
  if (!Array.isArray(data)) {
    report('the response carried no "data" array of per-row results')
    return { rows: [], unreadable }
  }

  const rows: CollectionCsvRowResult[] = []
  let malformed = 0
  data.forEach((item: unknown, index) => {
    if (!isRecord(item)) {
      malformed += 1
      return
    }
    rows.push({
      row: context.rowOffset + index,
      raw: typeof item.raw === 'string' ? item.raw : undefined,
      imported: csvImportedVerdict(item.imported),
      ambiguous: csvResultFlag(item.ambiguous),
      notFound: csvResultFlag(item.notFound),
      errors: csvResultErrors(item.errors),
    })
  })
  if (malformed > 0) {
    report(`${malformed} of ${data.length} row results in "data" were not objects`)
  }
  if (data.length !== context.rowCount) {
    report(`the response reported ${data.length} row results for ${context.rowCount} uploaded rows`)
  }

  return { rows, unreadable }
}

/** What the whole upload came to, aggregated across chunks. */
export type CollectionCsvUploadResult = {
  /** Data rows uploaded (the header row is not one). */
  rowCount: number
  /** Requests made — `ceil(rowCount / ARCHIDEKT_CSV_CHUNK_SIZE)`, zero for an empty upload. */
  chunkCount: number
  /** Every row result Archidekt reported, in upload order. */
  rows: CollectionCsvRowResult[]
  /** Every response Ritual could not fully read; empty on a clean run. */
  unreadable: CollectionCsvUnreadableResponse[]
}
