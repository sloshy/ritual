import path from 'node:path'
import type { Command, Option } from 'commander'
import { getErrorMessage } from '../errors'
import { startSiteServer } from '../serve/server'
import { sellModeWarning, warmCardKingdomFeed } from '../cardkingdom'
import { cardCacheReady, warmSiteCache } from '../serve/warm'
import { resolveOutDir } from '../site/dist-dir'
import { applyBuildSiteOptions, runBuildSite, type BuildSiteOptions } from './build-site'
import { ExitCode, parsePort } from './scripting'
import { serveStaticSite, serveUrl } from './serve-helpers'

export type ServeCliOptions = BuildSiteOptions & {
  port: number
  host: string
  build?: boolean
  api?: boolean
}

/** The flags the build-before-serving decision reads. */
export type BuildDecision = Pick<ServeCliOptions, 'build' | 'api'>

/**
 * Whether to build the site before serving it.
 *
 * `--build` always builds. Under `--api` the app shell is a prerequisite the
 * server can satisfy itself — the data is served live, so an unbuilt directory
 * is a missing shell rather than missing content, and refusing to start over it
 * helps nobody. Plain `serve` never builds: there, the build *is* the content,
 * and silently generating one would hide that the user meant to build first.
 */
export function shouldBuildBeforeServing(options: BuildDecision, siteIsBuilt: boolean): boolean {
  if (options.build === true) return true
  return options.api === true && !siteIsBuilt
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
        // valid without --build there; --out-dir names the directory to serve,
        // which is meaningful with or without a build.
        .filter((option) => !(options.api === true && option.attributeName() === 'refresh'))
        .filter((option) => option.attributeName() !== 'outDir')
        .map((option) => option.long ?? option.name())
      if (givenBuildFlags.length > 0) {
        console.error(
          `${givenBuildFlags.join(', ')} only appl${givenBuildFlags.length === 1 ? 'ies' : 'y'} ` +
            `when building; add --build to build the site before serving.`,
        )
        process.exitCode = ExitCode.UsageError
        return
      }
    }

    // Resolved once and shared by the build and the server: `--build --out-dir X`
    // used to publish into X and then serve a hard-coded `dist/`, i.e. serve the
    // *previous* build. Same rule as `ritual build-site`, same module.
    const outDir = resolveOutDir(options.outDir)
    if (!outDir.ok) {
      console.error(outDir.error)
      process.exitCode = ExitCode.UsageError
      return
    }
    const distDir = outDir.dir

    const hasBuiltSite = async (): Promise<boolean> =>
      await Bun.file(path.join(distDir, 'index.html')).exists()

    const build = shouldBuildBeforeServing(options, await hasBuiltSite())

    if (build) {
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

    // Both modes serve the same tree, so both refuse the same way: a directory
    // with no index.html answers every request with a bare 404, which reads as a
    // broken site rather than an unbuilt one.
    if (!(await hasBuiltSite())) {
      console.error(
        `No built site found in ${distDir}. Build it first with \`ritual build-site${
          options.outDir === undefined ? '' : ` --out-dir ${options.outDir}`
        }\`, or re-run this command with --build.`,
      )
      process.exitCode = ExitCode.RuntimeError
      return
    }

    if (options.api === true) {
      if (options.cacheImages === true) {
        console.warn(
          'Note: live data always uses Scryfall image URLs; --cache-images only affects static assets.',
        )
      }
      // Live payloads are computed from the card cache with no Scryfall
      // fallback, so the server holds itself to the same cache freshness a build
      // does — over the same cards, under the same --refresh policy. A build
      // that just ran applied those gates already, so this only reads the result
      // rather than asking the same questions twice.
      const mode = options.refresh ?? 'ask'
      const ready = build ? await cardCacheReady() : (await warmSiteCache(mode)).ready
      if (!ready) {
        console.warn(
          'Card cache is empty — card search will return no results until the cache is preloaded.',
        )
      }
      // Sell mode quotes from the Card Kingdom feed, and the quote routes never
      // download (they are unauthenticated and CORS-open). Startup is the only
      // moment this process can keep a day-old feed current, so it does.
      const buylistWarning = sellModeWarning(await warmCardKingdomFeed(mode))
      if (buylistWarning !== undefined) console.warn(buylistWarning)
      console.log(`Serving site + live API from ${distDir} at ${serveUrl(host, port)}...`)
      startSiteServer({ distDir, port, hostname: host })
      return
    }

    console.log(`Serving site from ${distDir} at ${serveUrl(host, port)}...`)
    serveStaticSite({ distDir, port, hostname: host })
  })
}
