import path from 'node:path'

export type ServeStaticSiteOptions = {
  distDir: string
  port: number
  hostname?: string
}

export type StaticSiteServer = ReturnType<typeof Bun.serve>

/** Bind addresses that mean "this machine", printed as `localhost` for a clickable URL. */
const LOOPBACK_HOSTS = new Set(['0.0.0.0', '::', '[::]', '127.0.0.1', '::1', 'localhost', ''])

/**
 * The URL to print for a server bound to `host`.
 *
 * A wildcard or loopback bind is printed as `localhost` — the address the person
 * reading the line will actually open — while a specific `--host` is printed as
 * given, since that is the only address the server answers on. The startup line
 * used to say `localhost` unconditionally, naming an address `--host 192.168.1.5`
 * is not listening on.
 */
export function serveUrl(host: string | undefined, port: number): string {
  const bound = (host ?? '').trim()
  if (LOOPBACK_HOSTS.has(bound)) return `http://localhost:${port}`
  // Bare IPv6 literals need brackets in a URL.
  const authority = bound.includes(':') && !bound.startsWith('[') ? `[${bound}]` : bound
  return `http://${authority}:${port}`
}

/** A response for the resolved file, or null when no file matches. */
export type StaticFileResult = Response | null

/** Serve the exact file at `pathname` under `distDir`, or null if it doesn't exist. */
export async function serveStaticFile(
  distDir: string,
  pathname: string,
): Promise<StaticFileResult> {
  const file = Bun.file(path.join(distDir, pathname))
  if (await file.exists()) {
    return new Response(file)
  }
  return null
}

/** Serve the SPA's `index.html` fallback, or null if the site isn't built. */
export async function serveSpaFallback(distDir: string): Promise<StaticFileResult> {
  const indexFile = Bun.file(path.join(distDir, 'index.html'))
  if (await indexFile.exists()) {
    return new Response(indexFile)
  }
  return null
}

/**
 * Serve a built static site directory with SPA fallback to `index.html`.
 */
export function serveStaticSite(options: ServeStaticSiteOptions): StaticSiteServer {
  const { distDir, port, hostname } = options
  return Bun.serve({
    port,
    hostname,
    async fetch(req) {
      const url = new URL(req.url)
      const response =
        (await serveStaticFile(distDir, url.pathname)) ?? (await serveSpaFallback(distDir))
      return response ?? new Response('Not Found', { status: 404 })
    },
    error(error) {
      return new Response(`<pre>${error}\n${error.stack}</pre>`, {
        headers: { 'Content-Type': 'text/html' },
        status: 500,
      })
    },
  })
}
