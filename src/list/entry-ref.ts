/**
 * Type-agnostic card entry references: loading a list's entries as
 * {@link EntryRef}s and locating one by `--card-id` or (fuzzy) name. Prompt-free.
 */

import path from 'node:path'
import { loadListEntries } from './entry-load'
import { ExitCode, CardCommandError, localizedCommandError } from '../util/errors'
import { matchByNormalizedName } from '../card/term-match'
import type { ListType } from './list-type'
import { formatPrintingAnnotation } from '../changes/change-event'
import { t, type MessageParams } from '../i18n/t'
import type { CardLabel } from '../card/card-labels'
import type { CardLanguage } from '../card/card-language'
import type { Condition, Finish } from '../card/finish-condition'

/** Unified summary for a card entry across all list types. */
export type EntryRef = {
  name: string
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
  /** The line's language token, when present. Absent means `en` (a bare line means English). */
  language?: CardLanguage
  /** Label override — where the list type carries labels (never on a wanted entry). */
  labels?: CardLabel[]
  note?: string
  cardId?: number
  /** Line quantity. Only a deck line can exceed 1 — flat-list entries are one card each. */
  quantity?: number
}

/** The `--card-id` / card-name selectors a one-shot card command targets an entry by. */
export type EntryQuery = {
  cardId: number | undefined
  cardName: string | undefined
}

/** A list's entries together with the file they were loaded from. */
export type EntryLookup = { type: ListType; filePath: string; entries: EntryRef[] }

/** Load every card entry of a list as a type-agnostic {@link EntryRef}. */
export async function loadEntryRefs(type: ListType, filePath: string): Promise<EntryRef[]> {
  return (await loadListEntries(type, filePath)).entries
}

/** {@link findTargetEntry} found no selector: the caller must pick among `candidates`. */
export type TargetPick = { kind: 'pick'; candidates: EntryRef[] }

/** Type guard: {@link findTargetEntry} left the choice to the caller. */
export function isTargetPick(result: EntryRef | TargetPick): result is TargetPick {
  return 'kind' in result
}

/**
 * Locate the target entry by `--card-id` (cross-checked against a name given
 * alongside it) or by fuzzy name; an empty list, unknown id, no match and an
 * ambiguous name are errors. With neither selector the caller picks.
 */
export function findTargetEntry(lookup: EntryLookup, input: EntryQuery): EntryRef | TargetPick {
  const { type, filePath, entries } = lookup
  if (entries.length === 0) {
    throw localizedCommandError('not_found', ExitCode.NotFound, 'cli.cardOps.listEmpty', { type })
  }

  if (input.cardId !== undefined) {
    const matches = entries.filter((e) => e.cardId === input.cardId)
    if (matches.length === 0) {
      throw localizedCommandError('not_found', ExitCode.NotFound, 'cli.cardOps.noCardWithId', {
        id: input.cardId,
        file: path.basename(filePath),
      })
    }
    // Card IDs are unique per file, so we expect exactly one match.
    const matched = matches[0]!
    ensureCardIdMatchesName({
      cardId: input.cardId,
      entryName: matched.name,
      requestedName: input.cardName,
    })
    return matched
  }

  if (input.cardName !== undefined) {
    // Exact-name matches beat substring matches (see matchByNormalizedName).
    const matched = matchByNormalizedName(entries, input.cardName, (e) => e.name)
    if (matched.length === 0) {
      throw localizedCommandError('not_found', ExitCode.NotFound, 'cli.cardOps.noCardMatching', {
        name: input.cardName,
        file: path.basename(filePath),
      })
    }
    if (matched.length === 1) return matched[0]!
    const params = ambiguityParams(input.cardName, matched)
    throw new CardCommandError(
      'usage_error',
      t('cli.cardOps.ambiguousCard', params),
      ExitCode.UsageError,
      {
        matches: matched.map((e) => ({
          name: e.name,
          cardId: e.cardId,
          set: e.set,
          collectorNumber: e.collectorNumber,
          finish: e.finish,
          condition: e.condition,
          language: e.language,
        })),
      },
      { key: 'cli.cardOps.ambiguousCard', params },
    )
  }

  return { kind: 'pick', candidates: entries }
}

/**
 * Cross-check a `--card-id` against a card name given alongside it: the two
 * selectors must agree. IDs are pool-allocated and reused after a removal, so a
 * script (or an agent) holding a stale ID would otherwise silently mutate — or
 * destroy — whichever card now carries it, reported as success.
 *
 * Matching is the same two-tier rule the name-only path uses
 * ({@link matchByNormalizedName}), so a partial name that would have found the
 * card also passes here. Pure-ID and pure-name invocations never reach this.
 */
export function ensureCardIdMatchesName(check: CardIdNameCheck): void {
  const { cardId, entryName, requestedName } = check
  if (requestedName === undefined) return
  if (matchByNormalizedName([entryName], requestedName, (name) => name).length > 0) return
  const params: MessageParams<'cli.cardOps.cardIdNameMismatch'> = {
    cardId,
    entryName,
    requestedName,
  }
  throw new CardCommandError(
    'usage_error',
    t('cli.cardOps.cardIdNameMismatch', params),
    ExitCode.UsageError,
    { cardId, entryName, requestedName },
    { key: 'cli.cardOps.cardIdNameMismatch', params },
  )
}

/** The two selectors {@link ensureCardIdMatchesName} cross-checks. */
export type CardIdNameCheck = {
  /** The `--card-id` value that selected the entry. */
  cardId: number
  /** The name of the entry that id resolved to. */
  entryName: string
  /** The card name the user passed alongside the id, if any. */
  requestedName: string | undefined
}

/** The params the ambiguity refusal renders from — one object feeding both `t()` and the ref. */
function ambiguityParams(
  search: string,
  matches: EntryRef[],
): MessageParams<'cli.cardOps.ambiguousCard'> {
  const lines = matches
    .slice(0, 10)
    .map((m) => t('cli.cardOps.matchLine', { entry: describeEntry(m) }))
    .join('\n')
  const suffix =
    matches.length > 10 ? `\n${t('cli.cardOps.andMore', { count: matches.length - 10 })}` : ''
  return { name: search, matches: `${lines}${suffix}` }
}

/** One-line human description of an entry: name, printing annotation, `&id`. */
export function describeEntry(entry: EntryRef): string {
  const annotation = formatPrintingAnnotation(entry)
  const id = entry.cardId !== undefined ? ` &${entry.cardId}` : ''
  return `${entry.name}${annotation}${id}`
}
