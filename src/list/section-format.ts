/**
 * Shared section helpers for the flat list types (collections and wanted lists).
 *
 * These lists store cards as `- ...` bullet lines under optional `## Section` (H2) headers,
 * beneath a single `# Title` (H1). Cards appearing before the first `## Section` header — or in
 * a section-less file — belong to the implicit `DEFAULT_SECTION` ("Main"), which is written out
 * explicitly on the next save. Decks use the same `## Section` convention via `deck-file.ts`.
 */

import { createFenceTracker, frontMatterBodyStart } from './markdown-fence'

/** Matches any ATX heading, capturing its `#` run and its text. */
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/

/** How many `#` an ATX heading may carry. */
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6

/** Every heading level, for narrowing a counted `#` run without an assertion. */
const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const satisfies readonly HeadingLevel[]

/** A markdown heading: how many `#` it carries, and the text after them. */
export type Heading = { level: HeadingLevel; text: string }

/**
 * Read a markdown ATX heading, or `null` when the line is not one.
 *
 * The single heading parser for list files: the flat-list section reader, the
 * deck parser, and the line-preserving mutations used to carry three regexes
 * that disagreed about whether `### Sideboard` was a section. They now share
 * this one and each decides what a *level* means to it.
 */
export function parseHeading(line: string): Heading | null {
  const match = HEADING_RE.exec(line.trim())
  if (!match?.[1] || !match[2]) return null
  // The `#{1,6}` in the pattern is what makes this total; looking the count up
  // narrows it without an assertion.
  const level = HEADING_LEVELS.find((candidate) => candidate === match[1]?.length)
  if (level === undefined) return null
  return { level, text: match[2].trim() }
}

/**
 * Returns the section name if `trimmedLine` is a `## Section` header, otherwise null.
 * Level two exactly, so the `# Title` H1 is never mistaken for a section header
 * and a deeper `### Foo` stays prose.
 */
export function matchSectionHeader(trimmedLine: string): string | null {
  const heading = parseHeading(trimmedLine)
  return heading?.level === 2 ? heading.text : null
}

/**
 * Read the first H1 (`# Title`) line from list-file content, or null if none.
 * A `# ...` line inside a fenced code block is prose, not the list's title.
 * YAML front matter is skipped before the fence scan, so a ``` inside it cannot
 * make the rest of the file opaque.
 */
export function parseTitleFromContent(content: string): string | null {
  const lines = content.split('\n')
  const fence = createFenceTracker()
  for (let i = frontMatterBodyStart(lines); i < lines.length; i++) {
    const line = lines[i]!
    if (fence.feed(line).opaque) continue
    // Column zero only, deliberately and unchanged: an indented `# ...` is a
    // markdown code block, not this document's title. `parseHeading` trims, so
    // the raw prefix test stays.
    if (!line.startsWith('# ')) continue
    const heading = parseHeading(line)
    if (heading?.level === 1) return heading.text
  }
  return null
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
