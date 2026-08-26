import { isRecord } from '../../util/json'
import type { StatusResponse } from '../api/status'

/**
 * Whether an untyped body off the wire really is a status payload.
 *
 * Every field is declared non-optional, so asserting the parsed JSON into the
 * type would let an error envelope (or a server ahead of / behind this bundle)
 * masquerade as a status — with `sellMode` reading as `undefined` and every
 * sell surface silently disappearing. Same reasoning as `useApiAction`'s
 * refusal to cast, and `fetchRitualConfig`'s `data.success && data.config`.
 */
function isStatusResponse(value: unknown): value is StatusResponse {
  if (!isRecord(value)) return false
  return (
    typeof value.ok === 'boolean' &&
    typeof value.setupRequired === 'boolean' &&
    typeof value.totpEnabled === 'boolean' &&
    typeof value.sellMode === 'boolean'
  )
}

/**
 * Fetch `GET /api/status` — the questions a client may ask before it has a
 * session: whether this server still needs its first account, which second
 * factor to expect, and which optional capabilities it offers.
 *
 * Returns `null` for every answer that is not a well-formed status payload: a
 * request that never arrived, a non-2xx response (the admin answers its own
 * `{success:false}` envelope as JSON when the config file is unparseable), a
 * body that is not JSON, and a body missing any field. Callers decide what an
 * unanswered status means for them: app boot treats it as "setup required",
 * while a later refresh keeps the last known answer. Unauthenticated by design,
 * so no credentials are sent (mirrors `config-api`'s single owner of one
 * endpoint's request shape).
 */
export async function fetchStatus(): Promise<StatusResponse | null> {
  try {
    const resp = await fetch('/api/status')
    if (!resp.ok) return null
    const data: unknown = await resp.json()
    return isStatusResponse(data) ? data : null
  } catch {
    return null
  }
}
