/**
 * Validating what Archidekt answers before the client hands it on (AGENTS.md,
 * "Parsers"). Every reply is parsed from text (`parsedJson`), never cast from
 * `response.json()`, and checked for exactly the parts Ritual reads — so a
 * reply Archidekt changed, a proxy's HTML page or a truncated body is a keyed
 * refusal naming the part that was missing, never a `TypeError` thrown out of
 * the middle of a sync. Parts Ritual does not read are passed through as sent.
 */

import {
  archidektFallbackDeckName,
  type ArchidektCardModifier,
  type ArchidektCardSearchResult,
  type ArchidektCategory,
  type ArchidektDeckResponse,
  type ArchidektDeckSimple,
  type ArchidektRawCardEntry,
  type ArchidektRawDeckResponse,
} from '../importers/archidekt-types'
import type {
  ArchidektCollectionOwner,
  ArchidektCollectionPage,
  ArchidektCollectionRecord,
} from '../importers/archidekt-collection'
import { syncMessage, type MessageParseError } from '../sync/message'
import { isRecord } from '../util/json'

/** An item a list reply holds that lacks a part Ritual reads: that part's code name. */
export type MissingField = { missingField: string }

/** Validates one item of a list reply: the item, or the part it lacks. */
export type ItemParser<T> = (item: unknown) => T | MissingField

function missing(field: string): MissingField {
  return { missingField: field }
}

function isMissing<T>(value: T | MissingField): value is MissingField {
  return typeof value === 'object' && value !== null && 'missingField' in value
}

/** The refusal of a reply that is not a JSON object at all (an array, text, an HTML page). */
function notObject(): MessageParseError {
  return { error: syncMessage('domain.sync.archidekt.replyNotObject') }
}

/** The refusal of a reply lacking a part Ritual reads. */
function fieldInvalid(field: string): MessageParseError {
  return { error: syncMessage('domain.sync.archidekt.replyFieldInvalid', { field }) }
}

function isId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

/** Absent, or `null` — what Archidekt sends for a field it has nothing for. */
function isAbsent(value: unknown): value is null | undefined {
  return value === undefined || value === null
}

/** A validated page of a paginated list reply. */
export type ArchidektListPage<T> = {
  results: T[]
  /** Absolute (or relative) URL of the next page; null on the last one. */
  next: string | null
}

/**
 * What a list does with a result it cannot read: refuse the whole page (a
 * listing whose every entry is something Ritual acts on), or skip that result
 * (a search, which looks for one match among many hits).
 */
export type UnreadableItemPolicy = 'refuse' | 'skip'

/**
 * Validate one page of a list reply, and each of its results through
 * `parseItem`. A page whose `results` is missing or is not an array is an
 * error, not an empty page: treating it as empty would end the walk and make a
 * truncated list look complete. Under `'refuse'`, neither is a page with one
 * unreadable result — the refusal names its position and the part it lacked;
 * under `'skip'`, that result is left out.
 *
 * @param json The reply, parsed; `undefined` for one that was not JSON.
 */
export function parseListPage<T>(
  json: unknown,
  parseItem: ItemParser<T>,
  unreadable: UnreadableItemPolicy = 'refuse',
): ArchidektListPage<T> | MessageParseError {
  if (!isRecord(json)) return notObject()
  const raw: unknown = json.results
  if (!Array.isArray(raw)) return fieldInvalid('results')
  const items: readonly unknown[] = raw
  const results: T[] = []
  for (const [position, item] of items.entries()) {
    const parsed = parseItem(item)
    if (isMissing(parsed)) {
      if (unreadable === 'skip') continue
      return {
        error: syncMessage('domain.sync.archidekt.pageItemUnreadable', {
          index: position + 1,
          field: parsed.missingField,
        }),
      }
    }
    results.push(parsed)
  }
  return { results, next: typeof json.next === 'string' ? json.next : null }
}

