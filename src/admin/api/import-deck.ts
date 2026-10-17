import {
  IMPORT_TEXT_PARSE_OPTIONS,
  importParseAdvisories,
  importParseWarnings,
  parseDeckText,
  type DeckParseNotice,
  type ImportParseWarning,
} from '../../importers/text-file'
import type { CardLabel } from '../../card/card-labels'
import { fetchDeckFromUrl, stripDeckPrintings } from '../../importers/url-dispatch'
import { ArchidektRequestError } from '../../auth/archidekt-reply'
import type { CardCategoryEntry } from '../../list/card-categories-record'
import { importCategoryAdvisories } from '../../importers/import-categories'
import { saveDeck } from '../../importers/save-list'
import { autoCommitAndPush } from './save-helpers'
import { badRequest, nestedRefusal, readJsonObjectBody } from '../../api/http'
import { apiHandler } from '../utils'
import { apiMessage, apiText, isApiMessage, type ApiMessage } from '../../api/result'
import {
  isSyncMessage,
  syncList,
  syncMessage,
  syncRef,
  type SyncMessage,
  type SyncMessageRef,
} from '../../sync/message'
import type { DeckData, ImportedDeck } from '../../list/deck'
import { getDecksDir } from '../../config/ritual-config'
import { MAX_UPLOAD_BODY_SIZE } from '../validation'

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
export interface ImportDeckResponse extends SyncMessage {
  success: true
  /** Name of the imported deck, which is also its slug. */
  deckName: string
  /**
   * Parse warnings from a text import — one per skipped line or dropped empty
   * section, meaning content from the pasted text was NOT imported. An empty
   * *extras* section is an advisory instead: dropping it loses nothing. Always
   * present; URL imports have nothing to parse and carry an empty array. Each
   * is a message: English `message`, plus `messageKey` / `messageParams` when
   * the text has a catalog entry. A line whose card WAS imported, only without
   * the labels it carried, is marked `labelsDropped: true`.
   */
  warnings: ImportParseWarning[]
  /**
   * Non-fatal notices about text that WAS read — a card name that still carries
   * a parenthesized printing token (an export dialect the parser does not
   * know), a skipped Arena `About` line, or an empty extras section the write
   * drops — and, for a URL import, what became of the source's categories.
   * Always present. Messages, like `warnings`.
   */
  advisories: SyncMessage[]
  /**
   * Whether the written deck kept the exact printings the source listed.
   * `true` for a text import, whose printings are the pasted lines' own —
   * only a URL import can decline them.
   */
  syncPrintings: boolean
}

/**
 * Parse a request body into an {@link ImportDeckRequest}, or return why it is
 * not one. A parser rather than a validator-plus-cast: every field the
 * handler reads is checked here, so the shape and the checks cannot drift.
 */
function parseImportDeckRequest(record: Record<string, unknown>): ImportDeckRequest | ApiMessage {
  const overwrite = record.overwrite
  if (overwrite !== undefined && typeof overwrite !== 'boolean') {
    return apiMessage('admin.api.field.notBoolean', { field: 'overwrite' })
  }
  if (record.mode === 'url') {
    if (typeof record.url !== 'string') return apiMessage('admin.api.importDeck.urlRequiredForMode')
    if (typeof record.syncPrintings !== 'boolean') {
      // The CLI's stand-in for this field is an interactive prompt; over HTTP
      // the caller must decide, so an absent or mistyped value is refused
      // rather than silently defaulted.
      return apiMessage('admin.api.importDeck.syncPrintingsRequired')
    }
    return { mode: 'url', url: record.url, overwrite, syncPrintings: record.syncPrintings }
  }
  if (record.mode === 'text') {
    if (typeof record.content !== 'string') {
      return apiMessage('admin.api.importDeck.contentRequiredForMode')
    }
    if (record.syncPrintings !== undefined) {
      return apiMessage('admin.api.importDeck.syncPrintingsUrlOnly')
    }
    if (record.name !== undefined && typeof record.name !== 'string') {
      return apiMessage('admin.api.field.notString', { field: 'name' })
    }
    return { mode: 'text', content: record.content, name: record.name, overwrite }
  }
  return apiMessage('admin.api.importDeck.modeRequired')
}

/** What a finished import's summary notes, beyond the deck's name. */
type ImportNotes = {
  /** Pasted lines the parser could not read and skipped. */
  skipped: number
  /** Card lines imported without the labels they carried. */
  labelsDropped: number
  /** Advisories: category notices for a URL import, probable misreads for pasted text. */
  advisories: number
  mode: ImportDeckRequest['mode']
}

/**
 * The import's summary, with a note per kind of loss or doubt. The admin UI
 * surfaces only `message`, so a lossy text import says so there too; API
 * clients get the individual lines in `warnings` and `advisories`. Each note is
 * a plural count of its own, nested as a param, which is why this is a
 * {@link SyncMessage}.
 */
function importDeckMessage(name: string, notes: ImportNotes): SyncMessage {
  const parts: SyncMessageRef[] = []
  if (notes.skipped > 0) {
    parts.push(syncRef('admin.api.importDeck.skippedNote', { count: notes.skipped }))
  }
  if (notes.labelsDropped > 0) {
    parts.push(syncRef('admin.api.importDeck.labelsDroppedNote', { count: notes.labelsDropped }))
  }
  // Advisories are not loss, but they mean a line was probably misread, so the
  // one-line message mentions them too rather than only the API clients.
  if (notes.advisories > 0) {
    parts.push(
      notes.mode === 'url'
        ? syncRef('admin.api.importDeck.categoryNotesNote', { count: notes.advisories })
        : syncRef('admin.api.importDeck.misreadNote', { count: notes.advisories }),
    )
  }
  return syncMessage('admin.api.importDeck.imported', { name, notes: syncList(parts, 'concat') })
}

