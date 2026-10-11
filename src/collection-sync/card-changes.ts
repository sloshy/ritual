/**
 * The structured per-card changes a collection sync reports for each list — the
 * one source the CLI's `--verbose` lines, the admin page, the MCP report and the
 * per-list counts all read. Side-effect free.
 */

import { storedLanguage } from '../card/card-language'
import { printingKey } from '../card/printing-key'
import type { CollectionKeyParts } from './describe'
import type { PushCreate, PushOperation } from './diff'
import type {
  CollectionSyncCardAdded,
  CollectionSyncCardChange,
  CollectionSyncCardPending,
  CollectionSyncCardRemoved,
  CollectionSyncPrinting,
} from './types'

/**
 * A change's printing: the key's parts, with `language` only when it is not
 * English — a local `[en]` token never surfaces as `language: 'en'`.
 */
export function printingOf(parts: CollectionKeyParts): CollectionSyncPrinting {
  const { set, collectorNumber, finish, condition } = parts
  const language = storedLanguage(parts.language)
  return {
    set,
    collectorNumber,
    finish,
    condition,
    ...(language === undefined ? {} : { language }),
  }
}

/** The fields every change of one operation shares. */
type ChangeSubject = Pick<CollectionSyncCardAdded, 'name' | 'printing'>

/**
 * What one push operation does to Archidekt: a create or a grown record adds
 * copies, a trimmed or deleted record removes them.
 */
export function pushOperationChange(
  operation: PushOperation,
): CollectionSyncCardAdded | CollectionSyncCardRemoved {
  const base: ChangeSubject = { name: operation.name, printing: printingOf(operation.parts) }
  if (operation.kind === 'create') return { kind: 'added', quantity: operation.quantity, ...base }
  if (operation.kind === 'update') {
    return operation.delta > 0
      ? { kind: 'added', quantity: operation.delta, ...base }
      : { kind: 'removed', quantity: -operation.delta, ...base }
  }
  return { kind: 'removed', quantity: operation.removed, ...base }
}

/**
 * What a CSV row did: its copies were added to Archidekt by the CSV import, or —
 * when the CSV was written to a file instead — are pending a manual import.
 */
export function csvRowChange(
  operation: PushCreate,
  kind: 'added' | 'pending',
): CollectionSyncCardAdded | CollectionSyncCardPending {
  const subject: ChangeSubject = { name: operation.name, printing: printingOf(operation.parts) }
  return kind === 'added'
    ? { kind, via: 'csv', quantity: operation.quantity, ...subject }
    : { kind, quantity: operation.quantity, ...subject }
}

/** What makes two changes the same entry: kind, route, card and printing. */
export function changeKey(change: CollectionSyncCardChange): string {
  const { printing } = change
  const via = change.kind === 'added' ? (change.via ?? '') : ''
  return [
    change.kind,
    via,
    change.name,
    printingKey(printing.set, printing.collectorNumber),
    printing.finish,
    printing.condition,
    printing.language ?? '',
  ].join('|')
}

/**
 * Record a change in a list's changes: one entry per card, printing and kind,
 * so a push that trims one record of a key and deletes another lists a single
 * removal of their total.
 */
export function recordCardChange(
  changes: CollectionSyncCardChange[],
  change: CollectionSyncCardChange,
): void {
  const key = changeKey(change)
  const index = changes.findIndex((existing) => changeKey(existing) === key)
  const existing = index === -1 ? undefined : changes[index]
  if (existing === undefined) {
    changes.push({ ...change })
    return
  }
  changes[index] = { ...existing, quantity: existing.quantity + change.quantity }
}
