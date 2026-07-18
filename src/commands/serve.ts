import path from 'node:path'
import type { Command, Option } from 'commander'
import { getBaseDir } from '../base-dir'
import { getErrorMessage } from '../errors'
import { applyBuildSiteOptions, runBuildSite, type BuildSiteOptions } from './build-site'
import { ExitCode, parsePort } from './scripting'
import { serveStaticSite } from './serve-helpers'

type ServeCliOptions = BuildSiteOptions & {
  port: number
  host: string
  build?: boolean
}

export function registerServeCommand(program: Command): void {
  const command = program
    .command('serve')
    .description('Serve the generated static site, optionally building it first')
    .option('-p, --port <number>', 'Port to serve on', parsePort, 3000)
    .option('--host <address>', 'Host address to bind to', '0.0.0.0')
    .option('--build', 'Build the site before serving it')

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
    console.log(`Serving site from ${distDir} at http://localhost:${port}...`)
    serveStaticSite({ distDir, port, hostname: host })
  })
}
