import { type HttpClient } from '../interfaces'
import { defaultHttpClient } from '../http'
import { throwHttpError } from '../errors'

const MOXFIELD_BASE_URL = 'https://api2.moxfield.com'

type MoxfieldCardEntry = {
  quantity: number
  card: { name: string }
}

type MoxfieldBoard = {
  cards: Record<string, MoxfieldCardEntry>
}

export type MoxfieldDeckResponse = {
  id?: string
  publicId: string
  name: string
  description: string
  /** Moxfield's format slug, e.g. `commander`, `duelCommander`, `premodern`. */
  format?: string
  hasPrimer?: boolean | null
  /** Primer content if included inline in the deck response. */
  primer?: string
  boards: Record<string, MoxfieldBoard>
}

export type MoxfieldPrimerResponse = {
  content: string
}

export class MoxfieldClient {
  private readonly http: HttpClient

  constructor(http: HttpClient = defaultHttpClient) {
    this.http = http
  }

  async fetchDeck(publicId: string): Promise<MoxfieldDeckResponse> {
    const url = `${MOXFIELD_BASE_URL}/v3/decks/all/${encodeURIComponent(publicId)}`
    const response = await this.http.fetch(url)
    if (!response.ok) {
      throwHttpError(response, 'Failed to fetch Moxfield deck')
    }
    return response.json() as Promise<MoxfieldDeckResponse>
  }

  /** Returns null if the deck has no primer or the endpoint is unavailable. */
  async fetchPrimer(deckId: string | undefined): Promise<MoxfieldPrimerResponse | null> {
    if (!deckId) return null
    const url = `${MOXFIELD_BASE_URL}/v1/decks/${encodeURIComponent(deckId)}/primer`
    const response = await this.http.fetch(url)
    if (response.status === 404 || response.status === 401 || response.status === 403) return null
    if (!response.ok) {
      throwHttpError(response, 'Failed to fetch Moxfield primer')
    }
    return response.json() as Promise<MoxfieldPrimerResponse>
  }
}
