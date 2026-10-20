import { ArchidektClient } from '../clients/ArchidektClient'
import { fetchMtgGoldfishDeck } from './mtggoldfish'
import { fetchMoxfieldDeck } from './moxfield-lib'
import { aggregateQuantities } from '../card/card-line'
import { displayLanguage } from '../card/card-language'
import type { Card } from '../card/card'
import type { DeckData, DeckSection, ImportedDeck } from '../list/deck'
import { syncMessage, type SyncMessage } from '../sync/message'
import { resolveStringOverride } from '../config/env-override'
import { ENV_VAR, FLAG, flagValue } from '../util/cli-tokens'

/**
 * Whether any card in the deck states a printing or finish — what a URL import
 * has to ask about before keeping. Tests exactly the fields
 * {@link stripDeckPrintings} removes, the way `serializeCardLine` tests them:
 * an explicit `nonfoil` is never written to a line, so it is nothing to decide
 * about, and a deck of bare names (MTGGoldfish, or a service entry with no
 * edition data) has nothing to decide at all.
 */
export function deckStatesPrintings(deck: DeckData): boolean {
  return deck.sections.some((section) =>
    section.cards.some(
      (card) =>
        card.set !== undefined ||
        card.collectorNumber !== undefined ||
        (card.finish !== undefined && card.finish !== 'nonfoil'),
    ),
  )
}

/**
 * Identity of a printing-less card line: everything the stripped line still
 * carries besides its quantity. Language folds a missing value to `en`, the
 * same as {@link variantKey}.
 */
function strippedKey(card: Card): string {
  return `${card.name.toLowerCase()}|${card.condition ?? ''}|${displayLanguage(card.language)}|${card.note ?? ''}`
}

/**
 * A copy of the deck with every card's printing and finish removed — what a
 * URL import writes when the exact printings were declined. Names, quantities,
 * condition, language, and notes survive. Cards distinguished only by their
 * printing collapse into one line with their quantities summed — a foil
 * `(LTC:284)` and a nonfoil `(C21:240)` Sol Ring would otherwise become two
 * byte-identical lines, which is the same re-merge `buildDeckMarkdown` does on
 * the CSV path.
 */
export function stripDeckPrintings(deck: DeckData): DeckData {
  const stripCard = (card: Card): Card => {
    const { set: _set, collectorNumber: _collectorNumber, finish: _finish, ...rest } = card
    return rest
  }
  const stripSection = (section: DeckSection): DeckSection => ({
    ...section,
    cards: aggregateQuantities(
      section.cards.map(stripCard),
      strippedKey,
      (card) => card.quantity,
    ).map(({ entry, quantity }): Card => ({ ...entry, quantity })),
  })
  return { ...deck, sections: deck.sections.map(stripSection) }
}

/**
 * Identify which supported deck service a URL points to and extract the bits
 * needed to fetch it. Returns `undefined` for unsupported URLs.
 */
export type DeckUrlMatch =
  | { service: 'archidekt'; deckId: string }
  | { service: 'moxfield'; deckId: string }
  | { service: 'mtggoldfish'; url: string }

export function matchDeckUrl(url: string): DeckUrlMatch | undefined {
  const archidektMatch = url.match(/archidekt\.com\/decks\/(\d+)/)
  if (archidektMatch?.[1]) {
    return { service: 'archidekt', deckId: archidektMatch[1] }
  }
  const moxfieldMatch = url.match(/moxfield\.com\/decks\/([a-zA-Z0-9_-]+)/)
  if (moxfieldMatch?.[1]) {
    return { service: 'moxfield', deckId: moxfieldMatch[1] }
  }
  if (url.includes('mtggoldfish.com')) {
    return { service: 'mtggoldfish', url }
  }
  return undefined
}

/** Matches an explicit URL scheme prefix, e.g. `https://`, `http://`, `ftp://`. */
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i

/** Hostnames of the deck services matchDeckUrl recognizes, for scheme-less detection. */
const SERVICE_HOSTNAME_PATTERN = /(^|\.)(archidekt|moxfield|mtggoldfish)\.com$/i

