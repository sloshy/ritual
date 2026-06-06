import type { Finish, Condition } from './types'

/** A specific printing reference (set code + collector number) for a card line. */
export type CardPrinting = { set: string; collectorNumber: string }

/**
 * Format a single collection card line in the canonical markdown format, e.g.
 * `- Sol Ring (LTC:284) [foil] [LP] {note} &12`. Pure string formatting shared by
 * the CLI, the admin save handlers, and the public editor's export.
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
  if (condition) line += ` [${condition}]`
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
