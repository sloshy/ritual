import type { Card, DeckData } from './types'
import { printingSuffix } from './card-line'
import { languageToken } from './card-language'

/**
 * Format a single deck card line in the canonical markdown format, e.g.
 * `2 Lightning Bolt (2XM:157) [foil] [LP] [ja] {note} &5`. The language token
 * is omitted for English (a bare line means `en`). Pure string formatting
 * shared by the deck markdown serializer, the CLI importers, and the admin save
 * handlers. Lives here (a browser-safe, type-only module) so the public site can
 * reuse it without pulling in the node-only `deck-file` helpers.
 */
export function serializeCardLine(card: Card): string {
  let line = `${card.quantity} ${card.name}${printingSuffix(card.set, card.collectorNumber)}`
  if (card.finish && card.finish !== 'nonfoil') {
    line += ` [${card.finish}]`
  }
  if (card.condition && card.condition !== 'NM') {
    line += ` [${card.condition}]`
  }
  line += languageToken(card.language)
  if (card.note) {
    line += ` {${card.note}}`
  }
  if (card.cardId !== undefined) {
    line += ` &${card.cardId}`
  }
  return line
}

/**
 * Render a deck to its canonical markdown body: one `## Section` block per
 * section, each followed by its cards' full `serializeCardLine` form (printing,
 * finish, condition, note, and `&N` id). This is the "MD" export offered in the
 * page header; it mirrors what a server save writes minus the YAML front matter,
 * which the client does not carry.
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
 * Render a deck to the plain-text decklist format used for the public site's
 * "Download" export (`## Section` headers followed by `{qty} {name}` lines).
 * Shared by `build-site` (baking the static export) and the public editor
 * (exporting an edited copy) so both produce identical files.
 *
 * Layout: the Commander section first (when present), then the Main/Mainboard
 * section; if there is no explicit Main section, every other section is included
 * except Sideboard, Maybeboard, and Token (which are deck-building extras).
 */
export function deckToExportText(deck: DeckData): string {
  const lines: string[] = []
  const cmdrSection = deck.sections.find((s) => s.name.toLowerCase().includes('commander'))
  const mainSection = deck.sections.find(
    (s) => s.name.toLowerCase() === 'main' || s.name.toLowerCase() === 'mainboard',
  )

  if (cmdrSection) {
    lines.push(`## ${cmdrSection.name}`)
    cmdrSection.cards.forEach((c) => lines.push(`${c.quantity} ${c.name}`))
    lines.push('')
  }

  if (mainSection) {
    lines.push(`## ${mainSection.name}`)
    mainSection.cards.forEach((c) => lines.push(`${c.quantity} ${c.name}`))
  } else {
    for (const s of deck.sections) {
      const name = s.name.toLowerCase()
      if (name.includes('commander')) continue // Already handled
      if (name.includes('maybeboard')) continue
      if (name.includes('sideboard')) continue
      if (name.includes('token')) continue
      lines.push('')
      lines.push(`## ${s.name}`)
      s.cards.forEach((c) => lines.push(`${c.quantity} ${c.name}`))
    }
  }

  return lines.join('\n').trim()
}
