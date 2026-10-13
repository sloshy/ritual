import type { DeckData, DeckSection } from '../list/deck'
import type { HttpClient } from '../util/interfaces'
import { defaultHttpClient } from '../util/http'
import { syncMessage, SyncMessageError } from '../sync/message'
import { throwFetchFailure } from './fetch-failure'

export async function fetchMtgGoldfishDeck(
  url: string,
  http: HttpClient = defaultHttpClient,
): Promise<DeckData> {
  const response = await http.fetch(url)
  if (!response.ok) {
    throwFetchFailure(response, 'domain.import.url.mtgGoldfishPageFailed')
  }
  const html = await response.text()

  // Extract deck ID from the download link, which serves as the canonical ID.
  const downloadMatch = html.match(/href="\/deck\/download\/(\d+)"/)
  if (!downloadMatch || !downloadMatch[1]) {
    throw new SyncMessageError(syncMessage('domain.import.url.mtgGoldfishNoDownloadLink'))
  }
  const deckId = downloadMatch[1]
  const downloadUrl = `https://www.mtggoldfish.com/deck/download/${deckId}`

  // Attempt to extract title from h1 tag or fallback to page title.
  // i18n-exempt: a fallback deck name, written into the list file as its title and file name — workspace data, the same in every locale
  let name = 'MTGGoldfish Deck'
  const titleMatch = html.match(/<h1[^>]*>(.*?)<\/h1>/s)
  if (titleMatch && titleMatch[1]) {
    // Clean up HTML tags in title if any
    name = titleMatch[1].replace(/<[^>]+>/g, '').trim()
    // Remove " by Author" if present, keeping everything before the last " by "
    // i18n-exempt: MTGGoldfish's own page markup, which is English
    const parts = name.split(' by ')
    if (parts.length > 1) {
      // i18n-exempt: MTGGoldfish's own page markup, which is English
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
    throwFetchFailure(listResponse, 'domain.import.url.mtgGoldfishListFailed')
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
