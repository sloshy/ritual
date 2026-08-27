import { getDecksDir } from '../../config/ritual-config'
import { createList, isListLifecycleError } from '../../list/list-lifecycle'
import { apiHandler } from '../utils'
import { lifecycleErrorResponse, type ListCreateResponse } from './list-lifecycle'
import { apiError, readJsonObjectBody } from '../../api/http'
import { autoCommitAndPush } from './save-helpers'

export interface DeckCreateRequest {
  name: string
  format?: string
}

/**
 * `POST /api/deck/create` — the one lifecycle route decks do not share with
 * collections and wanted lists, because a deck can be created with a `format`.
 * Its response is the shared {@link ListCreateResponse}.
 */
export function handleDeckCreate(req: Request): Promise<Response> {
  return apiHandler(async () => {
    const parsed = await readJsonObjectBody(req)
    if (!parsed.ok) return parsed.response
    const { name, format } = parsed.body as unknown as DeckCreateRequest

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return apiError('Deck name is required', 400)
    }

    const trimmedName = name.trim()
    const result = await createList('deck', trimmedName, format)
    if (isListLifecycleError(result)) return lifecycleErrorResponse(result)

    await autoCommitAndPush(getDecksDir(), result.touchedFiles, `Create deck: ${trimmedName}`)

    const resp: ListCreateResponse = {
      success: true,
      message: `Created deck '${trimmedName}'`,
      slug: result.slug,
    }
    return Response.json(resp)
  })
}
