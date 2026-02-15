import { Command } from 'commander'
import path from 'path'

export function registerServeCommand(program: Command) {
  program
    .command('serve')
    .description('Serve the generated static site')
    .option('-p, --port <number>', 'Port to serve on', '3000')
    .action((options) => {
      const distDir = path.join(process.cwd(), 'dist')
      const port = parseInt(options.port)

      console.log(`Serving site from ${distDir} at http://localhost:${port}...`)

      Bun.serve({
        port: port,
        async fetch(req) {
          const url = new URL(req.url)
          let filePath = path.join(distDir, url.pathname)

          if (filePath.endsWith('/') || (await Bun.file(filePath).exists()) === false) {
            if (url.pathname.endsWith('/')) {
              filePath = path.join(distDir, url.pathname, 'index.html')
            } else if (path.extname(filePath) === '') {
              const htmlPath = filePath + '.html'
              if (await Bun.file(htmlPath).exists()) {
                filePath = htmlPath
              }
            }
          }

          const file = Bun.file(filePath)
          if (await file.exists()) {
            return new Response(file)
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
    })
}