/**
 * Decide whether an `import <source>` argument is URL-shaped, and if so return
 * the URL to dispatch (normalizing a missing scheme to `https://`). Returns
 * `undefined` when the source should be treated as a local file path.
 *
 * Anything with an explicit scheme is URL-shaped even if no importer supports
 * it — that routes it to the unsupported-URL error instead of a file lookup.
 * Scheme-less sources are only URL-shaped when their hostname is a supported
 * deck service (e.g. `archidekt.com/decks/123`), so file names that merely
 * contain a service domain (`my-mtggoldfish.com-export.txt`) stay file paths.
 */
export function resolveImportSourceUrl(source: string): string | undefined {
  if (SCHEME_PATTERN.test(source)) {
    return source
  }

  const candidate = `https://${source}`
  let hostname: string
  try {
    hostname = new URL(candidate).hostname
  } catch {
    return undefined
  }

  if (SERVICE_HOSTNAME_PATTERN.test(hostname) && matchDeckUrl(candidate) !== undefined) {
    return candidate
  }
  return undefined
}

/**
 * Resolve the Moxfield user-agent from an explicit value (e.g. a CLI flag),
 * falling back to the `MOXFIELD_USER_AGENT` environment variable. Trims and
 * rejects empty strings.
 */
export function resolveMoxfieldUserAgent(
  cliOptionValue?: string,
  envValue: string | undefined = process.env[ENV_VAR.moxfieldUserAgent],
): string | undefined {
  return resolveStringOverride(cliOptionValue, envValue)
}

/** Run `run` with `MOXFIELD_USER_AGENT` temporarily set, restoring it afterward. */
export async function withMoxfieldUserAgent<T>(
  userAgent: string,
  run: () => Promise<T>,
): Promise<T> {
  const previousUserAgent = process.env[ENV_VAR.moxfieldUserAgent]
  process.env[ENV_VAR.moxfieldUserAgent] = userAgent

  try {
    return await run()
  } finally {
    if (previousUserAgent === undefined) {
      delete process.env[ENV_VAR.moxfieldUserAgent]
    } else {
      process.env[ENV_VAR.moxfieldUserAgent] = previousUserAgent
    }
  }
}

export type FetchDeckFromUrlOptions = {
  /** Explicit Moxfield user-agent (e.g. a CLI flag); falls back to the env var. */
  moxfieldUserAgent?: string
  /** Called with a progress message (English plus key) before each fetch. */
  onProgress?: (message: SyncMessage) => void
}

/**
 * Fetch a deck from a supported URL (Archidekt, Moxfield, MTGGoldfish).
 *
 * Returns the parsed deck and the categories the service states for it (see
 * {@link ImportedDeck}) on success, or the refusal (English plus key — tell the
 * two apart with `isSyncMessage`) for recoverable problems (unsupported URL,
 * missing Moxfield user-agent). Network or parse failures from the underlying
 * clients are thrown.
 */
export async function fetchDeckFromUrl(
  url: string,
  options: FetchDeckFromUrlOptions = {},
): Promise<ImportedDeck | SyncMessage> {
  const match = matchDeckUrl(url)
  if (!match) return syncMessage('domain.import.url.unsupported')

  switch (match.service) {
    case 'archidekt':
      options.onProgress?.(syncMessage('domain.import.url.fetchingArchidekt', { id: match.deckId }))
      return new ArchidektClient().fetchImportedDeck(match.deckId)
    case 'moxfield': {
      const userAgent = resolveMoxfieldUserAgent(options.moxfieldUserAgent)
      if (!userAgent)
        return syncMessage('domain.import.url.moxfieldUserAgent', {
          envVar: ENV_VAR.moxfieldUserAgent,
          flag: flagValue(FLAG.moxfieldUserAgent, '<agent>'),
        })
      options.onProgress?.(syncMessage('domain.import.url.fetchingMoxfield', { id: match.deckId }))
      return withMoxfieldUserAgent(userAgent, () => fetchMoxfieldDeck(match.deckId))
    }
    case 'mtggoldfish':
      options.onProgress?.(syncMessage('domain.import.url.fetchingMtgGoldfish'))
      // MTGGoldfish has no notion of categories, so an import leaves them alone.
      return { deck: await fetchMtgGoldfishDeck(match.url) }
  }
}
