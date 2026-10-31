/**
 * The human renderings `card` and `scry` print by default: a readable card
 * block for `card`, one compact line per result for `scry`. `--output json`
 * keeps the raw Scryfall object; these are only ever the text mode.
 *
 * Pure: the currency to price in is an input, so the rendering is pinned
 * without a workspace config.
 */

import type { ScryfallCard } from '../scryfall/types'
import { printingLabel } from '../card/card-line-tail'
import { distinctCardFaces } from '../scryfall/card-utils'
import {
  formatPriceOrNA,
  getCardPriceForEntry,
  type PriceCurrency,
} from '../pricing/price-currency'
import { PRICE_SOURCE_LABELS, scryfallSourceFor } from '../pricing/price-source'
import { t } from '../i18n/t'

/** The rules text of one face — or of the whole card, for a single-faced one. */
type CardFaceText = {
  name: string
  manaCost: string
  typeLine: string
  oracleText: string
}

/**
 * The text fields read off a face or a card, all optional: `card` and `scry`
 * render Scryfall's raw objects, where a reversible printing has no top-level
 * type line and a face may lack rules text. Widening the typed object to this
 * keeps the renderer from trusting fields the API can leave out.
 */
type RawCardText = {
  name: string
  mana_cost?: string | null
  type_line?: string | null
  oracle_text?: string | null
}

function faceText(raw: RawCardText): CardFaceText {
  return {
    name: raw.name,
    manaCost: raw.mana_cost ?? '',
    typeLine: raw.type_line ?? '',
    oracleText: raw.oracle_text ?? '',
  }
}

/**
 * The faces a card's rules text is read from: every distinct face of a
 * multi-face card (transform, modal double-faced, split, adventure, flip — a
 * reversible printing's repeated face once), else the card itself.
 */
function cardFaces(card: ScryfallCard): CardFaceText[] {
  const faces: readonly RawCardText[] = card.card_faces ? distinctCardFaces(card.card_faces) : []
  if (faces.length > 0) return faces.map(faceText)
  return [faceText(card)]
}

/** The card's type line, or its first face's when the card carries none (a reversible printing). */
function cardTypeLine(card: ScryfallCard): string {
  const raw: RawCardText = card
  return raw.type_line ?? cardFaces(card)[0]?.typeLine ?? ''
}

/** A name with its mana cost beside it, or the bare name for a cost-less card (a land). */
function nameWithCost(name: string, manaCost: string): string {
  return manaCost.length > 0 ? t('cli.card.text.nameWithCost', { name, manaCost }) : name
}

/** One face's lines: name and cost, type line, then the rules text when it has any. */
function faceLines(face: CardFaceText): string[] {
  const lines = [nameWithCost(face.name, face.manaCost), face.typeLine]
  if (face.oracleText.length > 0) lines.push(...face.oracleText.split('\n'))
  return lines
}

/** A face line nested under a multi-face card's combined name. */
function indent(line: string): string {
  return `  ${line}`
}

/**
 * The printing's price in `currency` at the finish it is shown in (a foil-only
 * printing reads its foil price), worded `N/A` when Scryfall lists none.
 */
function cardPrice(card: ScryfallCard, currency: PriceCurrency): string {
  return formatPriceOrNA(getCardPriceForEntry(card, undefined, currency), currency)
}

/** The store Scryfall's price in `currency` comes from, by its display name. */
function priceStore(currency: PriceCurrency): string {
  return t(PRICE_SOURCE_LABELS[scryfallSourceFor(currency)])
}

/**
 * The readable `card` block: name and mana cost, type line and rules text (each
 * face in turn for a multi-face card), then the printing and its price.
 */
export function renderCardDetail(card: ScryfallCard, currency: PriceCurrency): string {
  const faces = cardFaces(card)
  const [only] = faces
  const lines =
    faces.length === 1 && only
      ? faceLines(only)
      : [card.name, ...faces.flatMap((face) => ['', ...faceLines(face).map(indent)])]
  lines.push(
    '',
    t('cli.card.text.printing', {
      printing: printingLabel(card.set, card.collector_number),
      setName: card.set_name,
    }),
    t('cli.card.text.price', { price: cardPrice(card, currency), store: priceStore(currency) }),
  )
  return lines.join('\n')
}

/** The compact `scry` line: name, `SET:CN`, type line and price. */
export function renderCardLine(card: ScryfallCard, currency: PriceCurrency): string {
  return t('cli.scry.line', {
    name: card.name,
    printing: printingLabel(card.set, card.collector_number),
    typeLine: cardTypeLine(card),
    price: cardPrice(card, currency),
  })
}
