import type { TradeCardEntry } from './data-types'
import type { TradeSearchEntry } from './useTradeData'
import { isCardLanguage, storedLanguage, type CardLanguage } from '../card-language'
import type { ScryfallCard } from '../types'
import { getCardPriceForFinish } from '../price-currency'
import type { PriceCurrency } from '../price-currency'
import { resolveTradeFinish } from './trade-finish'
import { cardLookupSourceName, fetchCardsByIds } from './card-lookup'

/**
 * Surfaced when a saved trade URL references data that no longer exists locally.
 *
 * Per AGENTS.md exception: card-line warnings carry only the numeric card IDs
 * (or scryfall IDs / token strings) — we do not attempt to resolve a human-friendly
 * name for cards that have already been removed from a list. The user can match
 * the IDs against `&N` markers in their markdown if they want to investigate.
 */
export type TradeDecodeWarning =
  | {
      kind: 'unknown-source'
      sourceKind: 'collection' | 'deck' | 'wanted'
      sourceName: string
    }
  | {
      kind: 'unknown-card-ids'
      sourceKind: 'collection' | 'deck' | 'wanted'
      sourceName: string
      ids: number[]
    }
  | { kind: 'unknown-scryfall-id'; sfId: string }
  | { kind: 'malformed-token'; token: string }

type DecodeContext = {
  scryfallMap: Map<string, ScryfallCard>
  currency: PriceCurrency
  warnings: TradeDecodeWarning[]
}

/** Build a `sourceName → cardId → entry` lookup so decode loops avoid O(N·M·K) Array.find. */
function indexEntriesBySourceAndCardId(
  entries: TradeSearchEntry[],
): Map<string, Map<number, TradeSearchEntry>> {
  const index = new Map<string, Map<number, TradeSearchEntry>>()
  for (const entry of entries) {
    let bySource = index.get(entry.sourceName)
    if (!bySource) {
      bySource = new Map()
      index.set(entry.sourceName, bySource)
    }
    for (const id of entry.cardIds) bySource.set(id, entry)
  }
  return index
}

type SourceGroup = {
  sourceName: string
  bySource: Map<number, TradeSearchEntry>
  tokens: string[]
}

/**
 * Parse the shared `name:tok1,tok2|name2:tok3,…` envelope used by collection / deck / wanted
 * params. Yields one entry per group whose source-name resolves to entries; emits warnings
 * for malformed or unknown-source groups so callers don't need to repeat that boilerplate.
 */
function* parseSourceGroups(
  paramValue: string,
  sourceKind: 'collection' | 'deck' | 'wanted',
  entries: TradeSearchEntry[],
  warnings: TradeDecodeWarning[],
): Iterable<SourceGroup> {
  if (!paramValue) return
  const index = indexEntriesBySourceAndCardId(entries)
  for (const group of paramValue.split('|')) {
    const colonIdx = group.indexOf(':')
    if (colonIdx < 0) {
      warnings.push({ kind: 'malformed-token', token: group })
      continue
    }
    const sourceName = decodeURIComponent(group.slice(0, colonIdx))
    const bySource = index.get(sourceName)
    if (!bySource) {
      warnings.push({ kind: 'unknown-source', sourceKind, sourceName })
      continue
    }
    yield { sourceName, bySource, tokens: group.slice(colonIdx + 1).split(',') }
  }
}

type SfPart = {
  sfId: string | undefined
  urlFinish: string | undefined
  /** The raw `~lang` value, still unvalidated — see {@link parseUrlLanguage}. */
  urlLanguage: string | undefined
}
type ParsedSfToken = { basePart: string; sf: SfPart }

/**
 * Parse the optional `@sfId[:finish][~lang]` suffix on a deck/wanted token. The base
 * portion (before `@`) is returned alongside the parsed scryfall reference so callers
 * can decide how to interpret it (deck encodes `id` as a quantity-prefixed `idxqty`;
 * wanted encodes a bare numeric id). The `~lang` suffix is split off before the
 * finish (tilde deliberately avoids the overloaded colon); it is returned raw and
 * validated by {@link parseUrlLanguage}, per the parser convention that a bad value
 * becomes a warning, not a throw.
 */
