/**
 * The Docker image's health check script decides what to probe from the
 * container's command line. Run here with `--url` against a stand-in for
 * `/proc/1/cmdline`, which prints the URL it would fetch (or nothing, for a
 * command with no server). ci.yml's Docker job runs the real probe in the image.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { repoRoot, spawnCapture } from './helpers/cli'

const SCRIPT = path.join(repoRoot, 'scripts/docker-healthcheck.sh')

let dir: string
beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(tmpdir(), 'ritual-healthcheck-'))
})
afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

/** The URL the script would probe for a PID 1 run as `argv`; '' for none. */
async function probedUrl(argv: readonly string[]): Promise<string> {
  const cmdline = path.join(dir, 'cmdline')
  await fs.writeFile(cmdline, `${argv.join('\0')}\0`)
  const { exitCode, stdout } = await spawnCapture(['sh', SCRIPT, '--url'], {
    env: { PATH: process.env.PATH ?? '', RITUAL_HEALTHCHECK_CMDLINE: cmdline },
  })
  expect(exitCode).toBe(0)
  return stdout.trim()
}

describe('docker-healthcheck.sh', () => {
  test.each<[string, string[], string]>([
    ['serve on its default port', ['ritual', 'serve'], 'http://127.0.0.1:3000/'],
    [
      'serve --api on a chosen port, bound to every address',
      ['ritual', 'serve', '--api', '--host', '0.0.0.0', '--port', '3001'],
      'http://127.0.0.1:3001/',
    ],
    [
      'admin after a global option, with -p',
      ['ritual', '--base-dir', '/app', 'admin', '-p', '9000'],
      'http://127.0.0.1:9000/api/status',
    ],
    [
      'cache server with --flag=value spellings',
      ['ritual', 'cache', 'server', '--host=0.0.0.0', '--port=4100'],
      'http://127.0.0.1:4100/health',
    ],
    [
      'serve under `docker run --init`, with -pN',
      ['/sbin/docker-init', '--', 'ritual', 'serve', '-p5000'],
      'http://127.0.0.1:5000/',
    ],
    ['an IPv6 host', ['ritual', 'serve', '--host', '::1'], 'http://[::1]:3000/'],
    ['the cache feed host', ['ritual', 'cache', 'feed', 'host'], 'http://127.0.0.1:4010/health'],
    ['a cache feed command other than the host', ['ritual', 'cache', 'feed', 'fetch'], ''],
    ['a one-shot command', ['ritual', 'lists'], ''],
    ['a cache command other than the server', ['ritual', 'cache', 'preload-all'], ''],
    ['the MCP server, which has no health route', ['ritual', 'mcp', '--port', '8765'], ''],
    ['a container not running ritual at all', ['/bin/sh'], ''],
  ])('%s', async (_label, argv, url) => {
    expect(await probedUrl(argv)).toBe(url)
  })
})
