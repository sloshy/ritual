import path from 'node:path'
import type { Command, Option } from 'commander'
import { getBaseDir } from '../base-dir'
import { ensureFreshCardCache } from '../cache/freshness'
import { getErrorMessage } from '../errors'
import { startSiteServer } from '../serve/server'
import { applyBuildSiteOptions, runBuildSite, type BuildSiteOptions } from './build-site'
import { ExitCode, parsePort } from './scripting'
import { serveStaticSite } from './serve-helpers'

type ServeCliOptions = BuildSiteOptions & {
  port: number
  host: string
  build?: boolean
  api?: boolean
}

export function registerServeCommand(program: Command): void {
  const command = program
    .command('serve')
    .description('Serve the generated static site, optionally building it first')
    .option('-p, --port <number>', 'Port to serve on', parsePort, 3000)
    .option('--host <address>', 'Host address to bind to', '0.0.0.0')
    .option('--build', 'Build the site before serving it')
    .option(
      '--api',
      'Serve a live read-only data API alongside the site: list data is computed ' +
        'from the markdown files on request, and card search uses the card cache ' +
        'with the same term matching as the admin editor',
    )

  // Everything applyBuildSiteOptions registers only matters under --build.
  // Diffing the option list around the call keeps the build-only set in sync
  // with the shared build surface automatically.
  const serveOptionCount = command.options.length
  applyBuildSiteOptions(command)
  const buildOnlyOptions: readonly Option[] = command.options.slice(serveOptionCount)

  command.action(async (options: ServeCliOptions) => {
    if (options.build !== true) {
      const givenBuildFlags = buildOnlyOptions
        .filter((option) => command.getOptionValueSource(option.attributeName()) === 'cli')
        // --refresh doubles as the cache-warming policy under --api, so it is
        // valid without --build there.
        .filter((option) => !(options.api === true && option.attributeName() === 'refresh'))
        .map((option) => option.long ?? option.name())
      if (givenBuildFlags.length > 0) {
        console.error(
          `${givenBuildFlags.join(', ')} only appl${givenBuildFlags.length === 1 ? 'ies' : 'y'} ` +
            `when building; add --build to build the site before serving.`,
        )
        process.exitCode = ExitCode.UsageError
        return
      }
    } else {
      console.log('Building site...')
      try {
        // ServeCliOptions extends BuildSiteOptions, so the whole options
        // object doubles as the build options (the extra serve fields are
        // ignored by the build).
        await runBuildSite(options)
      } catch (err) {
        console.error('Build failed:', getErrorMessage(err))
        process.exitCode = ExitCode.RuntimeError
        return
      }
      // The build reports some failures by setting the exit code instead of
      // throwing; don't start the server on a failed build.
      if (typeof process.exitCode === 'number' && process.exitCode !== 0) {
        return
      }
    }

    const { port, host } = options
    const distDir = path.join(getBaseDir(), 'dist')

    if (options.api === true) {
      if (!(await Bun.file(path.join(distDir, 'index.html')).exists())) {
        console.error('No built site found. Run with --build (or `ritual build-site`) first.')
        process.exitCode = ExitCode.UsageError
        return
      }
      if (options.cacheImages === true) {
        console.warn(
          'Note: live data always uses Scryfall image URLs; --cache-images only affects static assets.',
        )
      }
      // Warm the card cache like `ritual admin` does — autocomplete matches
      // against the cached card names.
      const freshness = await ensureFreshCardCache(options.refresh)
      if (!freshness.ready) {
        console.warn(
          'Card cache is empty — card search will return no results until the cache is preloaded.',
        )
      }
      console.log(`Serving site + live API from ${distDir} at http://localhost:${port}...`)
      startSiteServer({ distDir, port, hostname: host })
      return
    }

    console.log(`Serving site from ${distDir} at http://localhost:${port}...`)
    serveStaticSite({ distDir, port, hostname: host })
  })
}