/**
 * One deck of a deck-list page. Only its `id` is required — it is what a sync
 * matches and an import fetches by. A deck without a usable name gets the
 * fallback an imported deck gets (`Archidekt Deck {id}`), and any other field
 * that is not what it should be is left out rather than refusing the listing.
 */
export function parseDeckListItem(item: unknown): ArchidektDeckSimple | MissingField {
  if (!isRecord(item)) return missing('result')
  const { id, name, deckFormat, updatedAt, owner } = item
  if (!isId(id)) return missing('id')
  const deck: ArchidektDeckSimple = {
    id,
    name: typeof name === 'string' && name !== '' ? name : archidektFallbackDeckName(String(id)),
  }
  if (typeof deckFormat === 'number') deck.deckFormat = deckFormat
  if (typeof updatedAt === 'string') deck.updatedAt = updatedAt
  if (isRecord(owner) && typeof owner.username === 'string') {
    deck.owner = { username: owner.username }
  }
  return deck
}

const MODIFIERS: readonly string[] = ['Normal', 'Foil', 'Etched'] satisfies ArchidektCardModifier[]

function isModifier(value: unknown): value is ArchidektCardModifier {
  return typeof value === 'string' && MODIFIERS.includes(value)
}

/**
 * One printing a card search found. A finish Ritual does not know is left out
 * of `options` (it can never be the finish a sync asks for); a
 * `defaultCategory` that is not text is treated as none, as a `null` already is.
 */
export function parseSearchResult(item: unknown): ArchidektCardSearchResult | MissingField {
  if (!isRecord(item)) return missing('result')
  const { id, collectorNumber, options, oracleCard } = item
  if (!isId(id)) return missing('id')
  if (typeof collectorNumber !== 'string') return missing('collectorNumber')
  if (!Array.isArray(options)) return missing('options')
  if (!isRecord(oracleCard) || typeof oracleCard.name !== 'string') {
    return missing('oracleCard.name')
  }
  const finishes: readonly unknown[] = options
  const category = oracleCard.defaultCategory
  return {
    id,
    collectorNumber,
    options: finishes.filter(isModifier),
    oracleCard: {
      name: oracleCard.name,
      ...(typeof category === 'string' ? { defaultCategory: category } : {}),
    },
  }
}

/**
 * One collection record: an object with the id an update or delete addresses.
 * Its printing, finish and condition are read — and a record that cannot be
 * read skipped with a warning naming it — by the collection sync's remote
 * index, which is why they are not refused here.
 */
function parseCollectionRecord(item: unknown): ArchidektCollectionRecord | MissingField {
  if (!isRecord(item)) return missing('result')
  if (!isId(item.id)) return missing('id')
  return item as unknown as ArchidektCollectionRecord
}

/**
 * One page of a user's collection: its records, and how many pages there are.
 * The owner it names is kept when it is readable and dropped otherwise — the
 * sync only records the name, and must not fail over a private collection's
 * missing owner block.
 */
export function parseCollectionPage(json: unknown): ArchidektCollectionPage | MessageParseError {
  const page = parseListPage(json, parseCollectionRecord)
  if ('error' in page) return page
  // parseListPage refused anything that is not an object.
  const { owner, totalPages, ...rest } = json as Record<string, unknown>
  if (typeof totalPages !== 'number' || !Number.isFinite(totalPages)) {
    return fieldInvalid('totalPages')
  }
  const parsed: ArchidektCollectionPage = {
    ...(rest as unknown as Omit<ArchidektCollectionPage, 'owner'>),
    totalPages,
    results: page.results,
    next: page.next,
  }
  if (isRecord(owner) && typeof owner.username === 'string') {
    parsed.owner = owner as unknown as ArchidektCollectionOwner
  }
  return parsed
}

/**
 * The category definitions a deck reply holds, as the deck parsers can read
 * them: each an object with a text `name`. Anything else — a definition
 * without a name, a `categories` that is not a list — is left out, and so is
 * read as no category at all, never as a `TypeError` in the parser.
 */
