import { resolveDeckFilePath } from '../../deck-file'
import { getDecksDir } from '../../ritual-config'
import {
  deleteList,
  isListLifecycleError,
  listDisplayName,
  listLifecycleErrorStatus,
  requireDeleteConfirmation,
} from '../../list-lifecycle'
import { apiHandler } from '../utils'
import { autoCommitAndPush, validateBodySize } from './save-helpers'
import { slugFromUrl } from './target'

interface DeckDeleteRequest {
  confirmName: string
}

interface DeckDeleteResponse {
  success: boolean
  message: string
}

export function handleDeckDelete(req: Request): Promise<Response> {
  return apiHandler(async () => {
    const slug = slugFromUrl(req)
    if (!slug) {
      const resp: DeckDeleteResponse = { success: false, message: 'Deck slug is required' }
      return Response.json(resp, { status: 400 })
    }

    const tooLarge = validateBodySize(req)
    if (tooLarge) return tooLarge

    const body = (await req.json()) as DeckDeleteRequest
    const { confirmName } = body

    if (!confirmName || typeof confirmName !== 'string') {
      const resp: DeckDeleteResponse = {
        success: false,
        message: 'confirmName is required',
      }
      return Response.json(resp, { status: 400 })
    }

    const decksDir = getDecksDir()
    const filePath = await resolveDeckFilePath(decksDir, slug)

    if (!filePath) {
      const resp: DeckDeleteResponse = {
        success: false,
        message: `Deck '${slug}' not found`,
      }
      return Response.json(resp, { status: 404 })
    }

    const deckName = await listDisplayName('deck', filePath)

    const mismatch = requireDeleteConfirmation(confirmName, deckName)
    if (mismatch) {
      const resp: DeckDeleteResponse = { success: false, message: mismatch }
      return Response.json(resp, { status: 400 })
    }

    const result = await deleteList('deck', filePath)
    if (isListLifecycleError(result)) {
      const { status, message } = listLifecycleErrorStatus(result)
      const resp: DeckDeleteResponse = { success: false, message }
      return Response.json(resp, { status })
    }

    // Auto-commit if enabled (git add stages deletions of tracked files)
    await autoCommitAndPush(decksDir, result.touchedFiles, `Delete deck: ${deckName}`)

    const resp: DeckDeleteResponse = {
      success: true,
      message: `Deleted deck '${deckName}'`,
    }
    return Response.json(resp)
  })
}
