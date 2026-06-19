import { getErrorMessage } from '../../errors'
import { loadListInfos } from './list-info'

/** GET /api/lists — every list across all three types as lightweight summaries. */
export async function handleLists(): Promise<Response> {
  try {
    const lists = await loadListInfos()
    return Response.json({ success: true, lists })
  } catch (error) {
    return Response.json({ success: false, message: getErrorMessage(error) }, { status: 500 })
  }
}
