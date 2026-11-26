/**
 * Why a value is not an absolute http(s) URL: it does not parse as an absolute
 * URL at all (`invalid`), or it does under another scheme (`scheme`).
 */
export type HttpUrlProblem = { problem: 'invalid' | 'scheme' }

/**
 * Parse an absolute URL whose scheme is `http:` or `https:`. The value is
 * parsed exactly as given (callers decide whether to trim first), and each
 * caller words the problem in its own message keys.
 *
 * A leaf with no imports, so the config and list-file parsers can share it
 * without reaching `src/i18n`.
 */
export function parseHttpUrl(value: string): URL | HttpUrlProblem {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return { problem: 'invalid' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { problem: 'scheme' }
  return url
}
