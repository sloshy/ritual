import { getCardPrintings } from '../scryfall'
import type { ScryfallCard } from '../scryfall/types'
import { printingFinishes, type Finish } from './finish-condition'
import { t } from '../i18n/t'
import { findPrinting, hasSpecificPrinting } from './card-printing'
import { storedLanguage, type CardLanguage } from './card-language'
import { getDefaultLanguage } from '../config/ritual-config'

/**
 * Pure printing-pin resolution: matching a strict `SET:CN` / finish pin against
 * a card's known printings, looking up the cached printing an entry pins, and
 * the language a freshly added entry records.
 */

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

/** A printing surfaced in a strict-pin error, as a `set`/`collectorNumber` pair. */
export type AvailablePrinting = { set: string; collectorNumber: string }

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
