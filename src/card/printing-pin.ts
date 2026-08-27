/**
 * Pure printing-pin resolution: matching a strict `SET:CN` / finish pin against
 * a card's known printings, looking up the cached printing an entry pins, and
 * the language a freshly added entry records.
 */

import {
  fetchPrintingByCollectorNumber,
  getCardPrintings,
  getCardPrintingsResult,
  getFrontFaceName,
} from '../scryfall'
import type { ScryfallCard } from '../scryfall/types'
import { printingFinishes, type Finish } from './finish-condition'
import { t, type MessageParams } from '../i18n/t'
import {
  findPrinting,
  hasSpecificPrinting,
  printingLanguages,
  printingsAreComplete,
  type CardPrintingsResult,
  type PrintingFields,
} from './card-printing'
import {
  displayLanguage,
  formatLanguageList,
  languageDisplayName,
  storedLanguage,
  type CardLanguage,
} from './card-language'
import { getDefaultLanguage } from '../config/ritual-config'
import type { PrintingRef } from './printing-key'
import { readRecordedCardBulkType } from '../cache/bulk-provenance'
import { ExitCode, CardCommandError, getErrorMessage, localizedCommandError } from '../util/errors'

/**
 * The language a freshly added entry records: the language the printing
 * resolution decided (the picker's availability confirm, or an explicit
 * `--language` flag folded in by the caller), else the configured
 * `defaultLanguage`. `en` collapses to undefined via {@link storedLanguage} —
 * the serializers omit the token for English, and a bare line always means
 * `en`. Adding never prompts for language.
 */
export function resolveAddedLanguage(resolved: CardLanguage | undefined): CardLanguage | undefined {
  return storedLanguage(resolved ?? getDefaultLanguage())
}

/** An existing list entry, as far as resolving the printing it pins is concerned. */
export type PinnedPrintingRef = {
  name: string
  set?: string
  collectorNumber?: string
}

/**
 * The cached printing an entry pins, or undefined when the entry is name-only or
 * the printing isn't cached. Used to price the finish picker for an existing entry,
 * which carries a set/collector number rather than a resolved {@link ScryfallCard}.
 */
export async function lookupPinnedPrinting(
  entry: PinnedPrintingRef,
): Promise<ScryfallCard | undefined> {
  if (!hasSpecificPrinting(entry)) return undefined
  return findPrinting(await getCardPrintings(entry.name), entry.set, entry.collectorNumber)
}

/** A concrete `set`/`collectorNumber` pair — a {@link PrintingRef} with both halves present. */
type PrintingPair = Required<Pick<PrintingRef, 'set' | 'collectorNumber'>>

/** A printing surfaced in a strict-pin error, as a `set`/`collectorNumber` pair. */
export type AvailablePrinting = PrintingPair

/**
 * Result of matching a strict `--set`/`--collector-number` printing pin against
 * a card's known printings. A failed match carries a user-facing message that
 * lists (up to {@link MAX_LISTED_PRINTINGS}) available printings, plus the same
 * list as structured data for machine output.
 */
export type PrintingPinMatch =
  | { ok: true; printing: ScryfallCard }
  | { ok: false; message: string; available: AvailablePrinting[]; totalPrintings: number }

const MAX_LISTED_PRINTINGS = 10

/**
 * Match a strict printing pin. Unlike {@link resolveCardPrinting}'s soft set
 * filter (which falls back to all printings when nothing matches), a pin that
 * doesn't correspond to a real printing is an error. Set codes are compared
 * case-insensitively; collector numbers must match exactly.
 */
export function matchPrintingPin(
  cardName: string,
  printings: ScryfallCard[],
  set: string,
  collectorNumber: string,
): PrintingPinMatch {
  const printing = findPrinting(printings, set, collectorNumber)
  if (printing) return { ok: true, printing }

  const available: AvailablePrinting[] = printings.slice(0, MAX_LISTED_PRINTINGS).map((p) => ({
    set: p.set.toLowerCase(),
    collectorNumber: p.collector_number,
  }))
  if (printings.length === 0) {
    return {
      ok: false,
      message: t('cli.printing.noneCached', { name: cardName }),
      available,
      totalPrintings: 0,
    }
  }
  const listed = available.map((p) => `${p.set.toUpperCase()}:${p.collectorNumber}`).join(', ')
  const more =
    printings.length > MAX_LISTED_PRINTINGS
      ? t('cli.printing.andMore', { count: printings.length - MAX_LISTED_PRINTINGS })
      : ''
  return {
    ok: false,
    message: t('cli.printing.pinNotFound', {
      printing: `${set.toUpperCase()}:${collectorNumber}`,
      name: cardName,
      listed,
      more,
    }),
    available,
    totalPrintings: printings.length,
  }
}

/** Result of validating a requested finish against a resolved printing. */
export type FinishPinMatch = { ok: true } | { ok: false; message: string; available: Finish[] }

/**
 * Validate that `finish` is one the printing is offered in. A valid-but-
 * unavailable finish is an error listing the finishes that do exist, rather
 * than a silent fallback to a prompt.
 */