/**
 * The status a failed Archidekt deck fetch answers with: `404` when Archidekt
 * has no such deck to show (it answers a private one the same way), `502` when
 * it failed some other way — any other 4xx (a 403 included), a 5xx, a rate
 * limit that outlived its retries, or a 2xx reply that could not be read (an
 * `upstreamStatus` of 200 means "answered, but unusable").
 */
export function archidektFailureStatus(error: ArchidektRequestError): number {
  return error.upstreamStatus === 404 ? 404 : 502
}

/**
 * Fetch a URL import's deck. A failed Archidekt request is a refusal of its
 * own (English plus its key, at {@link archidektFailureStatus}); every other
 * failure is thrown on to the route's last resort.
 */
async function fetchUrlDeck(url: string): Promise<ImportedDeck | SyncMessage | Response> {
  try {
    return await fetchDeckFromUrl(url)
  } catch (error) {
    if (error instanceof ArchidektRequestError) {
      return nestedRefusal(error.syncMessage, archidektFailureStatus(error))
    }
    throw error
  }
}

export function handleImportDeck(req: Request): Promise<Response> {
  return apiHandler(async () => {
    const parsedBody = await readJsonObjectBody(req, MAX_UPLOAD_BODY_SIZE)
    if (!parsedBody.ok) return parsedBody.response
    const request = parseImportDeckRequest(parsedBody.body)
    if (isApiMessage(request)) return badRequest(request)
    const overwrite = request.overwrite ?? false

    let deckData: DeckData
    /** The source's categories; only a URL import from a service that has them sets it. */
    let categories: CardCategoryEntry[] | undefined
    let refusedCategories: string[] | undefined
    /** A text import's parse notices; a URL import has nothing to parse. */
    let notices: DeckParseNotice[] = []
    /** A pasted file's own front-matter default, which its lines' labels are measured against. */
    let sourceLabels: CardLabel[] | undefined

    if (request.mode === 'url') {
      const url = request.url.trim()
      if (!url) return badRequest(apiMessage('admin.api.field.required', { field: 'url' }))
      const result = await fetchUrlDeck(url)
      if (result instanceof Response) return result
      if (isSyncMessage(result)) return nestedRefusal(result)
      deckData = request.syncPrintings ? result.deck : stripDeckPrintings(result.deck)
      categories = result.categories
      refusedCategories = result.refusedCategories
    } else {
      const content = request.content.trim()
      if (!content) return badRequest(apiMessage('admin.api.field.required', { field: 'content' }))
      // English, as everything the API writes on a caller's behalf: a localized
      // default would make a file name and slug in the operator's language.
      const fallbackName = request.name?.trim() || apiText('admin.api.importDeck.defaultName')
      // Pasted text is an import surface, so it reads exactly what the CLI's
      // text path reads: the Arena/MTGO dialect (`4 Lightning Bolt (M10) 146`
      // becomes a printing, not a card name) and the inside of a ``` fence,
      // which is how a decklist pasted from Discord or GitHub arrives.
      const parsed = parseDeckText(content, fallbackName, undefined, IMPORT_TEXT_PARSE_OPTIONS)
      deckData = parsed.deck
      sourceLabels = parsed.defaultLabels
      // Skipped lines are content the import silently lost — the client must
      // be able to report them (the CLI's text path exits 1 on the same class).
      notices = parsed.notices
      if (deckData.sections.length === 0) {
        return badRequest(apiMessage('admin.api.importDeck.noCardLines'))
      }
    }

    const decksDir = getDecksDir()
    // No conflict resolver: there is no terminal behind an API request, so a
    // conflict is the usage error (a 400), never a prompt.
    const outcome = await saveDeck(deckData, decksDir, {
      forceOverwrite: overwrite,
      assumeYes: overwrite,
      categories,
      sourceLabels,
    })
    // Only a resolver can cancel, and this call injects none; still, the
    // outcome is honoured rather than assumed so the contract cannot drift.
    if (outcome.status === 'cancelled') {
      return badRequest(apiMessage('admin.api.importDeck.cancelled'))
    }
    const warnings = importParseWarnings(notices)
    // A URL import's category notes join the advisories: news, not loss.
    const advisories: SyncMessage[] = [
      ...importParseAdvisories(notices),
      ...importCategoryAdvisories(refusedCategories, outcome.categoryError),
    ]

    // The file the save actually wrote: an overwrite of a folded twin or an
    // id-matched deck lands on the existing file, not the import's own slug.
    await autoCommitAndPush(
      decksDir,
      [outcome.filePath, ...outcome.writtenFiles],
      `Import deck: ${outcome.name}`,
    )

    // A card kept with its labels dropped arrived; only its labels did not.
    const labelsDropped = warnings.filter((warning) => warning.labelsDropped === true).length
    const resp: ImportDeckResponse = {
      success: true,
      ...importDeckMessage(outcome.name, {
        skipped: warnings.length - labelsDropped,
        labelsDropped,
        advisories: advisories.length,
        mode: request.mode,
      }),
      deckName: outcome.name,
      warnings,
      advisories,
      syncPrintings: request.mode === 'url' ? request.syncPrintings : true,
    }
    return Response.json(resp)
  })
}