function parseSfPart(token: string): ParsedSfToken {
  const atIdx = token.indexOf('@')
  if (atIdx < 0) {
    return {
      basePart: token,
      sf: { sfId: undefined, urlFinish: undefined, urlLanguage: undefined },
    }
  }
  const basePart = token.slice(0, atIdx)
  let sfPart = token.slice(atIdx + 1)
  const tildeIdx = sfPart.indexOf('~')
  const urlLanguage = tildeIdx >= 0 ? sfPart.slice(tildeIdx + 1) : undefined
  if (tildeIdx >= 0) sfPart = sfPart.slice(0, tildeIdx)
  const colonIdx = sfPart.indexOf(':')
  const sfId = colonIdx >= 0 ? sfPart.slice(0, colonIdx) : sfPart
  const urlFinish = colonIdx >= 0 ? sfPart.slice(colonIdx + 1) : undefined
  return { basePart, sf: { sfId: sfId || undefined, urlFinish, urlLanguage } }
}

/**
 * Validate a token's raw `~lang` value into a {@link CardLanguage} for the decoded
 * entry, or undefined. A code that names no language warns as a malformed token
 * (carrying the raw token — per the parser conventions, the raw string is enough to
 * investigate) and decodes as English rather than dropping the card. `en` — legal
 * but never written by the encoder — resolves to undefined, the bare spelling.
 */
function parseUrlLanguage(
  raw: string | undefined,
  token: string,
  warnings: TradeDecodeWarning[],
): CardLanguage | undefined {
  if (raw === undefined) return undefined
  const language = raw.toLowerCase()
  if (!isCardLanguage(language)) {
    warnings.push({ kind: 'malformed-token', token })
    return undefined
  }
  return storedLanguage(language)
}

/** Cheap pre-pass extractor for the scryfall id inside a token, used to seed the prefetch set. */
function extractSfIdFromToken(token: string): string | undefined {
  return parseSfPart(token).sf.sfId
}

function decodeCollectionParam(
  paramValue: string,
  entries: TradeSearchEntry[],
  ctx: DecodeContext,
): TradeCardEntry[] {
  const result: TradeCardEntry[] = []
  for (const { sourceName, bySource, tokens } of parseSourceGroups(
    paramValue,
    'collection',
    entries,
    ctx.warnings,
  )) {
    const countMap = new Map<TradeSearchEntry, number>()
    const missingIds: number[] = []
    for (const token of tokens) {
      const id = Number(token)
      if (isNaN(id) || id <= 0) {
        ctx.warnings.push({ kind: 'malformed-token', token })
        continue
      }
      const entry = bySource.get(id)
      if (entry) countMap.set(entry, (countMap.get(entry) ?? 0) + 1)
      else missingIds.push(id)
    }
    if (missingIds.length > 0) {
      ctx.warnings.push({
        kind: 'unknown-card-ids',
        sourceKind: 'collection',
        sourceName,
        ids: missingIds,
      })
    }

    for (const [entry, qty] of countMap) {
      result.push({
        name: entry.name,
        set: entry.set,
        collectorNumber: entry.collectorNumber,
        finish: entry.finish,
        condition: entry.condition,
        // Re-resolved from the loaded entries (the URL carries only card ids),
        // so a decoded keep card gets its badge — but never the confirm dialog:
        // decode writes the card signals directly, bypassing the guarded add.
        labels: entry.labels,
        note: entry.note,
        price: entry.price,
        scryfallCard: entry.scryfallCard,
        source: 'collection',
        sourceName: entry.sourceName,
        qty,
        maxQty: entry.maxQty,
        sourceCardIds: entry.cardIds,
      })
    }
  }
  return result
}

