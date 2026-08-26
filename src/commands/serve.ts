import path from 'node:path'
import type { Command, Option } from 'commander'
import { getErrorMessage } from '../util/errors'
import { startSiteServer } from '../serve/server'
import { sellModeWarning, warmCardKingdomFeed } from '../cardkingdom'
import { cardCacheReady, warmSiteCache } from '../serve/warm'
import { resolveOutDir } from '../site/dist-dir'
import {
  applyBuildSiteOptions,
  resolveBuildLocale,
  runBuildSite,
  type BuildSiteOptions,
} from './build-site'
import { applySellModeOverride, SELL_MODE_OPTION_NAME } from './sell-mode-flag'
import { ExitCode, parsePort } from './scripting'
import { serveStaticSite, serveUrl } from './serve-helpers'
import { t } from '../i18n/t'

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
    .description(t('help.serve.description'))
    .option('-p, --port <number>', t('help.serve.port'), parsePort, 3000)
    .option('--host <address>', t('help.serve.host'), '0.0.0.0')
    .option('--build', t('help.serve.build'))
    .option('--api', t('help.serve.api'))

  // Everything applyBuildSiteOptions registers only matters under --build.
  // Diffing the option list around the call keeps the build-only set in sync
  // with the shared build surface automatically.
  const serveOptionCount = command.options.length
  applyBuildSiteOptions(command)
  const buildOnlyOptions: readonly Option[] = command.options.slice(serveOptionCount)

  command.action(async (options: ServeCliOptions) => {
    // Set before anything reads sell mode — the build below, the startup buylist
    // warm, and every live request's `getSiteSellMode` read all follow it.
    applySellModeOverride(options)

    if (options.build !== true) {
      const givenBuildFlags = buildOnlyOptions
        .filter((option) => command.getOptionValueSource(option.attributeName()) === 'cli')
        // --refresh doubles as the cache-warming policy under --api, so it is
        // valid without --build there; --sell-mode likewise, since only the live
        // server reads sell mode per request — a plain `serve` hands out
        // pre-built files and nothing in it would ever consult the override, so
        // the flag there is an inert no-op and stays a usage error. --out-dir
        // names the directory to serve, meaningful with or without a build.
        .filter(
          (option) =>
            !(
              options.api === true &&
              (option.attributeName() === 'refresh' ||
                option.attributeName() === SELL_MODE_OPTION_NAME)
            ),
        )
        .filter((option) => option.attributeName() !== 'outDir')
        .map((option) => option.long ?? option.name())
      if (givenBuildFlags.length > 0) {
        console.error(
          t('cli.serve.buildFlagsIgnored', {
            count: givenBuildFlags.length,
            flags: givenBuildFlags.join(', '),
          }),
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
      console.log(t('cli.serve.building'))
      try {
        // ServeCliOptions extends BuildSiteOptions, so the whole options
        // object doubles as the build options (the extra serve fields are
        // ignored by the build). `--locale` is the one field commander does
        // not put here — see `resolveBuildLocale`.
        await runBuildSite({ ...options, locale: resolveBuildLocale(command, options) })
      } catch (err) {
        console.error(t('cli.serve.buildFailed', { reason: getErrorMessage(err) }))
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
        t('cli.serve.noBuiltSite', {
          dir: distDir,
          outDirFlag: options.outDir === undefined ? '' : ` --out-dir ${options.outDir}`,
        }),
      )
      process.exitCode = ExitCode.RuntimeError
      return
    }

    if (options.api === true) {
      if (options.cacheImages === true) {
        console.warn(t('cli.serve.cacheImagesNote'))
      }
      // Live payloads are computed from the card cache with no Scryfall
      // fallback, so the server holds itself to the same cache freshness a build
      // does — over the same cards, under the same --refresh policy. A build
      // that just ran applied those gates already, so this only reads the result
      // rather than asking the same questions twice.
      const mode = options.refresh ?? 'ask'
      const ready = build ? await cardCacheReady() : (await warmSiteCache(mode)).ready
      if (!ready) {
        console.warn(t('cli.serve.emptyCardCache'))
      }
      // Sell mode quotes from the Card Kingdom feed, and the quote routes never
      // download (they are unauthenticated and CORS-open). Startup is the only
      // moment this process can keep a day-old feed current, so it does.
      const buylistWarning = sellModeWarning(await warmCardKingdomFeed(mode))
      if (buylistWarning !== undefined) console.warn(buylistWarning)
      console.log(t('cli.serve.servingWithApi', { dir: distDir, url: serveUrl(host, port) }))
      startSiteServer({ distDir, port, hostname: host })
      return
    }

    console.log(t('cli.serve.serving', { dir: distDir, url: serveUrl(host, port) }))
    serveStaticSite({ distDir, port, hostname: host })
  })
}
