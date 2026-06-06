import type { DeckData } from './types'

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
