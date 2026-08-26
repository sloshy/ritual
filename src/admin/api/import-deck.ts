import { IMPORT_TEXT_PARSE_OPTIONS, parseDeckText } from '../../importers/text-file'
import { fetchDeckFromUrl, stripDeckPrintings } from '../../importers/url-dispatch'
import { saveDeck } from '../../commands/import'
import { listFilePath } from '../../list/resolve-list'
import { autoCommitAndPush, badRequest, readJsonObjectBody } from './save-helpers'
import { apiHandler } from '../utils'
import type { ApiMessage } from './result'
import type { DeckData } from '../../list/deck'
import { getDecksDir } from '../../config/ritual-config'
import { MAX_LIST_BODY_SIZE } from '../validation'

/**
 * Import request from the admin site. Either fetch a deck from a supported URL,
 * or parse decklist text supplied directly (pasted into the UI or read from a
 * file the browser uploaded). Exported so the Import Deck page builds its body
 * against this contract — `syncPrintings` must be present in exactly one mode,
 * and the discriminated union makes getting that wrong a compile error there.
 */
export type ImportDeckRequest =
  | {
      mode: 'url'
      url: string
      overwrite?: boolean
      /**
       * Keep the exact printings — set, collector number, finish — the source
       * lists (`true`), or import bare card names (`false`). Required: the CLI
       * asks interactively when neither `--sync-printings` flag is given, and
       * there is nobody to ask over HTTP, so the caller must decide.
       */
      syncPrintings: boolean
    }
  | { mode: 'text'; content: string; name?: string; overwrite?: boolean }

/** `POST /api/import-deck` — the deck that was written. */
export interface ImportDeckResponse extends ApiMessage {
  success: true
  /** Name of the imported deck, which is also its slug. */
  deckName: string
  /**
   * Parse warnings from a text import — one per skipped line or dropped empty
   * section, meaning content from the pasted text was NOT imported. An empty
   * *extras* section is an advisory instead: dropping it loses nothing. Always
   * present; URL imports have nothing to parse and carry an empty array.
   */
  warnings: string[]
  /**
   * Non-fatal notices about text that WAS read — a card name that still carries
   * a parenthesized printing token (an export dialect the parser does not
   * know), a skipped Arena `About` line, or an empty extras section the write
   * drops. Always present; empty for URL imports.
   */
  advisories: string[]
  /**
   * Whether the written deck kept the exact printings the source listed.
   * `true` for a text import, whose printings are the pasted lines' own —
   * only a URL import can decline them.
   */
  syncPrintings: boolean
}

const MODE_REQUIRED = 'Invalid request: expected mode "url" (with url) or "text" (with content)'

/**
 * Parse a request body into an {@link ImportDeckRequest}, or return why it is
 * not one. A parser rather than a validator-plus-cast: every field the
 * handler reads is checked here, so the shape and the checks cannot drift.
 */
function parseImportDeckRequest(record: Record<string, unknown>): ImportDeckRequest | string {
  const overwrite = record.overwrite
  if (overwrite !== undefined && typeof overwrite !== 'boolean') {
    return 'overwrite must be a boolean'
  }
  if (record.mode === 'url') {
    if (typeof record.url !== 'string') return 'url is required for mode "url"'
    if (typeof record.syncPrintings !== 'boolean') {
      // The CLI's stand-in for this field is an interactive prompt; over HTTP
      // the caller must decide, so an absent or mistyped value is refused
      // rather than silently defaulted.
      return (
        'syncPrintings is required for a URL import and must be a boolean: true keeps the ' +
        'exact printings (set, collector number, finish) the source lists, false imports ' +
        'bare card names'
      )
    }
    return { mode: 'url', url: record.url, overwrite, syncPrintings: record.syncPrintings }
  }
  if (record.mode === 'text') {
    if (typeof record.content !== 'string') return 'content is required for mode "text"'
    if (record.syncPrintings !== undefined) {
      return 'syncPrintings only applies to URL imports; pasted text states its own printings'
    }
    if (record.name !== undefined && typeof record.name !== 'string') {
      return 'name must be a string'
    }
    return { mode: 'text', content: record.content, name: record.name, overwrite }
  }
  return MODE_REQUIRED
}

export function handleImportDeck(req: Request): Promise<Response> {
  return apiHandler(async () => {
    const parsedBody = await readJsonObjectBody(req, MAX_LIST_BODY_SIZE)
    if (!parsedBody.ok) return parsedBody.response
    const request = parseImportDeckRequest(parsedBody.body)
    if (typeof request === 'string') return badRequest(request)
    const overwrite = request.overwrite ?? false

    let deckData: DeckData
    let warnings: string[] = []
    let advisories: string[] = []

    if (request.mode === 'url') {
      const url = request.url.trim()
      if (!url) return badRequest('url is required')
      const result = await fetchDeckFromUrl(url)
      if (typeof result === 'string') return badRequest(result)
      deckData = request.syncPrintings ? result : stripDeckPrintings(result)
    } else {
      const content = request.content.trim()
      if (!content) return badRequest('content is required')
      const fallbackName = request.name?.trim() || 'Imported Deck'
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
      syncPrintings: request.mode === 'url' ? request.syncPrintings : true,
    }
    return Response.json(resp)
  })
}
