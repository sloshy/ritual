import { displayLanguage } from '../card-language'
import type { TradeCardEntry } from './data-types'
import { defaultFinishForCard, resolveTradeFinish } from './trade-finish'

/**
 * The `~lang` suffix of an sf token (`@sfId[:finish][~lang]`), empty for
 * English — a bare token means `en`, like a bare card line. Tilde rather than a
 * second colon so the finish and language suffixes cannot be confused.
 */
function languageSuffix(card: TradeCardEntry): string {
  const language = displayLanguage(card.language)
  return language === 'en' ? '' : `~${language}`
}

function buildSourceGroup(sourceName: string, tokens: string[]): string {
  return `${encodeURIComponent(sourceName)}:${tokens.join(',')}`
}

function encodeCollectionCards(cards: TradeCardEntry[]): string {
  const groups = new Map<string, string[]>()
  for (const card of cards) {
    if (card.source !== 'collection') continue
    const sourceIds = (card.sourceCardIds ?? []).slice(0, card.qty)
    if (sourceIds.length === 0) continue
    const bucket = groups.get(card.sourceName) ?? []
    bucket.push(...sourceIds.map(String))
    groups.set(card.sourceName, bucket)
  }
  return [...groups.entries()].map(([n, ids]) => buildSourceGroup(n, ids)).join('|')
}

function encodeDeckCards(cards: TradeCardEntry[]): string {
  const groups = new Map<string, string[]>()
  for (const card of cards) {
    if (card.source !== 'deck') continue
    const numericId = card.sourceCardIds?.[0]
    if (numericId === undefined) continue
    let token = `${numericId}x${card.qty}`
    if (card.editable && card.scryfallCard?.id) {
      token += `@${card.scryfallCard.id}`
      const finish = resolveTradeFinish(card.scryfallCard, card.finish)
      if (finish !== defaultFinishForCard(card.scryfallCard)) token += `:${finish}`
      token += languageSuffix(card)
    }
    const bucket = groups.get(card.sourceName) ?? []
    bucket.push(token)
    groups.set(card.sourceName, bucket)
  }
  return [...groups.entries()].map(([n, ts]) => buildSourceGroup(n, ts)).join('|')
}

function encodeWantedCards(cards: TradeCardEntry[]): string {
  const groups = new Map<string, string[]>()
  for (const card of cards) {
    if (card.source !== 'wanted') continue
    const sourceIds = (card.sourceCardIds ?? []).slice(0, card.qty)
    if (sourceIds.length === 0) continue
    const sfId = card.scryfallCard?.id
    const resolvedFinish = sfId ? resolveTradeFinish(card.scryfallCard, card.finish) : 'nonfoil'
    const defaultFinish = sfId ? defaultFinishForCard(card.scryfallCard) : 'nonfoil'
    const tokens = sourceIds.map((id) => {
      if (!sfId) return String(id)
      const finishPart = resolvedFinish !== defaultFinish ? `:${resolvedFinish}` : ''
      return `${id}@${sfId}${finishPart}${languageSuffix(card)}`
    })
    const bucket = groups.get(card.sourceName) ?? []
    bucket.push(...tokens)
    groups.set(card.sourceName, bucket)
  }
  return [...groups.entries()].map(([n, ts]) => buildSourceGroup(n, ts)).join('|')
}

function encodeScryfallCards(cards: TradeCardEntry[]): string {
  return cards
    .filter((c) => c.source === 'scryfall' && c.scryfallCard)
    .map((c) => {
      const finish = resolveTradeFinish(c.scryfallCard, c.finish)
      const defaultFinish = defaultFinishForCard(c.scryfallCard)
      const finishPart = finish !== defaultFinish ? `:${finish}` : ''
      return `x${c.qty}@${c.scryfallCard!.id}${finishPart}${languageSuffix(c)}`
    })
    .join(',')
}

export function encodeTradeToParams(
  leftCards: TradeCardEntry[],
  rightCards: TradeCardEntry[],
): URLSearchParams {
  const params = new URLSearchParams()
  const leftCol = encodeCollectionCards(leftCards)
  if (leftCol) params.set('leftSideColIds', leftCol)
  const leftDeck = encodeDeckCards(leftCards)
  if (leftDeck) params.set('leftSideDeckIds', leftDeck)
  const rightWanted = encodeWantedCards(rightCards)
  if (rightWanted) params.set('rightSideWantedIds', rightWanted)
  const rightSf = encodeScryfallCards(rightCards)
  if (rightSf) params.set('rightSideScryfall', rightSf)
  return params
}

export function hasTradeParams(params: URLSearchParams): boolean {
  return (
    params.has('leftSideColIds') ||
    params.has('leftSideDeckIds') ||
    params.has('rightSideWantedIds') ||
    params.has('rightSideScryfall')
  )
}
