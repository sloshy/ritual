import { Command, Option } from 'commander'
import { runHttpServer, runStdioServer } from '../mcp/run'

type McpTransport = 'stdio' | 'http'

type McpCommandOptions = {
  transport: McpTransport
  port: string
  host: string
  token?: string
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
    .option('-p, --port <number>', 'Port for the HTTP transport', '8765')
    .option('--host <address>', 'Host to bind for the HTTP transport', '127.0.0.1')
    .option('--token <secret>', 'Require this bearer token on the HTTP transport')
    .action(async (options: McpCommandOptions) => {
      if (options.transport === 'http') {
        await runHttpServer({
          port: parseInt(options.port, 10),
          host: options.host,
          token: options.token,
        })
        return
      }
      await runStdioServer()
    })
}
