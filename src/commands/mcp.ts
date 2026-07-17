import { Command, Option } from 'commander'
import { runHttpServer, runStdioServer } from '../mcp/run'
import { resolveMcpToken } from '../mcp/token'
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

/** Whether a bind host is loopback-only (no exposure beyond the local machine). */
function isLoopbackHost(host: string): boolean {
  if (host === 'localhost' || host === '::1') return true
  return /^127(\.\d{1,3}){3}$/.test(host)
}

export function registerMcpCommand(program: Command): void {
  program
    .command('mcp')
    .description(
      'Start an MCP (Model Context Protocol) server exposing deck, collection, and wanted-list ' +
        'management to AI agents',
    )
    .addOption(
      new Option('--transport <type>', 'Transport to use')
        .choices(['stdio', 'http'])
        .default('stdio'),
    )
    .option('-p, --port <number>', 'Port for the HTTP transport', parsePort, 8765)
    .option('--host <address>', 'Host to bind for the HTTP transport', '127.0.0.1')
    .option(
      '--token <secret>',
      'Require this bearer token on the HTTP transport (or set RITUAL_MCP_TOKEN)',
    )
    .option(
      '--allow-unauthenticated',
      'Serve the HTTP transport without a bearer token on a non-loopback host',
    )
    .action(async (options: McpCommandOptions, command: Command) => {
      if (options.transport === 'http') {
        const token = resolveMcpToken(options.token)
        if (!token) {
          if (!isLoopbackHost(options.host)) {
            if (!options.allowUnauthenticated) {
              console.error(
                `Refusing to serve MCP without authentication on non-loopback host '${options.host}'. ` +
                  'Pass --token <secret> (or set RITUAL_MCP_TOKEN), or pass --allow-unauthenticated to override.',
              )
              process.exitCode = ExitCode.UsageError
              return
            }
            console.error(
              `Warning: serving MCP without authentication on '${options.host}' (--allow-unauthenticated).`,
            )
          } else {
            console.error(
              `No token set; serving unauthenticated MCP on loopback host '${options.host}'.`,
            )
          }
        }
        await runHttpServer({
          port: options.port,
          host: options.host,
          auth: token ? { kind: 'bearer', token } : { kind: 'none' },
        })
        return
      }

      // stdio: the HTTP-only flags have no effect, so surface an explicit
      // warning instead of silently ignoring them.
      const ignoredFlags = HTTP_ONLY_OPTIONS.filter(
        ({ name }) => command.getOptionValueSource(name) === 'cli',
      ).map(({ flag }) => flag)
      if (ignoredFlags.length > 0) {
        console.error(
          `Warning: ${ignoredFlags.join(', ')} only apply to --transport http and are ignored under stdio.`,
        )
      }
      await runStdioServer()
    })
}