function readableCategories(value: unknown): ArchidektCategory[] {
  if (!Array.isArray(value)) return []
  const definitions: readonly unknown[] = value
  return definitions.filter(
    (definition): definition is ArchidektCategory =>
      isRecord(definition) && typeof definition.name === 'string',
  )
}

/**
 * A deck as an import reads it. The import's own parser reads every entry
 * defensively (a nameless entry is counted and skipped), so only the shape it
 * walks is checked here: an object, whose `cards` is a list of objects when
 * present. Unreadable category definitions are left out.
 */
export function parseDeckReply(json: unknown): ArchidektDeckResponse | MessageParseError {
  if (!isRecord(json)) return notObject()
  const { cards } = json
  if (!isAbsent(cards)) {
    if (!Array.isArray(cards)) return fieldInvalid('cards')
    const entries: readonly unknown[] = cards
    const bad = entries.findIndex((entry) => !isRecord(entry))
    if (bad !== -1) return fieldInvalid(`cards[${bad}]`)
  }
  return { ...(json as ArchidektDeckResponse), categories: readableCategories(json.categories) }
}

/** A deck as a pull reads it: an import's shape, and when Archidekt last changed it. */
export type ArchidektPulledDeckReply = ArchidektDeckResponse & { updatedAt?: string }

/**
 * A deck as a pull reads it: what {@link parseDeckReply} checks, plus the
 * `updatedAt` it records as the divergence baseline, when Archidekt sends one.
 * A pull reads no relation id, so a relation without one is not refused here.
 */
export function parsePulledDeckReply(json: unknown): ArchidektPulledDeckReply | MessageParseError {
  const deck: ArchidektPulledDeckReply | MessageParseError = parseDeckReply(json)
  if ('error' in deck) return deck
  const { updatedAt } = json as Record<string, unknown>
  if (!isAbsent(updatedAt) && typeof updatedAt !== 'string') return fieldInvalid('updatedAt')
  return deck
}

/** The part of one raw deck entry deck sync reads unguarded, or the part it lacks. */
function rawEntryProblem(entry: unknown, at: string): string | undefined {
  if (!isRecord(entry)) return at
  if (!isId(entry.id)) return `${at}.id`
  if (typeof entry.quantity !== 'number' || !Number.isFinite(entry.quantity)) {
    return `${at}.quantity`
  }
  const { card } = entry
  if (!isRecord(card)) return `${at}.card`
  if (!isId(card.id)) return `${at}.card.id`
  if (!isRecord(card.oracleCard) || typeof card.oracleCard.name !== 'string') {
    return `${at}.card.oracleCard.name`
  }
  return undefined
}

/** A raw relation, its printing's finishes read as {@link parseSearchResult} reads them. */
function withReadableOptions<E extends ArchidektRawCardEntry>(entry: E): E {
  const options: unknown = entry.card.options
  const finishes: readonly unknown[] = Array.isArray(options) ? options : []
  return { ...entry, card: { ...entry.card, options: finishes.filter(isModifier) } }
}

/**
 * A deck as a push reads it — both the raw relations it plans against and the
 * sections it diffs. Every relation must carry its relation id, quantity,
 * printing id and card name. A printing without a list of finishes offers
 * none, and unreadable category definitions are left out.
 */
export function parseRawDeckReply(
  json: unknown,
): (ArchidektRawDeckResponse & ArchidektDeckResponse) | MessageParseError {
  if (!isRecord(json)) return notObject()
  const { cards } = json
  if (!Array.isArray(cards)) return fieldInvalid('cards')
  const entries: readonly unknown[] = cards
  for (const [position, entry] of entries.entries()) {
    const problem = rawEntryProblem(entry, `cards[${position}]`)
    if (problem !== undefined) return fieldInvalid(problem)
  }
  const deck = json as unknown as ArchidektRawDeckResponse & ArchidektDeckResponse
  return {
    ...deck,
    categories: readableCategories(json.categories),
    cards: deck.cards.map(withReadableOptions) as typeof deck.cards,
  }
}
