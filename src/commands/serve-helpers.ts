import path from 'node:path'

export type ServeStaticSiteOptions = {
  distDir: string
  port: number
  hostname?: string
}

export type StaticSiteServer = ReturnType<typeof Bun.serve>

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