export function matchFinishPin(
  cardName: string,
  printing: ScryfallCard,
  finish: Finish,
): FinishPinMatch {
  const available = printingFinishes(printing)
  if (available.includes(finish)) return { ok: true }
  return {
    ok: false,
    message: t('cli.printing.finishUnavailable', {
      printing: `${printing.set.toUpperCase()}:${printing.collector_number}`,
      name: cardName,
      finish,
      available: available.join(', '),
    }),
    available,
  }
}

/** A strict `--set`/`--collector-number` printing pin (set code lowercase). */
export type PrintingPin = PrintingPair

/** Case-insensitive name match tolerating a front-face-only spelling. */
function sameCardName(a: string, b: string): boolean {
  if (a.toLowerCase() === b.toLowerCase()) return true
  return getFrontFaceName(a).toLowerCase() === getFrontFaceName(b).toLowerCase()
}

/**
 * The card's cached printings (no network). A `CardCommandError` from the cache
 * layer passes through; any other failure is reported as a printing lookup error.
 */
async function cachedPrintings(cardName: string): Promise<CardPrintingsResult> {
  try {
    return await getCardPrintingsResult(cardName, { network: false })
  } catch (err) {
    if (err instanceof CardCommandError) throw err
    throw localizedCommandError(
      'runtime_error',
      ExitCode.RuntimeError,
      'cli.cardOps.printingLookupFailed',
      { name: cardName, reason: getErrorMessage(err) },
    )
  }
}

/** Refuse a fetched printing that belongs to a different card than the one named. */
function ensureSameCard(printing: ScryfallCard, cardName: string, printingLabel: string): void {
  if (!sameCardName(printing.name, cardName)) {
    throw localizedCommandError('usage_error', ExitCode.UsageError, 'cli.cardOps.printingIsOther', {
      printing: printingLabel,
      actual: printing.name,
      name: cardName,
    })
  }
}

/**
 * Verify a pin the local cache cannot vouch for by asking Scryfall for that
 * exact printing.
 *
 * Without this, a workspace whose cache has never been bulk-downloaded
 * validates pins against a single-card `/cards/named` fallback — so every real
 * printing but the one Scryfall happened to return is rejected, under a message
 * asserting it is the card's only "available printing".
 */
async function verifyPinAgainstScryfall(cardName: string, pin: PrintingPin): Promise<ScryfallCard> {
  const advice = t('cli.cardOps.noCachedPrintingList', { name: cardName })
  const printingLabel = `${pin.set.toUpperCase()}:${pin.collectorNumber}`
  let printing: ScryfallCard | null
  try {
    printing = await fetchPrintingByCollectorNumber(pin.set, pin.collectorNumber)
  } catch (err) {
    throw localizedCommandError(
      'runtime_error',
      ExitCode.RuntimeError,
      'cli.cardOps.verifyPrintingFailed',
      { printing: printingLabel, reason: getErrorMessage(err), advice },
    )
  }
  if (!printing) {
    throw localizedCommandError(
      'usage_error',
      ExitCode.UsageError,
      'cli.cardOps.printingUnverified',
      { printing: printingLabel, name: cardName, advice },
    )
  }
  ensureSameCard(printing, cardName, printingLabel)
  return printing
}

/**
 * Resolve a strict `--set`/`--collector-number` pin against the card's known
 * printings. A failed cache lookup is a runtime error; a pin that matches no
 * printing is a usage error listing the printings that do exist — deliberately
 * not routed through `resolveCardPrinting`'s soft set filter, which falls back
 * to all printings instead of failing.
 *
 * The listing is only trustworthy when it came from the card cache. When the
 * cache holds no entry for the name, the pin is verified against Scryfall
 * directly rather than against the one printing a fallback fetch returned.
 */
export async function resolvePinnedPrinting(
  cardName: string,
  pin: PrintingPin,
): Promise<ScryfallCard> {
  // Cache-only: a `/cards/named` fallback could not be trusted to validate the
  // pin anyway, so the miss goes straight to verifying the pinned printing
  // itself — one request instead of two.
  const result = await cachedPrintings(cardName)
  if (!printingsAreComplete(result)) return await verifyPinAgainstScryfall(cardName, pin)
  const printings = result.printings
  const match = matchPrintingPin(cardName, printings, pin.set, pin.collectorNumber)
  if (!match.ok) {
    throw new CardCommandError('usage_error', match.message, ExitCode.UsageError, {
      available: match.available,
      totalPrintings: match.totalPrintings,
    })
  }
  return match.printing
}

/** Why {@link ensureFinishAvailableForEntry} could not check a finish. */
export type FinishCheckSkip =
  /** The entry carries no `(SET:CN)` printing — there is nothing to check against. */
  | 'no-printing'
  /** The card cache holds no complete printing list for the name. */
  | 'cache-miss'
  /** The cache knows the card but not this printing. */
  | 'printing-unknown'

/** Either the finish was checked, or the reason it could not be. */
export type FinishCheckResult = { checked: true } | { checked: false; reason: FinishCheckSkip }

