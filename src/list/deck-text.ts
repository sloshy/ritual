import type { Card } from '../card/card'
import type { DeckData, DeckSection } from './deck'
import { formatCollectionLine, formatWantedListLine, resolvePrinting } from '../card/card-line'
import type { EntryRef } from './entry-ref'
import type { ListType } from './list-type'
import { formatCanonicalCardLine } from '../card/card-line-tail'
import {
  aggregateDialectCards,
  renderDialectText,
  type SectionedDialectCard,
} from '../export/dialects'

/**
 * Format a single deck card line in the canonical markdown format, e.g.
 * `- 2 Lightning Bolt (2XM:157) [foil] [LP] [ja] [proxy] {note} &5` — a markdown
 * list item, like every other canonical card line. The language
 * token is omitted for English (a bare line means `en`), and a label override is
 * written only when present (an absent override means "inherit the deck's
 * front-matter default"). Pure string formatting
 * shared by the deck markdown serializer, the CLI importers, and the admin save
 * handlers. Lives here (a browser-safe, type-only module) so the public site can
 * reuse it without pulling in the node-only `deck-file` helpers.
 */
export function serializeCardLine(card: Card): string {
  return formatCanonicalCardLine('deck', {
    quantity: card.quantity,
    name: card.name,
    printing: resolvePrinting(card.set, card.collectorNumber),
    finish: card.finish,
    condition: card.condition,
    language: card.language,
    labels: card.labels,
    note: card.note,
    cardId: card.cardId,
  })
}

/**
 * Render a deck to its canonical markdown body: one `## Section` block per
 * section, each followed by its cards' full bulleted `serializeCardLine` form
 * (printing, finish, condition, note, and `&N` id). This is the "MD" export
 * offered in the page header; it mirrors what a server save writes minus the
 * YAML front matter, which the client does not carry — including the `- `
 * bullets, so the download and the file on disk are the same format.
 */
export function deckToMarkdown(deck: DeckData): string {
  const blocks = deck.sections.map((section) => {
    const header = `## ${section.name}`
    const cardLines = section.cards.map(serializeCardLine)
    return [header, ...cardLines].join('\n')
  })
  return blocks.join('\n\n').replace(/\n*$/, '\n')
}

/**
 * Render a deck to the plain-text decklist the public site's "Download" (and
 * the editor's deck download) hands the reader: an **export dialect**, not
 * Ritual's own markdown.
 *
 * The point of this file is that it pastes into another site, so it carries
 * bare `Commander` / `Deck` board markers instead of `## Section` headers,
 * `N Name (SET) CN` lines instead of the canonical bulleted form, and none of
 * the `&N` ids, notes, conditions or labels a Ritual line holds. Moxfield's
 * dialect is used: it is Arena's decklist form plus the trailing `*F*` / `*E*`
 * finish markers, so a foil stays a foil for the importers that model one and
 * is ignored by the ones that don't.
 *
 * Layout: the Commander section (when present), then the Main/Mainboard
 * section; if there is no explicit Main section, every other section is
 * included except Sideboard, Maybeboard, and Token (which are deck-building
 * extras rather than the list you are handing someone). Sections that share a
 * board are written under one marker, and identical variants within it are
 * summed into a single line — the same `aggregateDialectCards` pass
 * `ritual export --format text --dialect …` makes, so the downloaded file and
 * the CLI's file agree line for line.
 */
export function deckToExportText(deck: DeckData): string {
  const cmdrSection = deck.sections.find((s) => s.name.toLowerCase().includes('commander'))
  const mainSection = deck.sections.find(
    (s) => s.name.toLowerCase() === 'main' || s.name.toLowerCase() === 'mainboard',
  )
  const exported: DeckSection[] = []
  if (cmdrSection) exported.push(cmdrSection)
  if (mainSection) {
    exported.push(mainSection)
  } else {
    for (const s of deck.sections) {
      const name = s.name.toLowerCase()
      if (name.includes('commander')) continue // Already handled
      if (name.includes('maybeboard')) continue
      if (name.includes('sideboard')) continue
      if (name.includes('token')) continue
      exported.push(s)
    }
  }

  const cards = exported.flatMap((section) =>
    section.cards.map(
      (card): SectionedDialectCard => ({
        section: section.name,
        quantity: card.quantity,
        name: card.name,
        set: card.set,
        collectorNumber: card.collectorNumber,
        finish: card.finish,
        condition: card.condition,
        language: card.language,
      }),
    ),
  )
  return renderDialectText(aggregateDialectCards(cards), 'moxfield')
}

/**
 * The canonical single line for one entry of any list type, without a trailing
 * newline (the collection and wanted formatters are newline-terminated, the deck
 * serializer is not). The one dispatch shared by the line-surgery writer and the
 * markdown export — `labels` and `cardId` are each caller's to supply or
 * withhold.
 *
 * A collection entry that pins no printing falls through to the wanted grammar:
 * the collection grammar cannot express a bare name (it would write `(:)`). That
 * fallback carries neither a condition nor labels — the wanted grammar has no
 * token for either — which is why the collection parser refuses such a line in
 * the first place.
 */
export function canonicalCardLine(type: ListType, fields: EntryRef): string {
  if (type === 'deck') {
    return serializeCardLine({
      quantity: fields.quantity ?? 1,
      name: fields.name,
      set: fields.set,
      collectorNumber: fields.collectorNumber,
      finish: fields.finish,
      condition: fields.condition,
      language: fields.language,
      labels: fields.labels,
      note: fields.note,
      cardId: fields.cardId,
    })
  }
  if (type === 'collection' && fields.set && fields.collectorNumber) {
    return formatCollectionLine({
      cardName: fields.name,
      set: fields.set,
      collectorNumber: fields.collectorNumber,
      finish: fields.finish ?? 'nonfoil',
      condition: fields.condition,
      language: fields.language,
      labels: fields.labels,
      note: fields.note,
      cardId: fields.cardId,
    }).trimEnd()
  }
  return formatWantedListLine({
    name: fields.name,
    printing: resolvePrinting(fields.set, fields.collectorNumber),
    finish: fields.finish,
    language: fields.language,
    note: fields.note,
    cardId: fields.cardId,
  }).trimEnd()
}
