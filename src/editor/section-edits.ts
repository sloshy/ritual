/**
 * The editor's section rules, pure over the section order: case-insensitive
 * uniqueness, the name validation the section prompts share, and the baseline
 * a move consolidates against.
 */

import { DEFAULT_SECTION } from '../list/deck'
import type { CardContextInfo } from '../list-view/card-context'
import type { SectionInfo } from './editor-config'

/**
 * Section names are unique case-insensitively. Returns the existing section
 * whose name matches `name` ignoring case, if any, so callers can reject
 * duplicates and resolve a typed name back to its canonical casing.
 */
export function canonicalSection(order: readonly string[], name: string): string | undefined {
  return order.find((s) => s.toLowerCase() === name.toLowerCase())
}

/** Why a typed section name is refused. */
export type SectionNameError = { kind: 'required' } | { kind: 'exists'; clash: string }

/**
 * Validation shared by the new-section and rename prompts: non-empty and
 * unique case-insensitively. A rename may keep its own name — a pure case
 * change of the same section is allowed — via `allowExisting`; clashing with a
 * *different* existing section (case-insensitively) is not.
 */
export function sectionNameError(
  order: readonly string[],
  value: string,
  allowExisting?: string,
): SectionNameError | null {
  const trimmed = value.trim()
  if (!trimmed) return { kind: 'required' }
  const clash = canonicalSection(order, trimmed)
  if (clash && clash !== allowExisting) return { kind: 'exists', clash }
  return null
}

/** Sections in display order with their current card counts (zero for an empty section). */
export function sectionInfoFrom(
  order: readonly string[],
  counts: Record<string, number>,
): SectionInfo[] {
  return order.map((name) => ({ name, count: counts[name] ?? 0 }))
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
