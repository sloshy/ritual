import { Command, Option } from 'commander'
import { isLoopbackHost } from '../mcp/host'
import { runHttpServer, runStdioServer } from '../mcp/run'
import { resolveMcpToken } from '../mcp/token'
import { t } from '../i18n/t'
import { ExitCode, parsePort } from './scripting'

type McpTransport = 'stdio' | 'http'

type McpCommandOptions = {
  transport: McpTransport
  port: number
  host: string
  token?: string
  allowUnauthenticated?: boolean
}

type HttpOnlyOption = { name: string; flag: string }

/** Option names that only apply to the HTTP transport, with their flag spellings. */
const HTTP_ONLY_OPTIONS: readonly HttpOnlyOption[] = [
  { name: 'port', flag: '--port' },
  { name: 'host', flag: '--host' },
  { name: 'token', flag: '--token' },
  { name: 'allowUnauthenticated', flag: '--allow-unauthenticated' },
]

export function registerMcpCommand(program: Command): void {
  program
    .command('mcp')
    .description(t('help.mcp.description'))
    .addOption(
      new Option('--transport <type>', t('help.mcp.transport'))
        .choices(['stdio', 'http'])
        .default('stdio'),
    )
    .option('-p, --port <number>', t('help.mcp.port'), parsePort, 8765)
    .option('--host <address>', t('help.mcp.host'), '127.0.0.1')
    .option('--token <secret>', t('help.mcp.token'))
    .option('--allow-unauthenticated', t('help.mcp.allowUnauthenticated'))
    .action(async (options: McpCommandOptions, command: Command) => {
      if (options.transport === 'http') {
        const token = resolveMcpToken(options.token)
        if (!token) {
          if (!isLoopbackHost(options.host)) {
            if (!options.allowUnauthenticated) {
              console.error(t('cli.mcp.refusingUnauthenticated', { host: options.host }))
              process.exitCode = ExitCode.UsageError
              return
            }
            console.error(t('cli.mcp.unauthenticatedWarning', { host: options.host }))
          } else {
            console.error(t('cli.mcp.unauthenticatedLoopback', { host: options.host }))
          }
        }
        const server = await runHttpServer({
          port: options.port,
          host: options.host,
          auth: token ? { kind: 'bearer', token } : { kind: 'none' },
        })
        // The listener holds the process open; without this the HTTP leg had
        // strictly less teardown wiring than stdio (which installs its own).
        const shutdown = (): void => {
          void server
            .stop(true)
            .catch((error: unknown) => console.error(t('cli.mcp.httpTeardownFailed'), error))
        }
        process.once('SIGINT', shutdown)
        process.once('SIGTERM', shutdown)
        return
      }

      // stdio: the HTTP-only flags have no effect, so surface an explicit
      // warning instead of silently ignoring them.
      const ignoredFlags = HTTP_ONLY_OPTIONS.filter(
        ({ name }) => command.getOptionValueSource(name) === 'cli',
      ).map(({ flag }) => flag)
      if (ignoredFlags.length > 0) {
        console.error(t('cli.mcp.stdioIgnoredFlags', { flags: ignoredFlags.join(', ') }))
      }
      runStdioServer()
    })
}
