import { t } from '../i18n/t'
import { EXAMPLE } from '../util/cli-tokens'
import { parseHttpUrl } from '../util/http-url'

/**
 * The external base URL an HTTP MCP endpoint is reached at when something
 * in front of it (a reverse proxy, a Cloudflare Tunnel) forwards a public
 * hostname to a loopback bind. Always an origin: scheme, host, and port only.
 *
 * Kept SDK-free, like `host.ts`, so the commands can parse the flag without
 * pulling the MCP SDK into their module graph.
 */
export type McpPublicUrl = {
  /** The normalized origin, e.g. `https://mcp.example.com` (no trailing slash). */
  origin: string
  /**
   * The URL's hostname in the form the SDK's Host/Origin allowlists compare
   * against: lowercase, punycoded, IPv6 bracketed, never a port.
   */
  hostname: string
}

/**
 * The authority-ish prefix of a raw value: whatever follows an optional
 * `scheme:` and any slashes or backslashes, up to the first `/`, `\`, `?` or
 * `#`. Read from the raw text rather than from `URL`, so a value `URL` refuses
 * to parse (`https://user:pw@`) or parses under another scheme
 * (`ftp://user:pw@host`) is still caught, and a schemeless `user@host` too.
 */
const RAW_AUTHORITY = /^(?:[a-z][a-z0-9+.-]*:)?[/\\]*([^/\\?#]*)/i

/**
 * Parse a `--public-url` / `--mcp-public-url` value: an absolute `http:` or
 * `https:` URL that names an origin only — no credentials, no query, no
 * fragment, and a path of `/` or none. Returns the normalized origin, or the
 * refusal worded in the CLI's language.
 *
 * Credentials are refused before anything else, by a refusal that takes no
 * value: no message this parser returns ever echoes a user name or password.
 */
export function parseMcpPublicUrl(raw: string): McpPublicUrl | string {
  const value = raw.trim()
  // Any `@` in the authority means userinfo, an empty one (`https://@h`) included.
  if (RAW_AUTHORITY.exec(value)?.[1]?.includes('@') === true) {
    return t('errors.mcp.publicUrl.credentials')
  }
  const parsed = parseHttpUrl(value)
  if (!(parsed instanceof URL)) {
    switch (parsed.problem) {
      case 'invalid':
        return t('errors.mcp.publicUrl.invalid', { value, example: EXAMPLE.mcpPublicUrl })
      case 'scheme':
        return t('errors.mcp.publicUrl.scheme', { value })
      default:
        return parsed.problem satisfies never
    }
  }
  // What `URL` itself saw: it also strips leading control characters the raw
  // check above reads as part of the scheme.
  if (parsed.username !== '' || parsed.password !== '') {
    return t('errors.mcp.publicUrl.credentials')
  }
  // `URL` drops an empty `?` / `#` from `search` / `hash`, so the raw text is
  // checked too: `https://h/?` is not an origin either.
  if (parsed.search !== '' || parsed.hash !== '' || /[?#]/.test(value)) {
    return t('errors.mcp.publicUrl.notOrigin', { value })
  }
  // An http(s) URL's path is never empty: a bare origin parses to `/`.
  if (parsed.pathname !== '/') {
    return t('errors.mcp.publicUrl.notOrigin', { value })
  }
  // A fully qualified name's trailing dot is dropped: a tunnel or proxy sends
  // `Host: mcp.example.com`, which the allowlist entry must equal. IPv6
  // literals are bracketed and never end in a dot.
  const hostname = parsed.hostname.endsWith('.') ? parsed.hostname.slice(0, -1) : parsed.hostname
  if (hostname === '') {
    return t('errors.mcp.publicUrl.invalid', { value, example: EXAMPLE.mcpPublicUrl })
  }
  // `URL.port` is empty for the scheme's default port, which the origin omits.
  const port = parsed.port === '' ? '' : `:${parsed.port}`
  return { origin: `${parsed.protocol}//${hostname}${port}`, hostname }
}
