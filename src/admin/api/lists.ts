import { getErrorMessage } from '../../errors'
import { loadListInfos, type ListInfo } from './list-info'

export type ListsResponse = { success: true; lists: ListInfo[] }
export type ListsErrorResponse = { success: false; message: string }

/** GET /api/lists — every list across all three types as lightweight summaries. */
export async function handleLists(): Promise<Response> {
  try {
    const body: ListsResponse = { success: true, lists: await loadListInfos() }
    return Response.json(body)
  } catch (error) {
    const body: ListsErrorResponse = { success: false, message: getErrorMessage(error) }
    return Response.json(body, { status: 500 })
  }
}
