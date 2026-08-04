import type { Finish, Condition } from './types'
import { formatCardLabels, type CardLabel } from './card-labels'

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

/**
 * A deck-style quantity prefix on a one-line-per-copy list (collection, wanted).
 * Deck lines are `2 Sol Ring`; collection and wanted lines are one bullet per
 * copy, so the whole `- ` remainder up to the printing is the card name — which
 * means `- 1 Sol Ring (C21:240)` parses as a card *named* `1 Sol Ring` and then
 * misses the card cache, Scryfall, and Archidekt alike.
 *
 * Only a 1–3 digit leading integer counts: those are the quantities anyone
 * actually writes, while a longer run of digits is a real name (`1996 World
 * Champion`), which must parse untouched and unremarked.
 */
const QUANTITY_PREFIX_RE = /^(\d{1,3}) \S/

/**
 * The advisory for a card name that looks like it kept a deck's quantity prefix,
 * or `undefined` when it does not. An advisory rather than a warning on purpose:
 * the line parsed and a re-serialize would preserve it verbatim, so it must not
 * trip the whole-file-rewrite gates (`unreadableLines`) that exist for content a
 * save would *delete*.
 */
export function quantityPrefixAdvisory(name: string, line: string): string | undefined {
  if (!QUANTITY_PREFIX_RE.test(name)) return undefined
  return (
    `Card name starts with a quantity, so the line reads as a card named '${name}': ${line} ` +
    '— collections and wanted lists hold one line per copy; remove the leading quantity.'
  )
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
 * `- Sol Ring (LTC:284) [foil] [LP] [keep] {note} &12`. The default NM
 * condition is omitted (matching deck lines) — only non-NM conditions are
 * written — and a label override is written only when present (an absent
 * override means "inherit the list default"). Pure string formatting shared by
 * the CLI, the admin save handlers, and the public editor's export.
 */
export function formatCollectionLine(
  cardName: string,
  set: string,
  collectorNumber: string,
  finish: Finish,
  condition: Condition | undefined,
  labels?: readonly CardLabel[],
  note?: string,
  cardId?: number,
): string {
  let line = `- ${cardName} (${set.toUpperCase()}:${collectorNumber})`
  if (finish !== 'nonfoil') line += ` [${finish}]`
  if (condition && condition !== 'NM') line += ` [${condition}]`
  if (labels && labels.length > 0) line += ` [${formatCardLabels(labels)}]`
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
