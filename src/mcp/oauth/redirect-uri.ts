import { parseHttpUrl } from '../../util/http-url'
import { MAX_REDIRECT_URI_LENGTH } from './policy'

/**
 * Why a redirect URI is refused at registration:
 * - `invalid`: not an absolute URL, or longer than the limit;
 * - `scheme`: neither `https:` nor a loopback `http:` (so no `javascript:`,
 *   `data:` or custom app schemes);
 * - `fragment`: carries a `#` (RFC 6749 §3.1.2 forbids one);
 * - `credentials`: carries a user name or password.
 */
export type RedirectUriProblem = 'invalid' | 'scheme' | 'fragment' | 'credentials'

/** A refused redirect URI and why. */
export type RefusedRedirectUri = { problem: RedirectUriProblem }

/**
 * Loopback names a native client's redirect may use (RFC 8252 §7.3, plus
 * `localhost`). Deliberately narrower than `isLoopbackHost` (which accepts all
 * of 127.0.0.0/8 and other spellings for a *bind* address): a redirect URI is
 * compared as text, so only the spellings clients actually register belong
 * here.
 */
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', '[::1]', 'localhost'])

/** Whether `url` is an `http:` redirect to this machine. */
function isLoopbackHttp(url: URL): boolean {
  return url.protocol === 'http:' && LOOPBACK_HOSTNAMES.has(url.hostname)
}

/**
 * Validate one redirect URI. Returns the URI exactly as given — it is stored
 * and later compared character for character, never normalized — or why it
 * is refused.
 */
export function parseRedirectUri(raw: string): string | RefusedRedirectUri {
  if (raw.length === 0 || raw.length > MAX_REDIRECT_URI_LENGTH) return { problem: 'invalid' }
  const parsed = parseHttpUrl(raw)
  if (!(parsed instanceof URL))
    return { problem: parsed.problem === 'scheme' ? 'scheme' : 'invalid' }
  const url = parsed
  if (url.protocol !== 'https:' && !isLoopbackHttp(url)) return { problem: 'scheme' }
  // `URL` drops an empty fragment from `hash`, so the raw text is checked too.
  if (url.hash !== '' || raw.includes('#')) return { problem: 'fragment' }
  if (url.username !== '' || url.password !== '') return { problem: 'credentials' }
  if (url.hostname === '') return { problem: 'invalid' }
  return raw
}

/**
 * A canonical loopback URI with its port removed, for the port-agnostic
 * comparison; `undefined` for anything else. Canonical means the text is
 * already what `URL` would print, so dropping the port is the only difference
 * the comparison can ever forgive: no case folding, no dot segments, no
 * percent-encoding differences.
 */
function loopbackKey(raw: string): string | undefined {
  const url = parseHttpUrl(raw)
  if (!(url instanceof URL) || !isLoopbackHttp(url) || url.href !== raw) return undefined
  url.port = ''
  return url.href
}

/**
 * The registered redirect URI `requested` matches, or `undefined`.
 *
 * Matching is exact string equality — no prefix, no normalization, no case
 * folding — with one exception from RFC 8252 §7.3: a loopback `http:`
 * redirect matches a registered loopback URI that differs from it only in its
 * port, because a native client (Claude Code) listens on whatever port it was
 * given. Both must then be in canonical form, host, path and query identical,
 * and the requested URI must itself be a valid redirect URI.
 */
export function matchRedirectUri(
  registered: readonly string[],
  requested: string,
): string | undefined {
  if (typeof parseRedirectUri(requested) !== 'string') return undefined
  if (registered.includes(requested)) return requested
  const requestedKey = loopbackKey(requested)
  if (requestedKey === undefined) return undefined
  return registered.find((candidate) => loopbackKey(candidate) === requestedKey)
}
