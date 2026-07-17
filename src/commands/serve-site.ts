import { Command } from 'commander'
import path from 'node:path'
import { getBaseDir } from '../base-dir'
import { getErrorMessage } from '../errors'
import { applyBuildSiteOptions, runBuildSite, type BuildSiteOptions } from './build-site'
import { ExitCode, parsePort } from './scripting'
import { serveStaticSite } from './serve-helpers'

type ServeSiteCliOptions = BuildSiteOptions & {
  port: number
  host: string
}

export function registerServeSiteCommand(program: Command): void {
  const command = program
    .command('serve-site')
    .description('Build the static site and serve it')
    .option('-p, --port <number>', 'Port to serve on', parsePort, 3000)
    .option('--host <address>', 'Host address to bind to', '0.0.0.0')

  applyBuildSiteOptions(command).action(async (options: ServeSiteCliOptions) => {
    const port = options.port
    const hostname = options.host

    const buildOptions: BuildSiteOptions = {
      verbose: options.verbose,
      cacheImages: options.cacheImages,
      decks: options.decks,
      collections: options.collections,
      wantedLists: options.wantedLists,
      currencies: options.currencies,
      allowRefresh: options.allowRefresh,
      allowRefreshNoBulk: options.allowRefreshNoBulk,
      refresh: options.refresh,
      theme: options.theme,
      themeFile: options.themeFile,
    }

    console.log('Building site...')
    try {
      await runBuildSite(buildOptions)
    } catch (err) {
      console.error('Initial build failed:', getErrorMessage(err))
      process.exitCode = ExitCode.RuntimeError
      return
    }
    // The build reports its own failures by setting the exit code; don't start
    // the server on a failed build.
    if (typeof process.exitCode === 'number' && process.exitCode !== 0) {
      return
    }

    const distDir = path.join(getBaseDir(), 'dist')
    console.log(`Serving site from ${distDir} at http://localhost:${port}...`)
    serveStaticSite({ distDir, port, hostname })
  })
}
