import { errorResponse } from '../api/http'

/**
 * Run a route handler, answering whatever it throws with the shared refusal
 * (see `errorResponse`).
 */
export async function apiHandler(handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler()
  } catch (error) {
    return errorResponse(error)
  }
}
