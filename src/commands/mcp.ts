import { Command, Option } from 'commander'
import { unauthenticatedExposure, type UnauthenticatedExposure } from '../mcp/host'
import { parseMcpPublicUrl, type McpPublicUrl } from '../mcp/public-url'
import { runHttpServer, runStdioServer } from '../mcp/run'
import { resolveMcpToken } from '../mcp/token'
import { t } from '../i18n/t'
import { addSellModeOption, applySellModeOverride, parsedFlag, parsePort } from '../cli/options'
import { ExitCode } from '../util/errors'
import { CONFIG_KEY, ENV_VAR, EXAMPLE, FLAG, flagValue } from '../util/cli-tokens'

type McpTransport = 'stdio' | 'http'

type McpCommandOptions = {
  transport: McpTransport
  port: number
  host: string
  token?: string
  /**
   * The external origin a tunnel or reverse proxy forwards to this bind. Its
   * hostname joins the loopback DNS-rebinding allowlist, and it marks the
   * endpoint as exposed, so it needs a token like a non-loopback host.
   */
  publicUrl?: McpPublicUrl
  allowUnauthenticated?: boolean
  /**
   * Answer the sell/buylist tools for this run whatever `site.sellMode` says
   * (enable-only; absent follows the config). Those four tools reuse the admin
   * route handlers, which 404 when sell mode is off — this is the session
   * opt-in for an agent that wants Card Kingdom prices without a config write.
   */
  sellMode?: boolean
}

type HttpOnlyOption = { name: string; flag: string }

/** Option names that only apply to the HTTP transport, with their flag spellings. */
const HTTP_ONLY_OPTIONS: readonly HttpOnlyOption[] = [
  { name: 'port', flag: FLAG.port },
  { name: 'host', flag: FLAG.host },
  { name: 'token', flag: FLAG.token },
  { name: 'publicUrl', flag: FLAG.publicUrl },
  { name: 'allowUnauthenticated', flag: FLAG.allowUnauthenticated },
]

/** The flags a refusal names as its ways out. */
type RefusalRemedyParams = {
  tokenFlag: string
  envVar: string
  allowUnauthenticatedFlag: string
}

/** The refusal printed for an exposed tokenless endpoint without `--allow-unauthenticated`. */
function exposureRefusal(exposure: UnauthenticatedExposure): string {
  const remedy: RefusalRemedyParams = {
    tokenFlag: flagValue(FLAG.token, '<secret>'),
    envVar: ENV_VAR.mcpToken,
    allowUnauthenticatedFlag: FLAG.allowUnauthenticated,
  }
  switch (exposure.reason) {
    case 'host':
      return t('cli.mcp.refusingUnauthenticated', { host: exposure.exposedAt, ...remedy })
    case 'public-url':
      return t('cli.mcp.refusingUnauthenticatedPublicUrl', {
        url: exposure.exposedAt,
        publicUrlFlag: FLAG.publicUrl,
        ...remedy,
      })
    default:
      return exposure.reason satisfies never
  }
}

export function registerMcpCommand(program: Command): void {
  const mcp = program
    .command('mcp')
    .description(t('help.mcp.description'))
    .addOption(
      new Option('--transport <type>', t('help.mcp.transport'))
        .choices(['stdio', 'http'])
        .default('stdio'),
    )
    .option('-p, --port <number>', t('help.mcp.port'), parsePort, 8765)
    .option('--host <address>', t('help.mcp.host'), '127.0.0.1')
    .option('--token <secret>', t('help.mcp.token', { envVar: ENV_VAR.mcpToken }))
    .option(
      '--public-url <url>',
      t('help.mcp.publicUrl', { example: EXAMPLE.mcpPublicUrl }),
      parsedFlag(parseMcpPublicUrl),
    )
    .option(
      '--allow-unauthenticated',
      t('help.mcp.allowUnauthenticated', { publicUrlFlag: FLAG.publicUrl }),
    )
    .action(async (options: McpCommandOptions, command: Command) => {
      // Set before either transport starts serving, so the gated sell routes
      // the tools call agree with the flag for the whole session. Applies to
      // both transports, so it is not one of the HTTP-only flags below.
      applySellModeOverride(options)

      if (options.transport === 'http') {
        const token = resolveMcpToken(options.token)
        if (!token) {
          const exposure = unauthenticatedExposure(options.host, options.publicUrl)
          if (exposure !== undefined) {
            if (!options.allowUnauthenticated) {
              console.error(exposureRefusal(exposure))
              process.exitCode = ExitCode.UsageError
              return
            }
            console.error(
              t('cli.mcp.unauthenticatedWarning', {
                host: exposure.exposedAt,
                flag: FLAG.allowUnauthenticated,
              }),
            )
          } else {
            console.error(t('cli.mcp.unauthenticatedLoopback', { host: options.host }))
          }
        }
        const server = await runHttpServer({
          port: options.port,
          host: options.host,
          auth: token ? { kind: 'bearer', token } : { kind: 'none' },
          publicUrl: options.publicUrl,
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
        console.error(
          t('cli.mcp.stdioIgnoredFlags', {
            flags: ignoredFlags.join(', '),
            flag: flagValue(FLAG.transport, 'http'),
          }),
        )
      }
      await runStdioServer()
    })
  // The shared `--sell-mode` flag; registered through the same helper as
  // `build-site`, `serve` and `admin` so the four can never describe the same
  // switch differently. Commander collects options at parse time, so this sits
  // beside the built command rather than mid-chain.
  addSellModeOption(mcp, t('help.mcp.sellMode', { configKey: CONFIG_KEY.siteSellMode }))
}
