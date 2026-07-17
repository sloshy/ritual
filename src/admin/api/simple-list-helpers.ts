import path from 'node:path'
import { isPathWithinDir } from '../../path-validation'
import { capitalize } from '../../utils'
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
import { autoCommitAndPush, validateBodySize } from './save-helpers'
import { slugFromUrl } from './target'

export type SimpleListKind = 'collection' | 'wanted'

export type SimpleListConfig = {
  kind: SimpleListKind
  getDir: () => string
  /** Singular human-readable label, e.g. 'collection' or 'wanted list'. */
  label: string
}

type SimpleListResponse = {
  success: boolean
  message: string
  slug?: string
  newSlug?: string
}

type CreateRequest = { name: string }
type RenameRequest = { newName: string }
type DeleteRequest = { confirmName: string }

function lifecycleErrorResponse(error: ListLifecycleError): Response {
  const { status, message } = listLifecycleErrorStatus(error)
  const resp: SimpleListResponse = { success: false, message }
  return Response.json(resp, { status })
}

export function handleSimpleListCreate(req: Request, cfg: SimpleListConfig): Promise<Response> {
  return apiHandler(async () => {
    const tooLarge = validateBodySize(req)
    if (tooLarge) return tooLarge

    const body = (await req.json()) as CreateRequest
    const { name } = body

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      const resp: SimpleListResponse = {
        success: false,
        message: `${capitalize(cfg.label)} name is required`,
      }
      return Response.json(resp, { status: 400 })
    }

    const trimmedName = name.trim()
    const result = await createList(cfg.kind, trimmedName)
    if (isListLifecycleError(result)) return lifecycleErrorResponse(result)

    await autoCommitAndPush(
      cfg.getDir(),
      result.touchedFiles,
      `Create ${cfg.label}: ${trimmedName}`,
    )

    const resp: SimpleListResponse = {
      success: true,
      message: `Created ${cfg.label} '${trimmedName}'`,
      slug: result.slug,
    }
    return Response.json(resp)
  })
}

export function handleSimpleListRename(req: Request, cfg: SimpleListConfig): Promise<Response> {
  return apiHandler(async () => {
    const slug = slugFromUrl(req)
    if (!slug) {
      const resp: SimpleListResponse = {
        success: false,
        message: `${capitalize(cfg.label)} slug is required`,
      }
      return Response.json(resp, { status: 400 })
    }

    const tooLarge = validateBodySize(req)
    if (tooLarge) return tooLarge

    const body = (await req.json()) as RenameRequest
    const { newName } = body

    if (!newName || typeof newName !== 'string' || newName.trim().length === 0) {
      const resp: SimpleListResponse = {
        success: false,
        message: `New ${cfg.label} name is required`,
      }
      return Response.json(resp, { status: 400 })
    }

    const dir = cfg.getDir()
    const filePath = path.join(dir, `${slug}.md`)

    if (!isPathWithinDir(filePath, dir)) {
      const resp: SimpleListResponse = {
        success: false,
        message: `Invalid ${cfg.label} slug`,
      }
      return Response.json(resp, { status: 400 })
    }

    if (!(await Bun.file(filePath).exists())) {
      const resp: SimpleListResponse = {
        success: false,
        message: `${capitalize(cfg.label)} '${slug}' not found`,
      }
      return Response.json(resp, { status: 404 })
    }

    const trimmedName = newName.trim()
    const result = await renameList(cfg.kind, filePath, trimmedName)
    if (isListLifecycleError(result)) return lifecycleErrorResponse(result)

    await autoCommitAndPush(
      dir,
      result.touchedFiles,
      `Rename ${cfg.label}: ${result.oldName} → ${trimmedName}`,
    )

    const resp: SimpleListResponse = {
      success: true,
      message: `Renamed ${cfg.label} to '${trimmedName}'`,
      newSlug: result.newSlug,
    }
    return Response.json(resp)
  })
}

export function handleSimpleListDelete(req: Request, cfg: SimpleListConfig): Promise<Response> {
  return apiHandler(async () => {
    const slug = slugFromUrl(req)
    if (!slug) {
      const resp: SimpleListResponse = {
        success: false,
        message: `${capitalize(cfg.label)} slug is required`,
      }
      return Response.json(resp, { status: 400 })
    }

    const tooLarge = validateBodySize(req)
    if (tooLarge) return tooLarge

    const body = (await req.json()) as DeleteRequest
    const { confirmName } = body

    if (!confirmName || typeof confirmName !== 'string') {
      const resp: SimpleListResponse = { success: false, message: 'confirmName is required' }
      return Response.json(resp, { status: 400 })
    }

    const dir = cfg.getDir()
    const filePath = path.join(dir, `${slug}.md`)

    if (!isPathWithinDir(filePath, dir)) {
      const resp: SimpleListResponse = {
        success: false,
        message: `Invalid ${cfg.label} slug`,
      }
      return Response.json(resp, { status: 400 })
    }

    if (!(await Bun.file(filePath).exists())) {
      const resp: SimpleListResponse = {
        success: false,
        message: `${capitalize(cfg.label)} '${slug}' not found`,
      }
      return Response.json(resp, { status: 404 })
    }

    const displayName = await listDisplayName(cfg.kind, filePath)

    const mismatch = requireDeleteConfirmation(confirmName, displayName)
    if (mismatch) {
      const resp: SimpleListResponse = { success: false, message: mismatch }
      return Response.json(resp, { status: 400 })
    }

    const result = await deleteList(cfg.kind, filePath)
    if (isListLifecycleError(result)) return lifecycleErrorResponse(result)

    await autoCommitAndPush(dir, result.touchedFiles, `Delete ${cfg.label}: ${displayName}`)

    const resp: SimpleListResponse = {
      success: true,
      message: `Deleted ${cfg.label} '${displayName}'`,
    }
    return Response.json(resp)
  })
}
