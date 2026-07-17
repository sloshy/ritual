import { resolveDeckFilePath } from '../../deck-file'
import { getDecksDir } from '../../ritual-config'
import { isListLifecycleError, listLifecycleErrorStatus, renameList } from '../../list-lifecycle'
import { apiHandler } from '../utils'
import { autoCommitAndPush, validateBodySize } from './save-helpers'
import { slugFromUrl } from './target'

interface DeckRenameRequest {
  newName: string
}

interface DeckRenameResponse {
  success: boolean
  message: string
  newSlug?: string
}

export function handleDeckRename(req: Request): Promise<Response> {
  return apiHandler(async () => {
    const slug = slugFromUrl(req)
    if (!slug) {
      const resp: DeckRenameResponse = { success: false, message: 'Deck slug is required' }
      return Response.json(resp, { status: 400 })
    }

    const tooLarge = validateBodySize(req)
    if (tooLarge) return tooLarge

    const body = (await req.json()) as DeckRenameRequest
    const { newName } = body

    if (!newName || typeof newName !== 'string' || newName.trim().length === 0) {
      const resp: DeckRenameResponse = { success: false, message: 'New deck name is required' }
      return Response.json(resp, { status: 400 })
    }

    const decksDir = getDecksDir()
    const filePath = await resolveDeckFilePath(decksDir, slug)

    if (!filePath) {
      const resp: DeckRenameResponse = {
        success: false,
        message: `Deck '${slug}' not found`,
      }
      return Response.json(resp, { status: 404 })
    }

    const trimmedName = newName.trim()
    const result = await renameList('deck', filePath, trimmedName)
    if (isListLifecycleError(result)) {
      const { status, message } = listLifecycleErrorStatus(result)
      const resp: DeckRenameResponse = { success: false, message }
      return Response.json(resp, { status })
    }

    await autoCommitAndPush(
      decksDir,
      result.touchedFiles,
      `Rename deck: ${result.oldName} → ${trimmedName}`,
    )

    const resp: DeckRenameResponse = {
      success: true,
      message: `Renamed deck to '${trimmedName}'`,
      newSlug: result.newSlug,
    }
    return Response.json(resp)
  })
}
