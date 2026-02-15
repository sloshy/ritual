import { describe, expect, test, mock } from 'bun:test'
import { fetchMtgGoldfishDeck } from '../../../src/importers/mtggoldfish'
import { type HttpClient } from '../../../src/interfaces'

describe('MTGGoldfish Importer', () => {
  test('fetches and parses a deck correctly', async () => {
    const pageHtml = `
      <html>
        <head><title>Test Deck - Magic: the Gathering</title></head>
        <body>
          <h1>Test Deck by Author</h1>
          <a href="/deck/download/12345">Download</a>
        </body>
      </html>
    `

    const deckText = `
    1 Sol Ring
    10 Forest

    1 Sideboard Card
    `

    const mockFetch = mock(async (url: string) => {
      if (url.includes('download')) {
        return {
          ok: true,
          text: async () => deckText,
        }
      }
      return {
        ok: true,
        text: async () => pageHtml,
      }
    })

    const mockHttp: HttpClient = {
      fetch: mockFetch as any,
    }

    const deck = await fetchMtgGoldfishDeck('https://www.mtggoldfish.com/deck/12345', mockHttp)

    expect(deck.name).toBe('Test Deck')
    expect(deck.sourceId).toBe('12345')
    expect(deck.sections).toHaveLength(2)

    const main = deck.sections.find((s) => s.name === 'Main')
    expect(main).toBeDefined()
    expect(main?.cards).toHaveLength(2)
    expect(main?.cards[0]?.name).toBe('Sol Ring')

    const sideboard = deck.sections.find((s) => s.name === 'Sideboard')
    expect(sideboard).toBeDefined()
    expect(sideboard?.cards[0]?.name).toBe('Sideboard Card')
  })

  test('handles deck names with "by" in them correctly', async () => {
    const pageHtml = `
      <html>
        <body>
          <h1>Stand by Me by Author</h1>
          <a href="/deck/download/67890">Download</a>
        </body>
      </html>
    `

    const mockFetch = mock(async (url: string) => {
      return {
        ok: true,
        text: async () => (url.includes('download') ? '1 Sol Ring' : pageHtml),
      }
    })

    const mockHttp: HttpClient = {
      fetch: mockFetch as any,
    }

    const deck = await fetchMtgGoldfishDeck('https://www.mtggoldfish.com/deck/67890', mockHttp)
    expect(deck.name).toBe('Stand by Me')
  })
})
