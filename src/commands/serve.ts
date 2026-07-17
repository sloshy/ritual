import { Command } from 'commander'
import path from 'node:path'
import { getBaseDir } from '../base-dir'
import { serveStaticSite } from './serve-helpers'
import { parsePort } from './scripting'

type ServeCliOptions = {
  port: number
}

export function registerServeCommand(program: Command): void {
  program
    .command('serve')
    .description('Serve the generated static site')
    .option('-p, --port <number>', 'Port to serve on', parsePort, 3000)
    .action((options: ServeCliOptions) => {
      const distDir = path.join(getBaseDir(), 'dist')
      const { port } = options

      console.log(`Serving site from ${distDir} at http://localhost:${port}...`)
      serveStaticSite({ distDir, port })
    })
}
