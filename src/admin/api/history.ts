import { getBaseDir } from '../../config/base-dir'
import {
  isChangeLine,
  isSetHeaderLine,
  isValidIso8601,
  parseChangeSets,
  serializeChangeSets,
  sortNewestFirst,
  type ChangeSet,
} from '../../changes/changelog-blocks'
import { isStringArray } from '../../util/json'
import { buildDefaultChangeEventsForList } from '../../changes/list-snapshot'
import { decodeChangeEvent } from '../../changes/change-event-decode'
import { changeProblemMessage } from '../../changes/change-problem-message'
import { isSyncMessage, type SyncMessage } from '../../sync/message'
import type { ChangeEvent } from '../../changes/change-event'
import type { ListType } from '../../list/list-type'
import { changelogSidecarPath } from '../../list/list-sidecars'
import { resolveListFile } from './list-info'
import { listSlug } from '../../list/list-file-name'
import { apiMessage, isApiMessage, type ApiMessage } from '../../api/result'
import { autoCommitAndPush } from './save-helpers'
import { categoriesUnreadableWarning } from './categories'
import { apiError, errorResponse, nestedRefusal, readJsonObjectBody } from '../../api/http'
import { parseListTarget } from './target'
import { MAX_UPLOAD_BODY_SIZE } from '../validation'
import { createFenceTracker } from '../../list/markdown-fence'
import { hasLineBreak } from '../../util/single-line'
import { writeFileAtomic } from '../../util/atomic-write'

export type HistoryLoadResponse = {
  success: true
  /** Everything before the first change set (e.g. `# Changelog for My Deck`). */
  header: string
  /** Change sets, newest first. */
  sets: ChangeSet[]
  /** The events describing the list's current state, for the rewrite action. */
  defaultEvents: ChangeEvent[]
  /**
   * Why `defaultEvents` names no categories: the list's `.categories.json`
   * sidecar exists but could not be read. Absent when there was nothing to say.
   */
  categoryWarnings?: string[]
}
export type HistorySaveResponse = ApiMessage & { success: true; setCount: number }

/** Untrusted save body, validated before narrowing to `{ sets: ChangeSet[] }`. */
type RawSaveBody = { sets?: unknown }

/** Untrusted change-set item, validated before narrowing to `ChangeSet`. */
type RawChangeSet = { timestamp?: unknown; lines?: unknown; events?: unknown; trailing?: unknown }

/**
 * GET /api/history/:type/:slug — the list's parsed change sets (newest first) plus
 * the events that the "rewrite with defaults" action would produce. The change
 * log is the only file read for its sets; the list file is read solely to
 * derive the default events (best-effort — a parse failure yields no defaults).
 */
export async function handleHistoryLoad(req: Request): Promise<Response> {
  try {
    const target = parseListTarget(req)
    if (isApiMessage(target)) return apiError(target, 400)

    const filePath = await resolveListFile(target.type, target.slug)
    if (!filePath)
      return apiError(
        apiMessage('admin.api.list.notFound', { listType: target.type, slug: target.slug }),
        404,
      )

    const changesPath = changelogSidecarPath(filePath)
    let content = ''
    const changesFile = Bun.file(changesPath)
    if (await changesFile.exists()) content = await changesFile.text()
    const parsed = parseChangeSets(content, listSlug(filePath))

    let defaultEvents: ChangeEvent[] = []
    let categoryWarnings: string[] | undefined
    try {
      const defaults = await buildDefaultChangeEventsForList(target.type, filePath)
      defaultEvents = defaults.events
      // An unreadable categories sidecar contributes no category events; the
      // client is told, because a rewrite built from these events discards the
      // existing history.
      if (defaults.categoriesWarning !== undefined) {
        categoryWarnings = [categoriesUnreadableWarning(defaults.categoriesWarning)]
      }
    } catch {
      // A list file that can't be parsed simply offers no default rewrite.
    }

    const body: HistoryLoadResponse = {
      success: true,
      header: parsed.header,
      sets: sortNewestFirst(parsed.sets),
      defaultEvents,
      ...(categoryWarnings === undefined ? {} : { categoryWarnings }),
    }
    return Response.json(body)
  } catch (err) {
    return errorResponse(err)
  }
}

/**
 * Parse the raw save body's `sets` into typed change sets, or return the message
 * explaining the refusal. A parser, per the project convention — the HTTP status
 * and envelope belong to the handler, not here.
 */
