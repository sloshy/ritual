import { Command } from 'commander'
import path from 'node:path'
import fs from 'node:fs/promises'
import { watch } from 'node:fs'
import { startAdminServer } from '../admin/server'
import { getBundledAdminCss, getBundledAdminJs } from '../admin/bundled-assets'
import { getBaseDir } from '../base-dir'
import { ensureFreshCardCache } from '../cache/freshness'
import { createRebuildQueue } from './rebuild-queue'
import {
  generateAllThemesCss,
  resolveThemeName,
  themeBootstrapScript,
  themeNames,
  type ThemeName,
} from '../themes'

type AdminCommandOptions = {
  port: string
  host: string
  dev: boolean
  theme?: string
}

type RebuildFlags = { js: boolean; css: boolean }

function buildIndexHtml(initialTheme: ThemeName): string {
  const attr = initialTheme === 'default' ? '' : ` data-theme="${initialTheme}"`
  return `<!DOCTYPE html>
<html lang="en"${attr}>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ritual Admin</title>
  <script>${themeBootstrapScript}</script>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div id="app"></div>
  <script type="module" src="app.js"></script>
</body>
</html>`
}

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
    target: 'browser',
    minify: false,
  })
  if (!result.success) {
    console.error('Admin CSS build failed:')
    for (const log of result.logs) console.error(log)
    return false
  }
  const cssOutput = result.outputs.find((o) => o.path.endsWith('.css'))
  if (!cssOutput) {
    console.error('Admin CSS build produced no .css output')
    return false
  }
  const compiled = await cssOutput.text()
  await Bun.write(path.join(adminDistDir, 'styles.css'), `${generateAllThemesCss()}\n${compiled}`)
  return true
}

export function registerAdminCommand(program: Command): void {
  program
    .command('admin')
    .description('Start the web admin interface')
    .option('-p, --port <number>', 'Port to serve on', '8080')
    .option('--host <address>', 'Host address to bind to', '0.0.0.0')
    .option('--dev', 'Rebuild admin SPA from source on file changes')
    .option(
      '--theme <name>',
      `Initial theme baked into the served HTML (${themeNames.join(', ')})`,
      'default',
    )
    .action(async (options: AdminCommandOptions) => {
      const port = parseInt(options.port, 10)
      const host = options.host
      const adminDistDir = path.join(getBaseDir(), '.admin-dist')

      const themeName = resolveThemeName(options.theme)

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
        await Bun.write(
          path.join(adminDistDir, 'styles.css'),
          `${generateAllThemesCss()}\n${getBundledAdminCss()}`,
        )
      }

      await Bun.write(path.join(adminDistDir, 'index.html'), buildIndexHtml(themeName))

      if (options.dev) {
        const queue = createRebuildQueue<RebuildFlags>({
          rebuild: async (flags) => {
            const rebuilds: Promise<boolean>[] = []
            if (flags.css) rebuilds.push(buildAdminCss(adminSrcDir, adminDistDir))
            if (flags.js) rebuilds.push(buildAdminJs(adminSrcDir, adminDistDir))
            const results = await Promise.all(rebuilds)
            if (results.every(Boolean)) {
              const parts = [flags.js && 'js', flags.css && 'css'].filter(Boolean).join('+')
              console.log(`[dev] Rebuilt (${parts})`)
            }
          },
          merge: (pending, incoming) => ({
            js: pending.js || incoming.js,
            css: pending.css || incoming.css,
          }),
          onError: (err) => {
            console.error('[dev] Rebuild error:', err)
          },
        })

        watch(adminSrcDir, { recursive: true }, (_, filename) => {
          if (!filename) return
          const hasCss = filename.endsWith('.css')
          const hasJs = filename.endsWith('.ts') || filename.endsWith('.tsx')
          if (!hasCss && !hasJs) return
          queue.trigger({ js: hasJs, css: hasCss })
        })

        console.log(`[dev] Watching ${adminSrcDir} for changes...`)
      }

      console.log('Admin interface ready.')

      await startAdminServer({ port, host, distDir: adminDistDir })
    })
}
