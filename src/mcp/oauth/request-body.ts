import { readBodyText } from '../../api/http'
import { MAX_OAUTH_BODY_BYTES } from './policy'

/** Why a request body could not be read: the wrong media type, or over the budget. */
export type BodyProblem = { problem: 'contentType' | 'tooLarge' }

/** Whether a read returned a problem. */
export function isBodyProblem<T>(value: T | BodyProblem): value is BodyProblem {
  return typeof value === 'object' && value !== null && 'problem' in value
}

/** Whether the request declares `mediaType` (parameters such as `charset` aside). */
function hasMediaType(request: Request, mediaType: string): boolean {
  const declared = request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase()
  return declared === mediaType
}

/** Read the body as text within the OAuth budget. */
async function readText(request: Request): Promise<string | BodyProblem> {
  const read = await readBodyText(request, MAX_OAUTH_BODY_BYTES)
  return read.ok ? read.text : { problem: 'tooLarge' }
}

/** Read an `application/x-www-form-urlencoded` body (the token endpoint, the consent form). */
export async function readForm(request: Request): Promise<URLSearchParams | BodyProblem> {
  if (!hasMediaType(request, 'application/x-www-form-urlencoded')) return { problem: 'contentType' }
  const text = await readText(request)
  return isBodyProblem(text) ? text : new URLSearchParams(text)
}

/**
 * A JSON body, boxed so that no client-sent value can pass for a
 * {@link BodyProblem}. `json` is `undefined` for text that is not JSON, which
 * the caller refuses like any other unusable metadata.
 */
export type JsonBody = { json: unknown }

/** Read a JSON body (registration). */
export async function readJson(request: Request): Promise<JsonBody | BodyProblem> {
  if (!hasMediaType(request, 'application/json')) return { problem: 'contentType' }
  const text = await readText(request)
  if (isBodyProblem(text)) return text
  try {
    return { json: JSON.parse(text) as unknown }
  } catch {
    return { json: undefined }
  }
}

/** A parameter's value, or `null` when it is absent or empty (OAuth treats the two alike). */
export function parameter(params: URLSearchParams, name: string): string | null {
  const value = params.get(name)
  return value === null || value === '' ? null : value
}

/** The first parameter name given more than once, if any (RFC 6749 §3.1, §3.2). */
export function repeatedParameter(params: URLSearchParams): string | undefined {
  const seen = new Set<string>()
  for (const name of params.keys()) {
    if (seen.has(name)) return name
    seen.add(name)
  }
  return undefined
}