function decodeDeckParam(
  paramValue: string,
  entries: TradeSearchEntry[],
  ctx: DecodeContext,
): TradeCardEntry[] {
  const result: TradeCardEntry[] = []
  for (const { sourceName, bySource, tokens } of parseSourceGroups(
    paramValue,
    'deck',
    entries,
    ctx.warnings,
  )) {
    const missingIds: number[] = []
    for (const token of tokens) {
      const { basePart, sf } = parseSfPart(token)
      const xParts = basePart.split('x')
      const id = Number(xParts[0] ?? '')
      const qty = Number(xParts[1] ?? '1')
      if (isNaN(id) || id <= 0 || isNaN(qty) || qty <= 0) {
        ctx.warnings.push({ kind: 'malformed-token', token })
        continue
      }
      const entry = bySource.get(id)
      if (!entry) {
        missingIds.push(id)
        continue
      }
      if (sf.sfId && !ctx.scryfallMap.has(sf.sfId)) {
        ctx.warnings.push({ kind: 'unknown-scryfall-id', sfId: sf.sfId })
      }
      const scryfallCard = (sf.sfId && ctx.scryfallMap.get(sf.sfId)) || entry.scryfallCard
      const finish = resolveTradeFinish(scryfallCard, sf.urlFinish ?? entry.finish)
      result.push({
        name: entry.name,
        set: scryfallCard?.set ?? entry.set,
        collectorNumber: scryfallCard?.collector_number ?? entry.collectorNumber,
        finish,
        language: parseUrlLanguage(sf.urlLanguage, token, ctx.warnings),
        scryfallCard,
        price: scryfallCard
          ? getCardPriceForFinish(scryfallCard, finish, ctx.currency)
          : (entry.price ?? 0),
        source: 'deck',
        sourceName: entry.sourceName,
        qty,
        maxQty: entry.maxQty,
        sourceCardIds: entry.cardIds,
        editable: !!sf.sfId,
      })
    }
    if (missingIds.length > 0) {
      ctx.warnings.push({
        kind: 'unknown-card-ids',
        sourceKind: 'deck',
        sourceName,
        ids: missingIds,
      })
    }
  }
  return result
}

type WantedAccum = {
  count: number
  sfId: string | undefined
  urlFinish: string | undefined
  urlLanguage: string | undefined
  /** The token the sf suffix came from, for malformed-token warnings. */
  token: string
}

function decodeWantedParam(
  paramValue: string,
  entries: TradeSearchEntry[],
  ctx: DecodeContext,
): TradeCardEntry[] {
  const result: TradeCardEntry[] = []
  for (const { sourceName, bySource, tokens } of parseSourceGroups(
    paramValue,
    'wanted',
    entries,
    ctx.warnings,
  )) {
    const countMap = new Map<TradeSearchEntry, WantedAccum>()
    const missingIds: number[] = []
    for (const token of tokens) {
      const { basePart, sf } = parseSfPart(token)
      const id = Number(basePart)
      if (isNaN(id) || id <= 0) {
        ctx.warnings.push({ kind: 'malformed-token', token })
        continue
      }
      const entry = bySource.get(id)
      if (!entry) {
        missingIds.push(id)
        continue
      }
      const acc = countMap.get(entry)
      if (acc) acc.count++
      else {
        countMap.set(entry, {
          count: 1,
          sfId: sf.sfId,
          urlFinish: sf.urlFinish,
          urlLanguage: sf.urlLanguage,
          token,
        })
      }
    }
    if (missingIds.length > 0) {
      ctx.warnings.push({
        kind: 'unknown-card-ids',
        sourceKind: 'wanted',
        sourceName,
        ids: missingIds,
      })
    }

    for (const [entry, { count: qty, sfId, urlFinish, urlLanguage, token }] of countMap) {
      if (sfId && !ctx.scryfallMap.has(sfId)) {
        ctx.warnings.push({ kind: 'unknown-scryfall-id', sfId })
      }
      const scryfallCard = (sfId && ctx.scryfallMap.get(sfId)) || entry.scryfallCard
      const finish = resolveTradeFinish(scryfallCard, urlFinish ?? entry.finish)
      result.push({
        name: entry.name,
        // The printing on offer is whatever the picker chose, which is not
        // necessarily the one the wanted list asked for — same as a deck row.
        set: scryfallCard?.set ?? entry.set,
        collectorNumber: scryfallCard?.collector_number ?? entry.collectorNumber,
        finish,
        language: parseUrlLanguage(urlLanguage, token, ctx.warnings),
        condition: entry.condition,
        note: entry.note,
        price: scryfallCard
          ? getCardPriceForFinish(scryfallCard, finish, ctx.currency)
          : (entry.price ?? 0),
        scryfallCard,
        source: 'wanted',
        sourceName: entry.sourceName,
        qty,
        sourceCardIds: entry.cardIds,
        editable: !!sfId,
      })
    }
  }
  return result
}

