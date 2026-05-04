import { Command } from 'commander'
import path from 'node:path'
import fs from 'node:fs/promises'
import { startAdminServer } from '../admin/server'
import { getBundledAdminCss, getBundledAdminJs } from '../admin/bundled-assets'
import { getBaseDir } from '../base-dir'
import { ensureFreshCardCache } from '../cache/freshness'

type AdminCommandOptions = {
  port: string
  host: string
  dev: boolean
}

type RebuildFlags = { js: boolean; css: boolean }

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

async function buildAdminJs(srcDir: string, adminDistDir: string): Promise<boolean> {
  const { SolidPlugin } = await import('@dschz/bun-plugin-solid')
  const result = await Bun.build({
    entrypoints: [path.join(srcDir, 'admin', 'site', 'app.tsx')],
    outdir: adminDistDir,
    target: 'browser',
    format: 'esm',
    naming: 'app.js',
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [SolidPlugin()],
  })
  if (!result.success) {
    console.error('Admin JS build failed:')
    for (const log of result.logs) console.error(log)
    return false
  }
  return true
}

async function buildAdminCss(srcDir: string, adminDistDir: string): Promise<boolean> {
  const result = await Bun.build({
    entrypoints: [path.join(srcDir, 'admin', 'site', 'styles.css')],
    outdir: adminDistDir,
    target: 'browser',
    naming: 'styles.css',
    minify: false,
  })
  if (!result.success) {
    console.error('Admin CSS build failed:')
    for (const log of result.logs) console.error(log)
    return false
  }
  return true
}

export function registerAdminCommand(program: Command) {
  program
    .command('admin')
    .description('Start the web admin interface')
    .option('-p, --port <number>', 'Port to serve on', '8080')
    .option('--host <address>', 'Host address to bind to', '0.0.0.0')
    .option('--dev', 'Rebuild admin SPA from source on file changes')
    .action(async (options: AdminCommandOptions) => {
      const port = parseInt(options.port, 10)
      const host = options.host
      const adminDistDir = path.join(getBaseDir(), '.admin-dist')

      console.log('Preparing admin interface...')

      await ensureFreshCardCache()

      await fs.rm(adminDistDir, { recursive: true, force: true })
      await fs.mkdir(adminDistDir, { recursive: true })

      const adminSrcDir = path.join(import.meta.dir, '..', '..', 'src')

      if (options.dev) {
        console.log('Building admin SPA from source...')
        const [jsOk, cssOk] = await Promise.all([
          buildAdminJs(adminSrcDir, adminDistDir),
          buildAdminCss(adminSrcDir, adminDistDir),
        ])
        if (!jsOk || !cssOk) process.exit(1)
      } else {
        await Bun.write(path.join(adminDistDir, 'app.js'), getBundledAdminJs())
        await Bun.write(path.join(adminDistDir, 'styles.css'), getBundledAdminCss())
      }

      await Bun.write(path.join(adminDistDir, 'index.html'), indexHtml)

      if (options.dev) {
        const watcher = await import('@parcel/watcher')

        let building = false
        let pending: RebuildFlags | null = null

        const runRebuild = async (flags: RebuildFlags): Promise<void> => {
          building = true
          const rebuilds: Promise<boolean>[] = []
          if (flags.css) rebuilds.push(buildAdminCss(adminSrcDir, adminDistDir))
          if (flags.js) rebuilds.push(buildAdminJs(adminSrcDir, adminDistDir))
          const results = await Promise.all(rebuilds)
          if (results.every(Boolean)) {
            const parts = [flags.js && 'js', flags.css && 'css'].filter(Boolean).join('+')
            console.log(`[dev] Rebuilt (${parts})`)
          }
          if (pending) {
            const next = pending
            pending = null
            await runRebuild(next)
          } else {
            building = false
          }
        }

        const watchDir = path.join(adminSrcDir)
        await watcher.default.subscribe(watchDir, (err, events) => {
          if (err) {
            console.error('Watcher error:', err)
            return
          }

          const hasCss = events.some((e) => e.path.endsWith('.css'))
          const hasJs = events.some((e) => e.path.endsWith('.ts') || e.path.endsWith('.tsx'))
          if (!hasCss && !hasJs) return

          const flags: RebuildFlags = { js: hasJs, css: hasCss }
          if (!building) {
            runRebuild(flags)
          } else {
            pending = {
              js: (pending?.js ?? false) || flags.js,
              css: (pending?.css ?? false) || flags.css,
            }
          }
        })

        console.log(`[dev] Watching ${watchDir} for changes...`)
      }

      console.log('Admin interface ready.')

      await startAdminServer({ port, host, distDir: adminDistDir })
    })
}
