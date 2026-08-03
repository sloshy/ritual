import { IMPORT_TEXT_PARSE_OPTIONS, parseDeckText } from '../../importers/text-file'
import { fetchDeckFromUrl } from '../../importers/url-dispatch'
import { saveDeck } from '../../commands/import'
import { listFilePath } from '../../resolve-list'
import { autoCommitAndPush, badRequest, readJsonObjectBody } from './save-helpers'
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

/** `POST /api/import-deck` — the deck that was written. */
export interface ImportDeckResponse {
  success: true
  message: string
  /** Name of the imported deck, which is also its slug. */
  deckName: string
  /**
   * Parse warnings from a text import — one per skipped line or dropped empty
   * section, meaning content from the pasted text was NOT imported. Always
   * present; URL imports have nothing to parse and carry an empty array.
   */
  warnings: string[]
  /**
   * Non-fatal notices about text that WAS imported — a card name that still
   * carries a parenthesized printing token (an export dialect the parser does
   * not know), or a skipped Arena `About` line. Always present; empty for URL
   * imports.
   */
  advisories: string[]
}

function isImportDeckRequest(value: unknown): value is ImportDeckRequest {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  if (record.mode === 'url') return typeof record.url === 'string'
  if (record.mode === 'text') return typeof record.content === 'string'
  return false
}

export function handleImportDeck(req: Request): Promise<Response> {
  return apiHandler(async () => {
    const parsedBody = await readJsonObjectBody(req)
    if (!parsedBody.ok) return parsedBody.response
    const body: unknown = parsedBody.body
    if (!isImportDeckRequest(body)) {
      return badRequest('Invalid request: expected mode "url" (with url) or "text" (with content)')
    }
    const overwrite = body.overwrite ?? false

    let deckData: DeckData
    let warnings: string[] = []
    let advisories: string[] = []

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
      // Pasted text is an import surface, so it reads exactly what the CLI's
      // text path reads: the Arena/MTGO dialect (`4 Lightning Bolt (M10) 146`
      // becomes a printing, not a card name) and the inside of a ``` fence,
      // which is how a decklist pasted from Discord or GitHub arrives.
      const parsed = parseDeckText(content, fallbackName, undefined, IMPORT_TEXT_PARSE_OPTIONS)
      deckData = parsed.deck
      advisories = parsed.advisories
      // Skipped lines are content the import silently lost — the client must
      // be able to report them (the CLI's text path exits 1 on the same class).
      warnings = parsed.warnings
      if (deckData.sections.length === 0) {
        return badRequest('No valid card lines found in the provided text.')
      }
    }

    const decksDir = getDecksDir()
    await saveDeck(deckData, decksDir, {
      forceOverwrite: overwrite,
      // There is no terminal behind an API request; a conflict must throw
      // instead of trying to prompt.
      noPrompts: true,
      assumeYes: overwrite,
    })

    // saveDeck has already rejected a name with no usable characters, so the path
    // it wrote to is the one this resolves to.
    const filePath = listFilePath('deck', deckData.name)
    if (filePath === null) return badRequest(`Deck name '${deckData.name}' cannot be a file name`)

    await autoCommitAndPush(decksDir, [filePath], `Import deck: ${deckData.name}`)

    // The admin UI surfaces only `message`, so a lossy text import says so
    // there too; API clients get the individual lines in `warnings`.
    const skippedNote =
      warnings.length > 0
        ? ` — ${warnings.length} line(s) could not be parsed and were skipped`
        : ''
    // Advisories are not loss, but they mean a line was probably misread, so the
    // UI's one-line message mentions them too rather than only the API clients.
    const advisoryNote =
      advisories.length > 0 ? ` — ${advisories.length} line(s) may not have been understood` : ''
    const resp: ImportDeckResponse = {
      success: true,
      message: `Successfully imported '${deckData.name}'${skippedNote}${advisoryNote}`,
      deckName: deckData.name,
      warnings,
      advisories,
    }
    return Response.json(resp)
  })
}
