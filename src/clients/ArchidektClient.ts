import { defaultHttpClient } from '../http'
import type { HttpClient } from '../interfaces'
import type { DeckData } from '../types'
import { throwHttpError } from '../errors'
import {
  type ArchidektDeckResponse,
  type ArchidektDeckSimple,
  type ArchidektRawDeckResponse,
  type ArchidektCardSearchResult,
  type ModifyCardEntry,
  parseArchidektDeckResponse,
} from '../importers/archidekt-types'

export { type ArchidektDeckSimple, getArchidektFormat } from '../importers/archidekt-types'

interface ArchidektListResponse<T> {
  results: T[]
  count: number
}

interface ArchidektSearchResponse {
  results: ArchidektCardSearchResult[]
}

export class ArchidektClient {
  private httpClient: HttpClient = defaultHttpClient

  constructor(httpClient?: HttpClient) {
    if (httpClient) {
      this.httpClient = httpClient
    }
  }

  private authHeaders(token: string): Record<string, string> {
    return { Authorization: `JWT ${token}` }
  }

  private async fetchDeckResponse(deckId: string, token?: string): Promise<Response> {
    const url = `https://archidekt.com/api/decks/${deckId}/`
    const headers: Record<string, string> = {}

    if (token) {
      Object.assign(headers, this.authHeaders(token))
    }

    const response = await this.httpClient.fetch(url, { headers })

    if (!response.ok) {
      throwHttpError(response, `Failed to fetch deck ${deckId}`)
    }

    return response
  }

  async fetchPublicDecks(username: string): Promise<ArchidektDeckSimple[]> {
    const url = `https://archidekt.com/api/decks/v3/?ownerUsername=${username}`
    const response = await this.httpClient.fetch(url)

    if (!response.ok) {
      throwHttpError(response, 'Failed to fetch public decks')
    }

    const data = (await response.json()) as ArchidektListResponse<ArchidektDeckSimple>
    return data.results || []
  }

  async fetchOwnDecks(token: string): Promise<ArchidektDeckSimple[]> {
    const url = 'https://archidekt.com/api/decks/curated/self/'
    const response = await this.httpClient.fetch(url, {
      headers: this.authHeaders(token),
    })

    if (!response.ok) {
      throwHttpError(response, 'Failed to fetch own decks')
    }

    const data = (await response.json()) as ArchidektListResponse<ArchidektDeckSimple>
    return data.results || []
  }

  async fetchDeck(deckId: string, token?: string): Promise<DeckData> {
    const response = await this.fetchDeckResponse(deckId, token)
    const json = (await response.json()) as ArchidektDeckResponse
    return parseArchidektDeckResponse(json, deckId)
  }

  async fetchDeckRaw(deckId: string, token?: string): Promise<ArchidektRawDeckResponse> {
    const response = await this.fetchDeckResponse(deckId, token)
    return (await response.json()) as ArchidektRawDeckResponse
  }

  async searchCards(
    cardName: string,
    set: string | undefined,
    token: string,
  ): Promise<ArchidektCardSearchResult | string> {
    const searchUrl = new URL('https://archidekt.com/api/cards/v2/')
    searchUrl.searchParams.set('nameSearch', cardName)
    if (set) {
      searchUrl.searchParams.set('editionSearch', set.toLowerCase())
    }
    searchUrl.searchParams.set('pageSize', '50')

    const response = await this.httpClient.fetch(searchUrl.toString(), {
      headers: this.authHeaders(token),
    })

    if (!response.ok) {
      return `Card search failed (${response.status}): ${cardName}`
    }

    const data = (await response.json()) as ArchidektSearchResponse

    const match = data.results.find(
      (r) => r.oracleCard.name.toLowerCase() === cardName.toLowerCase(),
    )
    if (!match) {
      return `Card not found on Archidekt: ${cardName}${set ? ` (${set.toUpperCase()})` : ''}`
    }
    return match
  }

  async modifyCards(deckId: string, entries: ModifyCardEntry[], token: string): Promise<void> {
    const url = `https://archidekt.com/api/decks/${deckId}/modifyCards/v2/`
    const response = await this.httpClient.fetch(url, {
      method: 'PATCH',
      headers: {
        ...this.authHeaders(token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cards: entries }),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`modifyCards failed (${response.status}): ${body}`)
    }
  }
}