function decodeScryfallParam(paramValue: string, ctx: DecodeContext): TradeCardEntry[] {
  if (!paramValue) return []
  const result: TradeCardEntry[] = []
  for (const token of paramValue.split(',')) {
    // Format: x<qty>@<sfId>[:<finish>][~<lang>] — the shared sf-suffix grammar.
    if (!token.startsWith('x') || token.indexOf('@') < 0) {
      ctx.warnings.push({ kind: 'malformed-token', token })
      continue
    }
    const { basePart, sf } = parseSfPart(token)
    const qty = Number(basePart.slice(1))
    if (!sf.sfId || isNaN(qty) || qty <= 0) {
      ctx.warnings.push({ kind: 'malformed-token', token })
      continue
    }

    const card = ctx.scryfallMap.get(sf.sfId)
    if (!card) {
      ctx.warnings.push({ kind: 'unknown-scryfall-id', sfId: sf.sfId })
      continue
    }

    const finish = resolveTradeFinish(card, sf.urlFinish)
    result.push({
      name: card.name,
      set: card.set,
      collectorNumber: card.collector_number,
      finish,
      language: parseUrlLanguage(sf.urlLanguage, token, ctx.warnings),
      scryfallCard: card,
      price: getCardPriceForFinish(card, finish, ctx.currency),
      source: 'scryfall',
      sourceName: cardLookupSourceName(),
      qty,
      editable: true,
    })
  }
  return result
}

export type TradeParamEntries = {
  collectionEntries: TradeSearchEntry[]
  deckEntries: TradeSearchEntry[]
  wantedEntries: TradeSearchEntry[]
}

export type DecodedTrade = {
  left: TradeCardEntry[]
  right: TradeCardEntry[]
  warnings: TradeDecodeWarning[]
}

function collectSfIdsFromGroupedParam(value: string, into: Set<string>): void {
  if (!value) return
  for (const group of value.split('|')) {
    const colonIdx = group.indexOf(':')
    if (colonIdx < 0) continue
    for (const token of group.slice(colonIdx + 1).split(',')) {
      const sfId = extractSfIdFromToken(token)
      if (sfId) into.add(sfId)
    }
  }
}

function collectSfIdsFromScryfallParam(value: string, into: Set<string>): void {
  if (!value) return
  for (const token of value.split(',')) {
    const sfId = extractSfIdFromToken(token)
    if (sfId) into.add(sfId)
  }
}

export async function decodeTradeFromParams(
  params: URLSearchParams,
  entries: TradeParamEntries,
  currency: PriceCurrency,
): Promise<DecodedTrade> {
  const warnings: TradeDecodeWarning[] = []
  const sfIdsToFetch = new Set<string>()

  const leftCol = params.get('leftSideColIds') ?? ''
  const leftDeck = params.get('leftSideDeckIds') ?? ''
  const rightWanted = params.get('rightSideWantedIds') ?? ''
  const rightSf = params.get('rightSideScryfall') ?? ''

  collectSfIdsFromGroupedParam(leftDeck, sfIdsToFetch)
  collectSfIdsFromGroupedParam(rightWanted, sfIdsToFetch)
  collectSfIdsFromScryfallParam(rightSf, sfIdsToFetch)

  const scryfallMap = new Map<string, ScryfallCard>()
  if (sfIdsToFetch.size > 0) {
    for (const entry of [
      ...entries.collectionEntries,
      ...entries.deckEntries,
      ...entries.wantedEntries,
    ]) {
      if (entry.scryfallCard) scryfallMap.set(entry.scryfallCard.id, entry.scryfallCard)
    }
    const toFetch = [...sfIdsToFetch].filter((id) => !scryfallMap.has(id))
    const fetched = await fetchCardsByIds(toFetch)
    for (const [id, card] of fetched) scryfallMap.set(id, card)
  }

  const ctx: DecodeContext = { scryfallMap, currency, warnings }

  return {
    left: [
      ...decodeCollectionParam(leftCol, entries.collectionEntries, ctx),
      ...decodeDeckParam(leftDeck, entries.deckEntries, ctx),
    ],
    right: [
      ...decodeWantedParam(rightWanted, entries.wantedEntries, ctx),
      ...decodeScryfallParam(rightSf, ctx),
    ],
    warnings,
  }
}
