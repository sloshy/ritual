import { Command } from 'commander'
import path from 'node:path'
import fs from 'node:fs/promises'
import { startAdminServer } from '../admin/server'
import { getBaseDir } from '../base-dir'
import { ensureFreshCardCache } from '../cache/freshness'
import { refreshMode } from '../refresh'
import { isRunningFromSource } from '../runtime'
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
  theme?: string
  allowRefresh?: boolean
  allowRefreshNoBulk?: boolean
  refresh?: boolean
}

function buildIndexHtml(initialTheme: ThemeName): string {
  const attr = initialTheme === 'default' ? '' : ` data-theme="${initialTheme}"`
  // In source/dev mode, pull in the live-reload client so the browser refreshes when the dev
  // orchestrator restarts the server after a source edit. External (not inline) to satisfy CSP.
  const devReload = isRunningFromSource() ? '\n  <script src="__dev_reload.js"></script>' : ''
  return `<!DOCTYPE html>
<html lang="en"${attr}>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ritual Admin</title>
  <script>${themeBootstrapScript}</script>
  <link rel="stylesheet" href="styles.css">${devReload}
</head>
<body>
  <div id="app"></div>
  <script type="module" src="app.js"></script>
</body>
</html>`
}

async function buildAdminJs(srcDir: string, adminDistDir: string): Promise<void> {
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
    for (const log of result.logs) console.error(log)
    throw new Error('Admin SPA JS build failed')
  }
}

async function buildAdminCss(srcDir: string, adminDistDir: string): Promise<void> {
  const result = await Bun.build({
    entrypoints: [path.join(srcDir, 'admin', 'site', 'styles.css')],
    target: 'browser',
    minify: false,
  })
  if (!result.success) {
    for (const log of result.logs) console.error(log)
    throw new Error('Admin SPA CSS build failed')
  }
  const cssOutput = result.outputs.find((o) => o.path.endsWith('.css'))
  if (!cssOutput) throw new Error('Admin SPA CSS build produced no .css output')
  const compiled = await cssOutput.text()
  await Bun.write(path.join(adminDistDir, 'styles.css'), `${generateAllThemesCss()}\n${compiled}`)
}

export function registerAdminCommand(program: Command): void {
  program
    .command('admin')
    .description('Start the web admin interface')
    .option('-p, --port <number>', 'Port to serve on', '8080')
    .option('--host <address>', 'Host address to bind to', '0.0.0.0')
    .option(
      '--theme <name>',
      `Initial theme baked into the served HTML (${themeNames.join(', ')})`,
      'default',
    )
    .option('--allow-refresh', 'Refresh the card cache on startup without asking (bulk download)')
    .option(
      '--allow-refresh-no-bulk',
      'Accepted for parity with serve-site; admin only refreshes via bulk, so this skips it',
    )
    .option('--no-refresh', 'Skip the card cache refresh on startup; use cached data as-is')
    .action(async (options: AdminCommandOptions) => {
      const port = parseInt(options.port, 10)
      const host = options.host
      const adminDistDir = path.join(getBaseDir(), '.admin-dist')

      const themeName = resolveThemeName(options.theme)

      console.log('Preparing admin interface...')

      await ensureFreshCardCache(refreshMode(options))

      await fs.rm(adminDistDir, { recursive: true, force: true })
      await fs.mkdir(adminDistDir, { recursive: true })

      if (isRunningFromSource()) {
        const adminSrcDir = path.join(import.meta.dir, '..', '..', 'src')
        await Promise.all([
          buildAdminJs(adminSrcDir, adminDistDir),
          buildAdminCss(adminSrcDir, adminDistDir),
        ])
      } else {
        // Lazy import: keeps `.compiled.{js,css}` text imports out of the
        // source-mode module graph (those files are gitignored). The path must
        // stay a literal string so `bun build --compile` can embed the module.
        const { getBundledAdminCss, getBundledAdminJs } = await import('../admin/bundled-assets')
        await Bun.write(path.join(adminDistDir, 'app.js'), getBundledAdminJs())
        await Bun.write(
          path.join(adminDistDir, 'styles.css'),
          `${generateAllThemesCss()}\n${getBundledAdminCss()}`,
        )
      }

      await Bun.write(path.join(adminDistDir, 'index.html'), buildIndexHtml(themeName))

      console.log('Admin interface ready.')

      await startAdminServer({ port, host, distDir: adminDistDir })
    })
}
