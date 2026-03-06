/** Safely extract an error message from an unknown thrown value. */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Throw a descriptive error when an HTTP response is not OK. */
export function throwHttpError(response: Response, action: string): never {
  throw new Error(`${action}: ${response.status} ${response.statusText}`)
}
