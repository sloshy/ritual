import path from 'node:path'
import type { ChangeEvent } from '../../change-event'
import { replaySectionOrder } from '../../change-event'
import type { DeckData } from '../../types'
import type { ListType } from '../../list-type'
import {
  dirForType,
  formatResolveListError,
  isResolveListError,
  resolveList,
} from '../../resolve-list'
import { isPathWithinDir } from '../../path-validation'
import { allocateId, collectDeckCardIds, collectExistingIds, createIdPool } from '../../card-id'
import {
  type ChangeBundle,
  type ChangeBundleList,
  countLabel,
  parseChangeBundle,
} from '../../editor/change-bundle'
import {
  type ImportConflict,
  type RetargetResult,
  retargetImportedChanges,
} from '../../editor/import-changes'
import { applyChangeToDeck } from '../../editor/deck-changes'
import { applyChangeToWantedList } from '../../editor/wanted-changes'
import { toWantedCardEntries } from '../../editor/wanted-entries'
import { getErrorMessage } from '../../errors'
import { buildSyntheticRequest } from '../../synthetic-request'
import type { CollectionLoadResult, DeckLoadResult, WantedLoadResult } from './load-results'
import { validateBodySize } from './save-helpers'
import { handleDeckLoad } from './deck-load'
import { handleDeckSave } from './deck-save'
import { handleCollectionLoad } from './collection-load'
import { handleCollectionSave } from './collection-save'
import { handleWantedListLoad } from './wanted-load'
import { handleWantedListSave } from './wanted-save'

/** Origin for synthetic in-process request URLs; nothing leaves the process. */
const SYNTHETIC_ORIGIN = 'http://ritual-import'

/** The outcome of applying one bundle list's changes to its file. */
export type ListImportResult = {
  kind: ListType
  slug: string
  name: string
  /** Changes applied to the list (after dropping conflicts). */
  applied: number
  /** Changes skipped because their target card no longer exists in the list. */
  conflicts: ImportConflict[]
  /** Human-readable failure when the list could not be loaded or saved; nothing was applied. */
  error?: string
}

/** The outcome of applying a whole change bundle. */
export type BundleImportResult = {
  /** True when every list applied without a load/save error (conflicts are not errors). */
  success: boolean
  lists: ListImportResult[]
}

type ApiCallResult<T> = { ok: true; data: T } | { ok: false; error: string }

/**
 * Invoke an admin route handler in-process with a synthetic request and return
 * its parsed JSON body, normalizing HTTP failures and `success: false` bodies to
 * an error string. This reuses the exact load/save code paths the admin editors
 * (and the MCP server) go through — content hashing, changelogs, and cross-list
 * moves behave identically. Git auto-commit depends on the surface: the admin
 * route and the MCP `import_changes` tool honor the `admin.git*` keys, while the
 * `ritual import-changes` CLI wraps its apply in `suppressAutoCommit` so the CLI
 * never creates commits.
 */
