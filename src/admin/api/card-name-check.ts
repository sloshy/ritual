/**
 * Card-name validation for write routes.
 *
 * Card targeting across Ritual is exact and case-sensitive, so a caller that
 * misspells a name gets an "unmatched change" error naming nothing it can act
 * on. This resolves names against the local Scryfall cache first, through the
 * same normalizer `GET /api/autocomplete` uses, so the refusal can name the
 * closest cached spellings instead.
 *
 * Validation is **opt-in** per request (`validateCardNames: true`), for two
 * reasons. It depends on a warm local cache, which the admin UI cannot assume
 * and does not need — it only sends names it read from a list. And a caller
 * asking for it is asserting a precondition, which is why an unsatisfiable
 * request (cold cache) is a 400 rather than the 503 the price routes return: the
 * price routes cannot do their job at all without a cache, whereas this route
 * could have, had the caller not asked for the check.
 */

import { cardCache } from '../../cache'
import { CACHE_REFRESH_REMEDY } from '../../cache/status'
import type { ChangeEvent } from '../../changes/change-event'
import { getFrontFaceName } from '../../scryfall/card-utils'
import {
  matchesNameTerms,
  normalizeCardName,
  rankNameMatches,
  splitNameTerms,
} from '../../card/term-match'
import { apiError } from '../../api/http'

/** How many close cached names a refusal offers per rejected name. */
export const MAX_CANDIDATES = 3

/**
 * The one message for a cold cache, naming the remedy on every surface rather
 * than projecting per client (an MCP agent cannot run a CLI command, and a CLI
 * user has no `refresh_cache` tool).
 */
export const COLD_CACHE_MESSAGE = `The local card cache is empty, so card names cannot be validated. ${CACHE_REFRESH_REMEDY}, or omit validateCardNames.`

/** One rejected name plus the closest cached names. */
export interface UnknownCardName {
  name: string
  /** Up to {@link MAX_CANDIDATES} cached names, closest first. */
  candidates: string[]
}

/** The outcome of {@link checkCardNames}. */
export type CardNameCheck =
  | { ok: true }
  | { ok: false; reason: 'cold-cache'; message: string }
  | { ok: false; reason: 'unknown-names'; unknown: UnknownCardName[]; message: string }

/** Names a request may write, and names already present in the lists it touches. */
export interface CardNameCheckInput {
  /** Every card name the request mentions, in request order. Deduped internally. */
  names: readonly string[]
  /** Names already in the affected list files; these are accepted without a cache lookup. */
  known: Iterable<string>
}

/** Every distinct `cardName` a change batch mentions, in first-mention order. */
export function changeCardNames(changes: readonly ChangeEvent[]): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  for (const change of changes) {
    if (!('cardName' in change)) continue
    if (seen.has(change.cardName)) continue
    seen.add(change.cardName)
    names.push(change.cardName)
  }
  return names
}

/**
 * One cached card name with the two derivations the miss path needs, computed
 * once for the whole request rather than once per rejected name.
 */
type CachedName = {
  name: string
  /** {@link normalizeCardName} of `name`, for term matching. */
  normalized: string
  /** {@link getFrontFaceName} of `name` — equal to `name` for single-faced cards. */
  frontFace: string
}

/** Decorate every cached name with the derivations {@link closestNames} and the DFC check use. */
function decorateCachedNames(names: readonly string[]): CachedName[] {
  return names.map((name) => ({
    name,
    normalized: normalizeCardName(name),
    frontFace: getFrontFaceName(name),
  }))
}

/**
 * The cached names closest to a name that did not resolve.
 *
 * Deliberately looser than autocomplete's every-term-must-match rule: the name
 * being explained is by definition *wrong*, and its wrong term is usually the
 * one the user mistyped, so requiring every term to match would return nothing
 * for exactly the case a suggestion is worth making ("Lightning Bolz"). Any term
 * matching admits candidates; `rankNameMatches` then orders them, so a name
 * matching more of the query still leads.
 */
