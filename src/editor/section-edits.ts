/**
 * The editor's section rules, pure over the section order: case-insensitive
 * uniqueness, the name validation the section prompts share, and the baseline
 * a move consolidates against.
 */

import { DEFAULT_SECTION } from '../list/deck'
import { resolveTypedSectionName } from '../list/deck-format'
import type { CardContextInfo } from '../list-view/card-context'
import type { SectionInfo } from './editor-config'

/**
 * Section names are unique case-insensitively, and by what they read as: a
 * known board typed by its name in the UI language (German `Seitenboard`) is
 * that board. Returns the existing section a typed `name` means, if any
 * (`resolveTypedSectionName`), so callers can reject duplicates and resolve a
 * typed name back to the heading the list already has.
 */
export function canonicalSection(order: readonly string[], name: string): string | undefined {
  return resolveTypedSectionName(order, name).existing
}

/**
 * The heading a typed new or renamed section name writes: a known board's
 * name in the UI language is the board's English token, so a translated name
 * never lands in the file. A pure case change of an existing heading keeps the
 * casing typed.
 */
export function typedSectionHeading(order: readonly string[], value: string): string {
  const trimmed = value.trim()
  const { name, existing } = resolveTypedSectionName(order, trimmed)
  return existing !== undefined && existing.toLowerCase() === trimmed.toLowerCase() ? trimmed : name
}

/** Why a typed section name is refused. */
export type SectionNameError = { kind: 'required' } | { kind: 'exists'; clash: string }

/**
 * The one shape rule for a typed section name, shared by every prompt — the
 * CLI's and both editors': it must not be blank. Nothing else is refused: a
 * leading `#` round-trips (`## #Foo` reads back as `#Foo`), and a line break is
 * folded away when the heading is written.
 */
export function isBlankSectionName(value: string): boolean {
  return value.trim() === ''
}

/**
 * Validation shared by the new-section and rename prompts: non-empty
 * ({@link isBlankSectionName}) and unique case-insensitively. A rename may keep its own name — a pure case
 * change of the same section is allowed — via `allowExisting`; clashing with a
 * *different* existing section (case-insensitively) is not.
 */
export function sectionNameError(
  order: readonly string[],
  value: string,
  allowExisting?: string,
): SectionNameError | null {
  if (isBlankSectionName(value)) return { kind: 'required' }
  const trimmed = value.trim()
  const clash = canonicalSection(order, trimmed)
  if (clash && clash !== allowExisting) return { kind: 'exists', clash }
  return null
}

/** Sections in display order with their current card counts (zero for an empty section). */
export function sectionInfoFrom(
  order: readonly string[],
  counts: Record<string, number>,
): SectionInfo[] {
  // Own keys only: a section named `constructor` is not the prototype's.
  return order.map((name) => ({
    name,
    count: Object.hasOwn(counts, name) ? (counts[name] ?? 0) : 0,
  }))
}

/**
 * The section a move consolidates against. The original section drives
 * "latest wins" consolidation: moving a card back to where it started cancels
 * the pending move outright. A card not present in the on-disk original (e.g.
 * added this session) baselines to `DEFAULT_SECTION` — never the destination,
 * which would make the very first move look like a no-op revert and silently
 * drop it.
 */
export function moveBaselineSection<TData>(
  original: TData | null,
  target: CardContextInfo,
  cardSectionOf: ((data: TData, target: CardContextInfo) => string | undefined) | undefined,
): string {
  return (original ? cardSectionOf?.(original, target) : undefined) ?? DEFAULT_SECTION
}
