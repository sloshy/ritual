import { capitalize } from '../../utils'
import type { ListType } from '../../list-type'
import {
  createList,
  deleteList,
  isListLifecycleError,
  listDisplayName,
  listLifecycleErrorStatus,
  renameList,
  requireDeleteConfirmation,
  type ListLifecycleError,
} from '../../list-lifecycle'
import { apiHandler } from '../utils'
import { resolveListFileOrRefuse, type ListFileResult, type ResolveListFile } from './list-file'
import { apiError, autoCommitAndPush, readJsonObjectBody } from './save-helpers'
import { parseSlugFromUrl } from './target'

/**
 * Create / rename / delete for **every** list type.
 *
 * Decks used to have their own copies of rename and delete; the only thing that
 * ever differed was how a slug becomes a file path, which is now the
 * {@link ResolveListFile} hook. Folding them together is what lets each
 * operation have exactly one response type — which is what an honest
 * `outputSchema` on `create_list` / `rename_list` / `delete_list` needs.
 *
 * Create stays split: `POST /api/deck/create` takes an extra `format`, so it
 * lives in `deck-create.ts` and only shares {@link ListCreateResponse}.
 */

/** Everything a lifecycle route differs by, per list type. */
export interface ListLifecycleConfig {
  kind: ListType
  /** Singular lowercase label, e.g. `deck`, `collection`, `wanted list`. */
  label: string
  getDir: () => string
  resolveFile: ResolveListFile
}

/** `POST /api/{deck,collection,wanted}/create` — the new list's slug. */
export interface ListCreateResponse {
  success: true
  message: string
  slug: string
}

/** `POST /api/{deck,collection,wanted}/:slug/rename` — the slug the list moved to. */
export interface ListRenameResponse {
  success: true
  message: string
  newSlug: string
}

/** `DELETE /api/{deck,collection,wanted}/:slug` — the list is gone. */
export interface ListDeleteResponse {
  success: true
  message: string
}

type CreateRequest = { name: string }
type RenameRequest = { newName: string }
type DeleteRequest = { confirmName: string }

/** Map a lifecycle-engine refusal onto the shared error envelope. */
export function lifecycleErrorResponse(error: ListLifecycleError): Response {
  const { status, message } = listLifecycleErrorStatus(error)
  return apiError(message, status)
}

/** Resolve an already-validated slug to a file, or the response refusing it. */
function resolveTargetFile(slug: string, cfg: ListLifecycleConfig): Promise<ListFileResult> {
  return resolveListFileOrRefuse(cfg.resolveFile, { slug, dir: cfg.getDir(), label: cfg.label })
}

export function handleListCreate(req: Request, cfg: ListLifecycleConfig): Promise<Response> {
  return apiHandler(async () => {
    const parsed = await readJsonObjectBody(req)
    if (!parsed.ok) return parsed.response
    const { name } = parsed.body as unknown as CreateRequest

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return apiError(`${capitalize(cfg.label)} name is required`, 400)
    }

    const trimmedName = name.trim()
    const result = await createList(cfg.kind, trimmedName)
    if (isListLifecycleError(result)) return lifecycleErrorResponse(result)

    await autoCommitAndPush(
      cfg.getDir(),
      result.touchedFiles,
      `Create ${cfg.label}: ${trimmedName}`,
    )

    const resp: ListCreateResponse = {
      success: true,
      message: `Created ${cfg.label} '${trimmedName}'`,
      slug: result.slug,
    }
    return Response.json(resp)
  })
}

export function handleListRename(req: Request, cfg: ListLifecycleConfig): Promise<Response> {
  return apiHandler(async () => {
    const parsedSlug = parseSlugFromUrl(req)
    if (!parsedSlug.ok) return apiError(parsedSlug.message, 400)

    const parsed = await readJsonObjectBody(req)
    if (!parsed.ok) return parsed.response
    const { newName } = parsed.body as unknown as RenameRequest

    if (!newName || typeof newName !== 'string' || newName.trim().length === 0) {
      return apiError(`New ${cfg.label} name is required`, 400)
    }

    const target = await resolveTargetFile(parsedSlug.slug, cfg)
    if (!target.ok) return target.response

    const trimmedName = newName.trim()
    const result = await renameList(cfg.kind, target.filePath, trimmedName)
    if (isListLifecycleError(result)) return lifecycleErrorResponse(result)

    await autoCommitAndPush(
      cfg.getDir(),
      result.touchedFiles,
      `Rename ${cfg.label}: ${result.oldName} → ${trimmedName}`,
    )

    const resp: ListRenameResponse = {
      success: true,
      message: `Renamed ${cfg.label} to '${trimmedName}'`,
      newSlug: result.newSlug,
    }
    return Response.json(resp)
  })
}

export function handleListDelete(req: Request, cfg: ListLifecycleConfig): Promise<Response> {
  return apiHandler(async () => {
    const parsedSlug = parseSlugFromUrl(req)
    if (!parsedSlug.ok) return apiError(parsedSlug.message, 400)

    const parsed = await readJsonObjectBody(req)
    if (!parsed.ok) return parsed.response
    const { confirmName } = parsed.body as unknown as DeleteRequest

    if (!confirmName || typeof confirmName !== 'string') {
      return apiError('confirmName is required', 400)
    }

    const target = await resolveTargetFile(parsedSlug.slug, cfg)
    if (!target.ok) return target.response

    const displayName = await listDisplayName(cfg.kind, target.filePath)

    const mismatch = requireDeleteConfirmation(confirmName, displayName)
    if (mismatch) return apiError(mismatch, 400)

    const result = await deleteList(cfg.kind, target.filePath)
    if (isListLifecycleError(result)) return lifecycleErrorResponse(result)

    // Auto-commit if enabled (git add stages deletions of tracked files).
    await autoCommitAndPush(
      cfg.getDir(),
      result.touchedFiles,
      `Delete ${cfg.label}: ${displayName}`,
    )

    const resp: ListDeleteResponse = {
      success: true,
      message: `Deleted ${cfg.label} '${displayName}'`,
    }
    return Response.json(resp)
  })
}