function closestNames(allNames: readonly CachedName[], name: string): string[] {
  const terms = splitNameTerms(name)
  if (terms.length === 0) return []
  const matches = allNames
    .filter((candidate) => terms.some((term) => matchesNameTerms(candidate.normalized, [term])))
    .map((candidate) => candidate.name)
  return rankNameMatches(matches, name, (candidate) => candidate).slice(0, MAX_CANDIDATES)
}

/** Format the refusal so an agent reading only `message` still sees the candidates. */
function describeUnknown(unknown: readonly UnknownCardName[]): string {
  const parts = unknown.map((entry) => {
    const suffix =
      entry.candidates.length > 0 ? ` Did you mean: ${entry.candidates.join(', ')}?` : ''
    return `'${entry.name}' is not a card name the local cache knows.${suffix}`
  })
  return parts.join(' ')
}

/**
 * Check that every name a write mentions is one the local cache knows.
 *
 * A name already present in the affected list is accepted with **no lookup at
 * all**. That is what keeps validation from becoming a capability regression: a
 * custom, unreleased, or simply un-cached card that already lives in a file must
 * stay removable and editable, and the file itself is the authority on what is
 * in it.
 */
export async function checkCardNames(input: CardNameCheckInput): Promise<CardNameCheck> {
  const known = new Set(input.known)
  const toResolve = [...new Set(input.names)].filter((name) => !known.has(name))
  if (toResolve.length === 0) return { ok: true }

  if (await cardCache.isEmpty()) {
    return { ok: false, reason: 'cold-cache', message: COLD_CACHE_MESSAGE }
  }

  const unknown: UnknownCardName[] = []
  // Fetched and decorated once per request, not once per name: it is every
  // cached card name.
  let allNames: CachedName[] | undefined

  for (const name of toResolve) {
    const cached = await cardCache.get(name)
    if (cached && cached.length > 0) continue

    allNames ??= decorateCachedNames(await cardCache.keys())

    // A double-faced card is cached under its full "Front // Back" name, but a
    // deck or collection line may legally carry the front face alone — which is
    // how the CLI and the editors write them. Accepting the front face here is
    // what keeps `add_card { cardName: 'Delver of Secrets' }` from being refused
    // with its own full name as the suggestion. Only genuinely two-faced keys
    // qualify (`frontFace !== name`); a single-faced key equal to the name was
    // already tried above and failed, which means it holds no printings.
    const dfc = allNames.find(
      (candidate) => candidate.frontFace !== candidate.name && candidate.frontFace === name,
    )
    if (dfc && (await cardCache.get(dfc.name))?.length) continue

    unknown.push({ name, candidates: closestNames(allNames, name) })
  }

  if (unknown.length === 0) return { ok: true }
  return { ok: false, reason: 'unknown-names', unknown, message: describeUnknown(unknown) }
}

/** The outcome of {@link parseValidateCardNames}: the flag, or why it was refused. */
export type ValidateCardNamesFlag = { ok: true; value: boolean } | { ok: false; message: string }

/**
 * Read the opt-in `validateCardNames` request field. Validated, never coerced —
 * it decides whether a write is refused, so an unrecognized value is refused
 * rather than quietly read as "no".
 */
export function parseValidateCardNames(raw: unknown): ValidateCardNamesFlag {
  if (raw === undefined) return { ok: true, value: false }
  if (typeof raw !== 'boolean')
    return { ok: false, message: 'validateCardNames must be a boolean.' }
  return { ok: true, value: raw }
}

/**
 * The whole opt-in card-name gate for a write route: read the flag, and when it
 * is on, check every name the request mentions against the local cache.
 *
 * Returns the 400 to send, or null to proceed — so a handler spends one line on
 * a check whose refusal wording, status, and "names already in the file are
 * always accepted" rule are then identical on all five write routes.
 *
 * `known` is a thunk because it is only needed when the flag is on: gathering
 * the affected lists' current names is real work, and the default is off.
 */
export async function refuseUnknownCardNames(
  raw: unknown,
  names: readonly string[],
  known: () => Iterable<string>,
): Promise<Response | null> {
  const flag = parseValidateCardNames(raw)
  if (!flag.ok) return apiError(flag.message, 400)
  if (!flag.value) return null
  const check = await checkCardNames({ names, known: known() })
  return check.ok ? null : apiError(check.message, 400)
}
