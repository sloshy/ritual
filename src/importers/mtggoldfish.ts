import { type DeckData, type DeckSection } from '../types'
import { type HttpClient } from '../interfaces'
import { defaultHttpClient } from '../http'

export async function fetchMtgGoldfishDeck(
  url: string,
  http: HttpClient = defaultHttpClient,
): Promise<DeckData> {
  const response = await http.fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch MTGGoldfish page: ${response.status}`)
  }
  const html = await response.text()

  // Extract deck ID from the download link, which serves as the canonical ID.
  const downloadMatch = html.match(/href="\/deck\/download\/(\d+)"/)
  if (!downloadMatch || !downloadMatch[1]) {
    throw new Error('Could not find deck download link on MTGGoldfish page')
  }
  const deckId = downloadMatch[1]
  const downloadUrl = `https://www.mtggoldfish.com/deck/download/${deckId}`

  // Attempt to extract title from h1 tag or fallback to page title.
  let name = 'MTGGoldfish Deck'
  const titleMatch = html.match(/<h1[^>]*>(.*?)<\/h1>/s)
  if (titleMatch && titleMatch[1]) {
    // Clean up HTML tags in title if any
    name = titleMatch[1].replace(/<[^>]+>/g, '').trim()
    // Remove " by Author" if present, keeping everything before the last " by "
    const parts = name.split(' by ')
    if (parts.length > 1) {
      name = parts.slice(0, -1).join(' by ').trim()
    }
  } else {
    // Fallback to title tag
    const pageTitle = html.match(/<title>(.*?)<\/title>/)
    if (pageTitle && pageTitle[1]) {
      name = pageTitle[1].replace(' - Magic: the Gathering', '').trim()
    }
  }

  // Fetch text list
  const listResponse = await http.fetch(downloadUrl)
  if (!listResponse.ok) {
    throw new Error(`Failed to fetch deck list text: ${listResponse.status}`)
  }
  const listText = await listResponse.text()

  const sections: DeckSection[] = []

  // Normalize line endings and split by double newline to distinguish Main and Sideboard sections.
  const normalized = listText.replace(/\r\n/g, '\n')
  const blocks = normalized.split(/\n\s*\n/)

  const mainBlock = blocks[0]
  if (mainBlock && mainBlock.trim()) {
    sections.push({
      name: 'Main',
      cards: parseCardBlock(mainBlock),
    })
  }

  const sideboardBlock = blocks[1]
  if (sideboardBlock && sideboardBlock.trim()) {
    sections.push({
      name: 'Sideboard',
      cards: parseCardBlock(sideboardBlock),
    })
  }

  return {
    name,
    sourceId: deckId,
    sourceUrl: url,
    sections,
  }
}

function parseCardBlock(text: string) {
  const lines = text.split('\n')
  const cards = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // Format: "4 Card Name"
    const match = trimmed.match(/^(\d+)\s+(.*)$/)
    if (match && match[1] && match[2]) {
      cards.push({
        quantity: parseInt(match[1], 10),
        name: match[2].trim(),
      })
    }
  }
  return cards
}
