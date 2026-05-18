import path from 'node:path'

export type ServeStaticSiteOptions = {
  distDir: string
  port: number
  hostname?: string
}

export type StaticSiteServer = ReturnType<typeof Bun.serve>

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
      const filePath = path.join(distDir, url.pathname)

      const file = Bun.file(filePath)
      if (await file.exists()) {
        return new Response(file)
      }

      const indexFile = Bun.file(path.join(distDir, 'index.html'))
      if (await indexFile.exists()) {
        return new Response(indexFile)
      }

      return new Response('Not Found', { status: 404 })
    },
    error(error) {
      return new Response(`<pre>${error}\n${error.stack}</pre>`, {
        headers: { 'Content-Type': 'text/html' },
        status: 500,
      })
    },
  })
}