async function call<T>(
  handler: (req: Request) => Promise<Response>,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<ApiCallResult<T>> {
  const response = await handler(buildSyntheticRequest(SYNTHETIC_ORIGIN, method, path, body))
  const data = (await response.json()) as Record<string, unknown>
  if (!response.ok || data.success === false) {
    const message =
      typeof data.message === 'string' ? data.message : `Request failed (HTTP ${response.status})`
    return { ok: false, error: message }
  }
  return { ok: true, data: data as T }
}

/**
 * Re-aim a list's imported changes at its current card IDs: adds draw fresh IDs
 * from a pool seeded with the list's existing IDs, other changes resolve by ID
 * then by card name, and unresolvable ones become conflicts.
 */
function retarget(
  changes: ChangeEvent[],
  currentIds: number[],
  findIdByName: (name: string) => number | undefined,
): RetargetResult {
  const pool = createIdPool(currentIds)
  return retargetImportedChanges({
    changes,
    currentIds: new Set(currentIds),
    allocateId: () => allocateId(pool),
    findIdByName,
  })
}

function findDeckCardIdByName(deck: DeckData, name: string): number | undefined {
  for (const section of deck.sections) {
    for (const card of section.cards) {
      if (card.name === name && card.cardId !== undefined) return card.cardId
    }
  }
  return undefined
}

type NamedEntry = { name: string; cardId?: number }

function findEntryIdByName(entries: readonly NamedEntry[], name: string): number | undefined {
  return entries.find((e) => e.name === name && e.cardId !== undefined)?.cardId
}

type ApplyOutcome = {
  retargeted: ChangeEvent[]
  conflicts: ImportConflict[]
  error?: string
}

async function applyToDeck(slug: string, changes: ChangeEvent[]): Promise<ApplyOutcome> {
  const encoded = encodeURIComponent(slug)
  const loaded = await call<DeckLoadResult>(handleDeckLoad, 'GET', `/api/deck/${encoded}`)
  if (!loaded.ok) return { retargeted: [], conflicts: [], error: loaded.error }
  const { deck, frontMatter, contentHash } = loaded.data

  const { retargeted, conflicts } = retarget(changes, collectDeckCardIds(deck), (name) =>
    findDeckCardIdByName(deck, name),
  )
  if (retargeted.length === 0) return { retargeted, conflicts }

  const updated = retargeted.reduce(applyChangeToDeck, deck)
  const saved = await call(handleDeckSave, 'POST', `/api/deck/${encoded}/save`, {
    changes: retargeted,
    deck: updated,
    frontMatter,
    contentHash,
  })
  if (!saved.ok) return { retargeted: [], conflicts, error: saved.error }
  return { retargeted, conflicts }
}

async function applyToCollection(slug: string, changes: ChangeEvent[]): Promise<ApplyOutcome> {
  const encoded = encodeURIComponent(slug)
  const loaded = await call<CollectionLoadResult>(
    handleCollectionLoad,
    'GET',
    `/api/collection/${encoded}`,
  )
  if (!loaded.ok) return { retargeted: [], conflicts: [], error: loaded.error }
  const { entries, sectionOrder, contentHash } = loaded.data

  const { retargeted, conflicts } = retarget(changes, collectExistingIds(entries), (name) =>
    findEntryIdByName(entries, name),
  )
  if (retargeted.length === 0) return { retargeted, conflicts }

  // The collection save endpoint replays the changes against the file itself;
  // only the (re-targeted) change list and section order need to be sent.
  const saved = await call(handleCollectionSave, 'POST', `/api/collection/${encoded}/save`, {
    changes: retargeted,
    contentHash,
    sectionOrder: replaySectionOrder(sectionOrder ?? [], retargeted),
  })
  if (!saved.ok) return { retargeted: [], conflicts, error: saved.error }
  return { retargeted, conflicts }
}

async function applyToWanted(slug: string, changes: ChangeEvent[]): Promise<ApplyOutcome> {
  const encoded = encodeURIComponent(slug)
  const loaded = await call<WantedLoadResult>(handleWantedListLoad, 'GET', `/api/wanted/${encoded}`)
  if (!loaded.ok) return { retargeted: [], conflicts: [], error: loaded.error }
  const { contentHash, sectionOrder } = loaded.data
  const entries = toWantedCardEntries(loaded.data.entries)

  const { retargeted, conflicts } = retarget(changes, collectExistingIds(entries), (name) =>
    findEntryIdByName(entries, name),
  )
  if (retargeted.length === 0) return { retargeted, conflicts }

  // The wanted save endpoint serializes the entries it receives, so the changes
  // are applied here and the resulting entry list sent along with them.
  const updated = retargeted.reduce(applyChangeToWantedList, entries)
  const saved = await call(handleWantedListSave, 'POST', `/api/wanted/${encoded}/save`, {
    changes: retargeted,
    entries: updated,
    contentHash,
    sectionOrder: replaySectionOrder(sectionOrder ?? [], retargeted),
  })
  if (!saved.ok) return { retargeted: [], conflicts, error: saved.error }
  return { retargeted, conflicts }
}

function applyByKind(kind: ListType, slug: string, changes: ChangeEvent[]): Promise<ApplyOutcome> {
  switch (kind) {
    case 'deck':
      return applyToDeck(slug, changes)
    case 'collection':
      return applyToCollection(slug, changes)
    case 'wanted':
      return applyToWanted(slug, changes)
    default: {
      kind satisfies never
      throw new Error('Unhandled list kind (this is a bug)')
    }
  }
}

/**
 * Resolve a bundle list to the file basename the load/save handlers key on. Two
 * export surfaces produce different slugs: the admin editor and MCP server use the
 * file basename verbatim (e.g. `Red Binder`), while the public site slugifies the
 * display name for its URLs (e.g. `red-binder`). A basename that exists on disk is
 * used directly (admin/MCP round-trip); otherwise the bundle's display `name` is
 * resolved against the on-disk files via the shared list resolver, which reverses
 * the public site's slugging by matching case- and diacritic-insensitively.
 */
async function resolveListBasename(list: ChangeBundleList): Promise<ApiCallResult<string>> {
  const dir = dirForType(list.kind)
  const direct = path.join(dir, `${list.slug}.md`)
  if (isPathWithinDir(direct, dir) && (await Bun.file(direct).exists())) {
    return { ok: true, data: list.slug }
  }

  const resolved = await resolveList(list.name, list.kind)
  if (isResolveListError(resolved)) return { ok: false, error: formatResolveListError(resolved) }
  return { ok: true, data: resolved.name }
}

async function applyList(list: ChangeBundleList): Promise<ListImportResult> {
  const base: Pick<ListImportResult, 'kind' | 'slug' | 'name'> = {
    kind: list.kind,
    slug: list.slug,
    name: list.name,
  }
  if (list.changes.length === 0) return { ...base, applied: 0, conflicts: [] }

  const resolved = await resolveListBasename(list)
  if (!resolved.ok) return { ...base, applied: 0, conflicts: [], error: resolved.error }

  const outcome = await applyByKind(list.kind, resolved.data, list.changes)

  return {
    ...base,
    applied: outcome.error ? 0 : outcome.retargeted.length,
    conflicts: outcome.conflicts,
    error: outcome.error,
  }
}

/**
 * Apply every list's changes in a change bundle to the underlying list files,
 * sequentially and in bundle order. Each list is loaded fresh immediately before
 * it is saved — necessary because an earlier list's cross-list moves may have
 * already rewritten a later list's file. A list that fails to load or save is
 * reported in its result and does not stop the remaining lists. Shared by the
 * admin `POST /api/import-changes` route and the `ritual import-changes` CLI.
 */
export async function applyChangeBundle(bundle: ChangeBundle): Promise<BundleImportResult> {
  const lists: ListImportResult[] = []
  for (const list of bundle.lists) {
    lists.push(await applyList(list))
  }
  return { success: lists.every((l) => l.error === undefined), lists }
}

/**
 * Build the one-line human summary of a bundle import ("Applied 3 changes
 * across 2 lists"). Shared verbatim by the admin `POST /api/import-changes`
 * response, the MCP `import_changes` tool (which calls that route), and the
 * CLI's `--output json` payload, so all three surfaces report identically.
 */
export function bundleImportMessage(result: BundleImportResult): string {
  const applied = countLabel(
    result.lists.reduce((sum, l) => sum + l.applied, 0),
    'change',
  )
  const failed = result.lists.filter((l) => l.error !== undefined).length
  return result.success
    ? `Applied ${applied} across ${countLabel(result.lists.length, 'list')}`
    : `Applied ${applied}; ${countLabel(failed, 'list')} failed`
}

/**
 * `POST /api/import-changes` — apply an exported change bundle. The body is the
 * raw exported JSON; the response reports per-list
 * applied counts, skipped conflicts, and errors.
 */
export async function handleImportChanges(req: Request): Promise<Response> {
  try {
    const sizeError = validateBodySize(req)
    if (sizeError) return sizeError

    const bundle = parseChangeBundle(await req.text())
    if (typeof bundle === 'string') {
      return Response.json({ success: false, message: bundle }, { status: 400 })
    }

    const result = await applyChangeBundle(bundle)
    return Response.json({ ...result, message: bundleImportMessage(result) })
  } catch (error) {
    return Response.json({ success: false, message: getErrorMessage(error) }, { status: 500 })
  }
}