/**
 * Validate a finish against the printing an entry **already** carries.
 *
 * Cache-only, deliberately: a `/cards/named` fallback returns a single arbitrary
 * printing, and rejecting a finish against a list that is not the card's whole
 * printing set fabricates a refusal. When the cache cannot vouch for the
 * printing, the check is skipped and the reason reported — a missing local cache
 * must never turn into a wrong answer, and no in-place edit performs a hidden
 * network fetch to grade a finish.
 */
export async function ensureFinishAvailableForEntry(
  cardName: string,
  entry: PrintingFields,
  finish: Finish,
): Promise<FinishCheckResult> {
  if (!hasSpecificPrinting(entry)) return { checked: false, reason: 'no-printing' }
  const result = await cachedPrintings(cardName)
  if (!printingsAreComplete(result)) return { checked: false, reason: 'cache-miss' }
  const printing = findPrinting(result.printings, entry.set, entry.collectorNumber)
  if (!printing) return { checked: false, reason: 'printing-unknown' }
  ensureFinishAvailable(cardName, printing, finish)
  return { checked: true }
}

/**
 * Either the language was checked (and is available), or the reason it could
 * not be: the entry carries no `(SET:CN)` printing (a language claim on a
 * name-only line is unverifiable), or the on-demand Scryfall verification
 * could not be reached — only that branch carries the underlying error text.
 */
export type LanguageCheckResult =
  | { checked: true }
  | { checked: false; reason: 'no-printing' }
  | { checked: false; reason: 'verify-failed'; detail?: string }

/**
 * Validate that a printing exists in `language` before recording a `[lang]`
 * token for it.
 *
 * Unlike the finish check this is not cache-only: the common cache is built
 * from `default_cards` (English only), so a missing `ja` object proves nothing.
 * The check is layered:
 *
 * 1. `en` always passes — it is the bare-line default every printing's default
 *    object satisfies.
 * 2. The cached printing list can prove *availability* (it holds an object in
 *    that language) regardless of which bulk built it.
 * 3. It can prove *unavailability* only when it is complete AND was built from
 *    the `all_cards` bulk — then the absence is a fact, refused without a fetch.
 * 4. Otherwise the printing is verified on demand via
 *    `GET /cards/{set}/{cn}/{lang}`, exactly the pin-verification pattern: a
 *    404 is the user's mistake (usage error), while an unreachable API skips
 *    the check with `verify-failed` rather than fabricating a refusal.
 */
export async function ensureLanguageAvailableForEntry(
  cardName: string,
  entry: PrintingFields,
  language: CardLanguage,
): Promise<LanguageCheckResult> {
  if (displayLanguage(language) === 'en') return { checked: true }
  if (!hasSpecificPrinting(entry)) return { checked: false, reason: 'no-printing' }

  const result = await cachedPrintings(cardName)
  const available = printingLanguages(result.printings, entry.set, entry.collectorNumber)
  if (available.includes(language)) return { checked: true }

  const printingLabel = `${entry.set.toUpperCase()}:${entry.collectorNumber}`
  if (
    printingsAreComplete(result) &&
    available.length > 0 &&
    (await readRecordedCardBulkType()) === 'all_cards'
  ) {
    const params: MessageParams<'cli.cardOps.languageUnavailable'> = {
      printing: printingLabel,
      name: cardName,
      language: languageDisplayName(language),
      code: language,
      available: formatLanguageList(available),
    }
    throw new CardCommandError(
      'usage_error',
      t('cli.cardOps.languageUnavailable', params),
      ExitCode.UsageError,
      { availableLanguages: available },
      { key: 'cli.cardOps.languageUnavailable', params },
    )
  }

  let printing: ScryfallCard | null
  try {
    printing = await fetchPrintingByCollectorNumber(entry.set, entry.collectorNumber, language)
  } catch (err) {
    return { checked: false, reason: 'verify-failed', detail: getErrorMessage(err) }
  }
  if (!printing) {
    throw localizedCommandError(
      'usage_error',
      ExitCode.UsageError,
      'cli.cardOps.noLanguageObject',
      {
        language: languageDisplayName(language),
        code: language,
        printing: printingLabel,
        name: cardName,
      },
    )
  }
  ensureSameCard(printing, cardName, printingLabel)
  return { checked: true }
}

/**
 * Reject a valid finish the chosen printing is not offered in. `carriedOver`
 * marks a finish that came from the entry rather than a `--finish` flag, so the
 * refusal says how to resolve it instead of blaming a flag the user never
 * passed.
 */
export function ensureFinishAvailable(
  cardName: string,
  printing: ScryfallCard,
  finish: Finish,
  carriedOver = false,
): void {
  const match = matchFinishPin(cardName, printing, finish)
  if (!match.ok) {
    const message = carriedOver
      ? t('cli.cardOps.finishCarriedOver', { reason: match.message, finish })
      : match.message
    throw new CardCommandError(
      'usage_error',
      message,
      ExitCode.UsageError,
      { availableFinishes: match.available },
      carriedOver
        ? { key: 'cli.cardOps.finishCarriedOver', params: { reason: match.message, finish } }
        : undefined,
    )
  }
}
