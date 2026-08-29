import type { Finish, Condition } from './finish-condition'
import type { CardLabel } from './card-labels'
import { displayLanguage, type CardLanguage } from './card-language'
import { formatCanonicalCardLine, printingLabel } from './card-line-tail'

/** A specific printing reference (set code + collector number) for a card line. */
export type CardPrinting = { set: string; collectorNumber: string }

/**
 * The canonical parenthesised printing suffix for a card line / text export, e.g.
 * ` (LEA:161)` — a leading space, the set code uppercased, and the collector
 * number. Empty when either field is missing (a name-only entry).
 */
export function printingSuffix(
  set: string | undefined,
  collectorNumber: string | undefined,
): string {
  if (!set || !collectorNumber) return ''
  return ` (${printingLabel(set, collectorNumber)})`
}

/**
 * A printing, but only when both halves are present — otherwise `undefined`.
 *
 * A printing is a *pair*: {@link printingSuffix} can express `(LEA:161)` and
 * nothing else, so a set with no collector number cannot be written to a card
 * line at all. Carrying half of one in memory is therefore a silent loss waiting
 * to happen: the entry serializes as a bare name with the set gone, while
 * comparing as a distinct printing (so two entries differing only by a
 * collector-number-less set become two byte-identical lines). Sources that may
 * report one half without the other — third-party APIs, export dialects —
 * normalize through here: both fields, or neither.
 */
export function resolvePrinting(
  set: string | undefined,
  collectorNumber: string | undefined,
): CardPrinting | undefined {
  if (!set || !collectorNumber) return undefined
  return { set: set.toLowerCase(), collectorNumber }
}

/** One grouped item plus its summed quantity, preserving first-seen order. */
export type Aggregated<E> = { entry: E; quantity: number }

/**
 * Group items by a string key, summing per-item quantities, preserving
 * first-seen order. Shared by every surface that collapses card lines into
 * per-variant counts (editor copy/export, `ritual export` text output).
 */
export function aggregateQuantities<E>(
  items: E[],
  key: (item: E) => string,
  quantity: (item: E) => number,
): Aggregated<E>[] {
  const counts = new Map<string, Aggregated<E>>()
  for (const item of items) {
    const k = key(item)
    const existing = counts.get(k)
    if (existing) existing.quantity += quantity(item)
    else counts.set(k, { entry: item, quantity: quantity(item) })
  }
  return [...counts.values()]
}

/**
 * Aggregation key grouping identical card variants (name + printing + finish +
 * condition + language). Finish, condition, and language distinguish variants
 * so quantities are never summed across them, even in outputs that print none
 * of the three. The language dimension folds a missing value to `en` (a bare
 * line means English), so `[en]` and bare lines group together.
 */
export function variantKey(
  name: string,
  set: string | undefined,
  collectorNumber: string | undefined,
  finish: string | undefined,
  condition: string | undefined,
  language: CardLanguage | undefined,
): string {
  return `${name}|${set ?? ''}|${collectorNumber ?? ''}|${finish ?? ''}|${condition ?? ''}|${displayLanguage(language)}`
}

/** Named fields for {@link formatCollectionLine}. */
export type CollectionLineFields = {
  cardName: string
  set: string
  collectorNumber: string
  finish: Finish
  condition?: Condition
  /** Omitted (or `en`) writes a bare line — the token is never written for English. */
  language?: CardLanguage
  /** Written only when non-empty; absent means "inherit the list default". */
  labels?: readonly CardLabel[]
  note?: string
  cardId?: number
}

/**
 * Format a single collection card line in the canonical markdown format, e.g.
 * `- Sol Ring (LTC:284) [foil] [LP] [ja] [keep] {note} &12`. The default NM
 * condition is omitted (matching deck lines) — only non-NM conditions are
 * written — the language token is omitted for English (a bare line means
 * `en`), and a label override is written only when present (an absent
 * override means "inherit the list default"). Pure string formatting shared by
 * the CLI, the admin save handlers, and the public editor's export.
 */
export function formatCollectionLine(fields: CollectionLineFields): string {
  const { cardName, set, collectorNumber, ...tail } = fields
  return (
    formatCanonicalCardLine('collection', {
      name: cardName,
      // Lowercase in memory, uppercased by `printingLabel` on the way out.
      printing: { set: set.toLowerCase(), collectorNumber },
      ...tail,
    }) + '\n'
  )
}

/** Named fields for {@link formatWantedListLine}. */
export type WantedLineFields = {
  name: string
  /** Absent for a name-only wanted entry. */
  printing?: CardPrinting
  finish?: Finish
  /** Omitted (or `en`) writes a bare line — the token is never written for English. */
  language?: CardLanguage
  note?: string
  cardId?: number
}

/**
 * Format a single wanted-list card line in the canonical markdown format. The
 * printing, finish, and language are optional (a wanted entry may be
 * name-only; an English language is never written), and wanted lists never
 * carry a condition. Pure string formatting, shared like
 * {@link formatCollectionLine}.
 */
export function formatWantedListLine(fields: WantedLineFields): string {
  return formatCanonicalCardLine('wanted', fields) + '\n'
}
