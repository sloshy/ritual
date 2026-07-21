/**
 * Card type tag extraction, matching, and input parsing for the card-type filter.
 *
 * A Magic type line looks like `Legendary Artifact Creature — Robot Elf`, with an
 * em-dash separating types from subtypes and `//` separating the faces of a
 * double-faced card. Every word is an independent, filterable tag ("Legendary",
 * "Artifact", "Creature", "Robot", "Elf") — except for a small set of canonical
 * multi-word subtypes (e.g. "Time Lord") that must stay intact as one tag.
 *
 * Tags are stored and compared in lowercase (mirroring set codes) and rendered in
 * title case for display.
 */

import { matchesSelection, type FilterMatchMode } from './filter-mode'

/**
 * Subtypes whose canonical form contains a space and must be treated as a single
 * tag. "Time Lord" is a Doctor Who creature subtype; without this it would split
 * into the unrelated tags "Time" and "Lord".
 */
export const MULTI_WORD_CARD_TYPES = ['Time Lord'] as const

const MULTI_WORD_CARD_TYPES_LOWER = MULTI_WORD_CARD_TYPES.map((t) => t.toLowerCase())

/** Replace the type-line separators (em/en dash, slashes) with spaces. */
function normalizeTypeLine(typeLine: string): string {
  return typeLine.replace(/[—–/]+/g, ' ')
}

/**
 * Extract the unique lowercase type tags present in a single card's type line,
 * keeping known multi-word subtypes intact.
 */
export function extractCardTypeTags(typeLine: string): string[] {
  let text = ` ${normalizeTypeLine(typeLine).toLowerCase()} `
  const tags: string[] = []
  for (const phrase of MULTI_WORD_CARD_TYPES_LOWER) {
    const padded = ` ${phrase} `
    if (text.includes(padded)) {
      tags.push(phrase)
      text = text.split(padded).join('  ')
    }
  }
  for (const word of text.split(/\s+/)) {
    if (word.length > 0 && !tags.includes(word)) tags.push(word)
  }
  return tags
}

/**
 * Does a card's type line match the selected type tags under the given mode?
 * `selected` tags are lowercase. With no selected tags, returns true (the filter
 * is inactive).
 */
export function matchesCardTypes(
  typeLine: string,
  selected: string[],
  mode: FilterMatchMode,
): boolean {
  return matchesSelection(new Set(extractCardTypeTags(typeLine)), selected, mode)
}

/** Render a stored lowercase tag in title case for display ("time lord" → "Time Lord"). */
export function formatCardTypeForDisplay(tag: string): string {
  return tag.replace(/\b\w/g, (c) => c.toUpperCase())
}

export type CardTypeInputScan = {
  /** Completed tags, lowercased. */
  tags: string[]
  /** The trailing token still being typed (kept verbatim, including an open quote). */
  remainder: string
}

/**
 * Scan a (possibly partial) type-filter input into completed lowercase tags plus a
 * trailing remainder still being typed. Whitespace and commas separate tags, but a
 * double-quoted span keeps its internal spaces so multi-word types like "Time Lord"
 * can be entered by hand. A closing quote completes its tag immediately.
 */
export function scanCardTypeInput(value: string): CardTypeInputScan {
  const tags: string[] = []
  let current = ''
  let inQuotes = false
  const finish = (): void => {
    const tag = current.trim().toLowerCase()
    if (tag.length > 0) tags.push(tag)
    current = ''
  }
  for (const ch of value) {
    if (ch === '"') {
      if (inQuotes) finish()
      inQuotes = !inQuotes
      continue
    }
    if (!inQuotes && /[\s,]/.test(ch)) {
      finish()
      continue
    }
    current += ch
  }
  return { tags, remainder: inQuotes ? `"${current}` : current }
}

/**
 * Fully parse an input string into lowercase tags, committing any trailing partial
 * token (used on Enter and when adding a pasted value). A leading open quote on the
 * remainder is stripped so an unterminated `"Time Lord` still commits as one tag.
 */
export function parseCardTypesInput(value: string): string[] {
  const scan = scanCardTypeInput(value)
  const tags = [...scan.tags]
  const remainder = scan.remainder.replace(/^"/, '').trim().toLowerCase()
  if (remainder.length > 0 && !tags.includes(remainder)) tags.push(remainder)
  return tags
}
