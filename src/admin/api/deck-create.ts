import { getDecksDir } from '../../ritual-config'
import { createList, isListLifecycleError, listLifecycleErrorStatus } from '../../list-lifecycle'
import { apiHandler } from '../utils'
import { autoCommitAndPush, validateBodySize } from './save-helpers'

interface DeckCreateRequest {
  name: string
  format?: string
}

interface DeckCreateResponse {
  success: boolean
  message: string
  slug?: string
}

export function handleDeckCreate(req: Request): Promise<Response> {
  return apiHandler(async () => {
    const tooLarge = validateBodySize(req)
    if (tooLarge) return tooLarge

    const body = (await req.json()) as DeckCreateRequest
    const { name, format } = body

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      const resp: DeckCreateResponse = { success: false, message: 'Deck name is required' }
      return Response.json(resp, { status: 400 })
    }

    const trimmedName = name.trim()
    const result = await createList('deck', trimmedName, format)
    if (isListLifecycleError(result)) {
      const { status, message } = listLifecycleErrorStatus(result)
      const resp: DeckCreateResponse = { success: false, message }
      return Response.json(resp, { status })
    }

    await autoCommitAndPush(getDecksDir(), result.touchedFiles, `Create deck: ${trimmedName}`)

    const resp: DeckCreateResponse = {
      success: true,
      message: `Created deck '${trimmedName}'`,
      slug: result.slug,
    }
    return Response.json(resp)
  })
}
