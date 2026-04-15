import { Command } from 'commander'
import path from 'node:path'
import fs from 'node:fs/promises'
import { startAdminServer } from '../admin/server'
import { getBundledAdminCss, getBundledAdminJs } from '../admin/bundled-assets'
import { getBaseDir } from '../base-dir'

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
      const adminDistDir = path.join(getBaseDir(), '.admin-dist')

      console.log('Preparing admin interface...')

      await fs.rm(adminDistDir, { recursive: true, force: true })
      await fs.mkdir(adminDistDir, { recursive: true })

      // Write pre-built admin SPA
      await Bun.write(path.join(adminDistDir, 'app.js'), getBundledAdminJs())

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

      console.log('Admin interface ready.')

      await startAdminServer({ port, host, distDir: adminDistDir })
    })
}
