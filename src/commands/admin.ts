import { Command } from 'commander'
import path from 'node:path'
import fs from 'node:fs/promises'
import { startAdminServer } from '../admin/server'
import { getBundledAdminCss } from '../admin/bundled-assets'

type AdminCommandOptions = {
  port: string
  host: string
}

export function registerAdminCommand(program: Command) {
  program
    .command('admin')
    .description('Start the web admin interface')
    .option('-p, --port <number>', 'Port to serve on', '8080')
    .option('--host <address>', 'Host address to bind to', '0.0.0.0')
    .action(async (options: AdminCommandOptions) => {
      const port = parseInt(options.port, 10)
      const host = options.host
      const adminDistDir = path.join(process.cwd(), '.admin-dist')

      console.log('Building admin interface...')

      await fs.rm(adminDistDir, { recursive: true, force: true })
      await fs.mkdir(adminDistDir, { recursive: true })

      // Bundle admin SPA
      const buildResult = await Bun.build({
        entrypoints: [path.join(import.meta.dir, '../admin/site/app.tsx')],
        outdir: adminDistDir,
        target: 'browser',
        format: 'esm',
        minify: true,
        naming: 'app.js',
        define: {
          'process.env.NODE_ENV': '"production"',
        },
        jsx: {
          runtime: 'automatic',
          importSource: 'preact',
        },
      })

      if (!buildResult.success) {
        console.error('Admin SPA build failed:')
        for (const log of buildResult.logs) {
          console.error(log)
        }
        process.exit(1)
      }

      // Write bundled CSS (pre-compiled at build time)
      const stylesOutput = path.join(adminDistDir, 'styles.css')
      await Bun.write(stylesOutput, getBundledAdminCss())

      // Generate index.html
      const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ritual Admin</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div id="app"></div>
  <script type="module" src="app.js"></script>
</body>
</html>`
      await Bun.write(path.join(adminDistDir, 'index.html'), indexHtml)

      console.log('Admin interface built successfully.')

      await startAdminServer({ port, host, distDir: adminDistDir })
    })
}
