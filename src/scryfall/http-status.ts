/** The status pair of a failed response, as the Scryfall request-failure messages interpolate it. */
export type HttpStatusParams = { status: number; statusText: string }

/** A failed response's status pair, for a request-failure message's params. */
export function httpStatus(response: Response): HttpStatusParams {
  return { status: response.status, statusText: response.statusText }
}