function parseSets(raw: RawSaveBody, listType: ListType): ChangeSet[] | SyncMessage {
  if (!Array.isArray(raw.sets)) return apiMessage('admin.api.history.setsRequired')
  const sets: ChangeSet[] = []
  for (const [setIndex, item] of (raw.sets as unknown[]).entries()) {
    if (item === null || typeof item !== 'object') {
      return apiMessage('admin.api.history.setNotObject')
    }
    const { timestamp, lines, events, trailing } = item as RawChangeSet
    if (typeof timestamp !== 'string' || !isValidIso8601(timestamp.trim())) {
      return apiMessage('admin.api.history.timestampInvalid')
    }
    if (!isStringArray(lines)) return apiMessage('admin.api.history.linesInvalid')
    if (lines.length === 0) return apiMessage('admin.api.history.linesEmpty')
    // Lines are stored trimmed by parseChangeSets, and an embedded line break
    // would smuggle a fabricated header or change line past these checks.
    const trimmedLines = lines.map((l) => l.trim())
    if (!trimmedLines.every((l) => isChangeLine(l) && !hasLineBreak(l))) {
      return apiMessage('admin.api.history.lineInvalid')
    }
    // `events` is the set's typed record — one per change line, in order — and
    // is judged by the same decoder every other JSON-authored event goes
    // through. An empty array is a prose-only (block-less) set echoed back as-is.
    if (!Array.isArray(events)) return apiMessage('admin.api.history.eventsMissing')
    const decoded: ChangeEvent[] = []
    for (const [eventIndex, rawEvent] of (events as unknown[]).entries()) {
      // The decoder (persistence-fenced) returns a structured problem about the
      // record it is told it is reading — here, this set's event — worded as
      // English plus its key for the response.
      const event = decodeChangeEvent(
        rawEvent,
        { kind: 'history-event', set: setIndex + 1, event: eventIndex + 1 },
        { listType },
      )
      if (!event.ok) return changeProblemMessage(event.problem)
      decoded.push(event.value)
    }
    if (decoded.length !== 0 && decoded.length !== trimmedLines.length) {
      return apiMessage('admin.api.history.eventCountMismatch')
    }
    // `trailing` carries a set's preserved hand-written prose. A line outside
    // a fence that looks like a change line or a `## ` header would be
    // re-parsed as one on the next load, silently changing meaning — refuse
    // rather than reinterpret. Fenced lines are opaque to the reader, so the
    // same tracker it uses decides which lines are exposed; an unclosed fence
    // would swallow the rest of the file on reload, so it is refused too.
    if (trailing !== undefined) {
      if (!isStringArray(trailing)) return apiMessage('admin.api.history.trailingInvalid')
      if (trailing.some(hasLineBreak)) return apiMessage('admin.api.history.trailingMultiline')
      const fence = createFenceTracker()
      for (const line of trailing) {
        if (fence.feed(line).opaque) continue
        if (isChangeLine(line.trim()) || isSetHeaderLine(line.trim())) {
          return apiMessage('admin.api.history.trailingLooksLikeChange')
        }
      }
      if (fence.isOpen) return apiMessage('admin.api.history.trailingOpenFence')
    }
    sets.push({
      timestamp: timestamp.trim(),
      lines: trimmedLines,
      events: decoded,
      ...(trailing !== undefined && trailing.length > 0 ? { trailing } : {}),
    })
  }
  return sets
}

/**
 * POST /api/history/:type/:slug/save — overwrite the list's change log with the
 * supplied sets. Only the `.changes.md` file is written; the list's own `.md` is
 * never touched. The existing header is preserved (re-read from disk) so the
 * client can't rewrite it. Auto-commits the changelog like the editor endpoints.
 */
export async function handleHistorySave(req: Request): Promise<Response> {
  try {
    const target = parseListTarget(req)
    if (isApiMessage(target)) return apiError(target, 400)

    const parsedBody = await readJsonObjectBody(req, MAX_UPLOAD_BODY_SIZE)
    if (!parsedBody.ok) return parsedBody.response
    const raw: RawSaveBody = parsedBody.body
    const sets = parseSets(raw, target.type)
    if (isSyncMessage(sets)) return nestedRefusal(sets)

    const filePath = await resolveListFile(target.type, target.slug)
    if (!filePath)
      return apiError(
        apiMessage('admin.api.list.notFound', { listType: target.type, slug: target.slug }),
        404,
      )

    const changesPath = changelogSidecarPath(filePath)
    let existing = ''
    const changesFile = Bun.file(changesPath)
    if (await changesFile.exists()) existing = await changesFile.text()
    const { header } = parseChangeSets(existing, listSlug(filePath))

    await writeFileAtomic(changesPath, serializeChangeSets({ header, sets }))
    await autoCommitAndPush(
      getBaseDir(),
      [changesPath],
      `Rewrite change history for ${listSlug(filePath)}`,
    )

    const body: HistorySaveResponse = {
      success: true,
      ...apiMessage('admin.api.history.saved', { count: sets.length }),
      setCount: sets.length,
    }
    return Response.json(body)
  } catch (err) {
    return errorResponse(err)
  }
}
