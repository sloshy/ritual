import { loadListInfos, type ListInfo } from '../../list/list-info'
import { apiHandler } from '../utils'

export type ListsResponse = { success: true; lists: ListInfo[] }

/** GET /api/lists — every list across all three types as lightweight summaries. */
export function handleLists(): Promise<Response> {
  return apiHandler(async () => {
    const body: ListsResponse = { success: true, lists: await loadListInfos() }
    return Response.json(body)
  })
}
