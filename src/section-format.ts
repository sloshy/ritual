/**
 * Shared section helpers for the flat list types (collections and wanted lists).
 *
 * These lists store cards as `- ...` bullet lines under optional `## Section` (H2) headers,
 * beneath a single `# Title` (H1). Cards appearing before the first `## Section` header — or in
 * a section-less file — belong to the implicit `DEFAULT_SECTION` ("Main"), which is written out
 * explicitly on the next save. Decks use the same `## Section` convention via `deck-file.ts`.
 */

/**
 * Matches a `## Section Name` header line. Deliberately requires exactly two `#` followed by
 * whitespace, so the `# Title` H1 is never mistaken for a section header.
 */
export const SECTION_HEADER_RE = /^##\s+(.+?)\s*$/

/** Returns the section name if `trimmedLine` is a `## Section` header, otherwise null. */
export function matchSectionHeader(trimmedLine: string): string | null {
  const match = trimmedLine.match(SECTION_HEADER_RE)
  return match ? match[1]!.trim() : null
}

/**
 * Computes the canonical render/serialize order of sections: every name in `sectionOrder`
 * (which may include empty sections) first, then any section that has entries but was missing
 * from `sectionOrder`, appended in first-seen order. Duplicates are collapsed.
 */
export function orderedSections(entrySections: string[], sectionOrder: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const name of [...sectionOrder, ...entrySections]) {
    if (!seen.has(name)) {
      seen.add(name)
      result.push(name)
    }
  }
  return result
}

/** Minimal shape carrying a section name. */
export type Sectioned = { section: string }
/** A {@link Sectioned} entry that also has a file-order ordinal. */
export type OrderedSectioned = Sectioned & { fileOrder: number }

/**
 * Resolves the section render order for a flat-list page: prefers an explicit `propOrder`
 * (which may include empty sections) and otherwise derives it from the entries in file order.
 * Shared by the collection and wanted-list pages.
 */
export function deriveSectionOrder<E extends OrderedSectioned>(
  propOrder: string[] | undefined,
  entries: E[],
): string[] {
  if (propOrder && propOrder.length > 0) return propOrder
  const seen = new Set<string>()
  const order: string[] = []
  for (const entry of [...entries].sort((a, b) => a.fileOrder - b.fileOrder)) {
    if (!seen.has(entry.section)) {
      seen.add(entry.section)
      order.push(entry.section)
    }
  }
  return order
}

/** A flat list with two or more distinct sections defaults to grouping by section. */
export function sectionDefaultGroupBy<E extends Sectioned>(entries: E[]): 'section' | 'none' {
  return new Set(entries.map((e) => e.section)).size >= 2 ? 'section' : 'none'
}

/**
 * Serializes a flat, sectioned list to its full markdown form: a `# Title` H1 followed by one
 * `## Section` block per section (in `orderedSections` order), each containing its entries'
 * formatted lines. Empty sections (present in `sectionOrder` with no entries) emit a bare header.
 *
 * `formatLine` must return a single card line terminated by a newline (matching
 * `formatCollectionLine` / `formatWantedListLine`).
 */
export function serializeSectionedList<E extends Sectioned>(
  title: string,
  entries: E[],
  sectionOrder: string[],
  formatLine: (entry: E) => string,
): string {
  const order = orderedSections(
    entries.map((entry) => entry.section),
    sectionOrder,
  )
  const blocks = order.map((section) => {
    const body = entries
      .filter((entry) => entry.section === section)
      .map(formatLine)
      .join('')
    return `## ${section}\n${body}`
  })
  // Always end with exactly one trailing newline, regardless of whether the final block had
  // entries (each `formatLine` is newline-terminated) or the list was empty.
  return `# ${title}\n\n${blocks.join('\n')}`.replace(/\n*$/, '\n')
}
