import { ArchidektClient } from '../clients/ArchidektClient'
import { fetchMtgGoldfishDeck } from './mtggoldfish'
import { fetchMoxfieldDeck } from './moxfield-lib'
import { type DeckData } from '../types'

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

/**
 * Resolve the Moxfield user-agent from an explicit value (e.g. a CLI flag),
 * falling back to the `MOXFIELD_USER_AGENT` environment variable. Trims and
 * rejects empty strings.
 */
export function resolveMoxfieldUserAgent(
  cliOptionValue?: string,
  envValue: string | undefined = process.env.MOXFIELD_USER_AGENT,
): string | undefined {
  const trimmedCliOption = cliOptionValue?.trim()
  if (trimmedCliOption) {
    return trimmedCliOption
  }

  const trimmedEnvValue = envValue?.trim()
  if (trimmedEnvValue) {
    return trimmedEnvValue
  }

  return undefined
}

/** Run `fn` with `MOXFIELD_USER_AGENT` temporarily set, restoring it afterward. */
async function withMoxfieldUserAgent<T>(userAgent: string, run: () => Promise<T>): Promise<T> {
  const previousUserAgent = process.env.MOXFIELD_USER_AGENT
  process.env.MOXFIELD_USER_AGENT = userAgent

  try {
    return await run()
  } finally {
    if (previousUserAgent === undefined) {
      delete process.env.MOXFIELD_USER_AGENT
    } else {
      process.env.MOXFIELD_USER_AGENT = previousUserAgent
    }
  }
}

export type FetchDeckFromUrlOptions = {
  /** Explicit Moxfield user-agent (e.g. a CLI flag); falls back to the env var. */
  moxfieldUserAgent?: string
  /** Called with a human-readable progress message before each fetch. */
  onProgress?: (message: string) => void
}

/**
 * Fetch a deck from a supported URL (Archidekt, Moxfield, MTGGoldfish).
 *
 * Returns the parsed {@link DeckData} on success, or a string error message for
 * recoverable problems (unsupported URL, missing Moxfield user-agent). Network
 * or parse failures from the underlying clients are thrown.
 */
export async function fetchDeckFromUrl(
  url: string,
  options: FetchDeckFromUrlOptions = {},
): Promise<DeckData | string> {
  const match = matchDeckUrl(url)
  if (!match) {
    return 'URL not supported. Use Archidekt, Moxfield, or MTGGoldfish URLs.'
  }

  switch (match.service) {
    case 'archidekt':
      options.onProgress?.(`Fetching deck ID ${match.deckId} from Archidekt...`)
      return new ArchidektClient().fetchDeck(match.deckId)
    case 'moxfield': {
      const userAgent = resolveMoxfieldUserAgent(options.moxfieldUserAgent)
      if (!userAgent) {
        return 'Moxfield imports require a unique Moxfield-approved user agent string. Set MOXFIELD_USER_AGENT or pass --moxfield-user-agent <agent>. Contact Moxfield support if you need one.'
      }
      options.onProgress?.(`Fetching deck ID ${match.deckId} from Moxfield...`)
      return withMoxfieldUserAgent(userAgent, () => fetchMoxfieldDeck(match.deckId))
    }
    case 'mtggoldfish':
      options.onProgress?.('Fetching deck from MTGGoldfish...')
      return fetchMtgGoldfishDeck(match.url)
  }
}
