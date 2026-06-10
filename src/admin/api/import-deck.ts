import path from 'node:path'
import { parseDeckText } from '../../importers/text-file'
import { fetchDeckFromUrl } from '../../importers/url-dispatch'
import { saveDeck } from '../../commands/import'
import { sanitizeDeckFileName } from '../../utils'
import { autoCommitAndPush } from './save-helpers'
import { apiHandler } from '../utils'
import type { DeckData } from '../../types'
import { getDecksDir } from '../../ritual-config'

/**
 * Import request from the admin site. Either fetch a deck from a supported URL,
 * or parse decklist text supplied directly (pasted into the UI or read from a
 * file the browser uploaded).
 */
type ImportDeckRequest =
  | { mode: 'url'; url: string; overwrite?: boolean }
  | { mode: 'text'; content: string; name?: string; overwrite?: boolean }

interface ImportDeckResponse {
  success: boolean
  message: string
  deckName?: string
}

function isImportDeckRequest(value: unknown): value is ImportDeckRequest {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  if (record.mode === 'url') return typeof record.url === 'string'
  if (record.mode === 'text') return typeof record.content === 'string'
  return false
}

function badRequest(message: string): Response {
  const resp: ImportDeckResponse = { success: false, message }
  return Response.json(resp, { status: 400 })
}

export function handleImportDeck(req: Request): Promise<Response> {
  return apiHandler(async () => {
    const body: unknown = await req.json()
    if (!isImportDeckRequest(body)) {
      return badRequest('Invalid request: expected mode "url" (with url) or "text" (with content)')
    }
    const overwrite = body.overwrite ?? false

    let deckData: DeckData

    if (body.mode === 'url') {
      const url = body.url.trim()
      if (!url) return badRequest('url is required')
      const result = await fetchDeckFromUrl(url)
      if (typeof result === 'string') return badRequest(result)
      deckData = result
    } else {
      const content = body.content.trim()
      if (!content) return badRequest('content is required')
      const fallbackName = body.name?.trim() || 'Imported Deck'
      deckData = parseDeckText(content, fallbackName)
      if (deckData.sections.length === 0) {
        return badRequest('No valid card lines found in the provided text.')
      }
    }

    const decksDir = getDecksDir()
    await saveDeck(deckData, decksDir, {
      forceOverwrite: overwrite,
      nonInteractive: true,
      assumeYes: overwrite,
    })

    const safeName = sanitizeDeckFileName(deckData.name)
    const filePath = path.join(decksDir, `${safeName}.md`)

    await autoCommitAndPush(decksDir, [filePath], `Import deck: ${deckData.name}`)

    const resp: ImportDeckResponse = {
      success: true,
      message: `Successfully imported '${deckData.name}'`,
      deckName: deckData.name,
    }
    return Response.json(resp)
  })
}
