import type { Finish, Condition } from './types'

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
  return ` (${set.toUpperCase()}:${collectorNumber})`
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
 * condition). Finish and condition distinguish variants so quantities are never
 * summed across them, even in outputs that print neither.
 */
export function variantKey(
  name: string,
  set: string | undefined,
  collectorNumber: string | undefined,
  finish: string | undefined,
  condition: string | undefined,
): string {
  return `${name}|${set ?? ''}|${collectorNumber ?? ''}|${finish ?? ''}|${condition ?? ''}`
}

/**
 * Format a single collection card line in the canonical markdown format, e.g.
 * `- Sol Ring (LTC:284) [foil] [LP] {note} &12`. The default NM condition is
 * omitted (matching deck lines) — only non-NM conditions are written. Pure
 * string formatting shared by the CLI, the admin save handlers, and the public
 * editor's export.
 */
export function formatCollectionLine(
  cardName: string,
  set: string,
  collectorNumber: string,
  finish: Finish,
  condition: Condition | undefined,
  note?: string,
  cardId?: number,
): string {
  let line = `- ${cardName} (${set.toUpperCase()}:${collectorNumber})`
  if (finish !== 'nonfoil') line += ` [${finish}]`
  if (condition && condition !== 'NM') line += ` [${condition}]`
  if (note) line += ` {${note}}`
  if (cardId !== undefined) line += ` &${cardId}`
  return line + '\n'
}

/**
 * Format a single wanted-list card line in the canonical markdown format. The
 * printing and finish are optional (a wanted entry may be name-only), and wanted
 * lists never carry a condition. Pure string formatting, shared like
 * {@link formatCollectionLine}.
 */
export function formatWantedListLine(
  name: string,
  printing?: CardPrinting,
  finish?: Finish,
  note?: string,
  cardId?: number,
): string {
  let line = `- ${name}`
  if (printing) line += ` (${printing.set.toUpperCase()}:${printing.collectorNumber})`
  if (finish && finish !== 'nonfoil') line += ` [${finish}]`
  if (note) line += ` {${note}}`
  if (cardId !== undefined) line += ` &${cardId}`
  return line + '\n'
}
