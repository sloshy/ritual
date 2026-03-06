/**
 * Parser for Moxfield-flavored primer text.
 *
 * Converts the custom Moxfield panel/accordion markup into clean Markdown,
 * while preserving [[Card Name]] and [[youtube:id]] double-bracket tokens for
 * runtime rendering by the site.
 */

export type PrimerHeading = {
  /** Anchor-safe id derived from the heading text. */
  id: string
  /** Raw heading text (may contain inline markup). */
  text: string
  /** Heading level: 2 = H2, 3 = H3, etc. */
  level: number
}

export type ParsedPrimer = {
  markdown: string
  headings: PrimerHeading[]
  /** Unique card names referenced via [[Card Name]] tokens (case-preserved from first occurrence). */
  cardNames: string[]
}

/**
 * Derive an anchor-safe id from a heading text string.
 * Strips inline Moxfield markup (*, [[...]]), lowercases, and replaces
 * non-alphanumeric runs with hyphens.
 */
function headingId(text: string): string {
  return text
    .replace(/\*+/g, '')
    .replace(/\[\[[^\]]*\]\]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

/**
 * Extract all unique card names (case-insensitive dedup, case-preserved from
 * first occurrence) referenced as [[Card Name]] tokens, excluding [[youtube:…]]
 * tokens.
 */
export function extractPrimerCardNames(markdown: string): string[] {
  const seen = new Map<string, string>() // lowercase key → original case value
  const regex = /\[\[(?!youtube:)([^\]]+)\]\]/gi
  let match: RegExpExecArray | null
  while ((match = regex.exec(markdown)) !== null) {
    const name = match[1]!.trim()
    const key = name.toLowerCase()
    if (!seen.has(key)) {
      seen.set(key, name)
    }
  }
  return Array.from(seen.values())
}

/**
 * Parse raw Moxfield primer text into clean Markdown suitable for storage and
 * runtime rendering.
 *
 * Transformation rules:
 *  - `===accordion` / `===endaccordion` lines are stripped (the wrapper lines
 *    only). Content inside is kept. NOTE: accordion collapsible/expanding
 *    behaviour is not implemented and is intentionally removed here.
 *  - `===panel: Heading Text` is converted to a Markdown heading. The heading
 *    level starts at H2 and increases by one for each nested panel (H3, H4…).
 *  - `===endpanel` lines are stripped and decrement the nesting depth counter.
 *  - `*italic*` and `**bold**` are standard Markdown — passed through as-is.
 *  - `[[youtube:videoId]]` tokens are preserved for runtime rendering.
 *  - `[[Card Name]]` tokens are preserved for runtime rendering. Card names are
 *    also collected into the returned `cardNames` list.
 */
export function parseMoxfieldPrimer(raw: string): ParsedPrimer {
  const lines = raw.split('\n')
  const outputLines: string[] = []
  const headings: PrimerHeading[] = []
  let depth = 0 // current panel nesting depth (0 = top level, outside any panel)

  for (const line of lines) {
    const trimmed = line.trim()

    // Strip accordion wrapper lines only — do not remove content inside.
    // Accordion (collapsible section) behaviour is not implemented.
    if (trimmed === '===accordion' || trimmed === '===endaccordion') {
      continue
    }

    // Convert panel headings → Markdown headings.
    const panelMatch = trimmed.match(/^===panel:\s*(.*)$/)
    if (panelMatch) {
      depth++
      const headingText = (panelMatch[1] ?? '').trim()
      // H2 at depth 1, H3 at depth 2, capped at H6.
      const level = Math.min(depth + 1, 6)
      const prefix = '#'.repeat(level)
      const id = headingId(headingText)
      outputLines.push(`${prefix} ${headingText}`)
      headings.push({ id, text: headingText, level })
      continue
    }

    // Strip ===endpanel and decrement depth.
    if (trimmed === '===endpanel') {
      depth = Math.max(0, depth - 1)
      continue
    }

    outputLines.push(line)
  }

  const markdown = outputLines
    // Collapse runs of more than two consecutive blank lines into two.
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  const cardNames = extractPrimerCardNames(markdown)

  return { markdown, headings, cardNames }
}
