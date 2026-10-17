/**
 * `deck-sync --output json` owns stdout: nothing but the report may reach it,
 * even when the run first refreshes an expired Archidekt session — whose
 * "Refreshed the Archidekt session." line once went through the process's
 * console logger and landed in front of the JSON.
 *
 * In-process, with the default console logger in place (as in a real run) and
 * Archidekt stubbed. Bun's `console.log` does not route through
 * `process.stdout.write`, so both are watched: a console line is a stdout line
 * a spawned run would print.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { ArchidektToken } from '../../src/auth/interfaces'
import { registerDeckSyncCommand } from '../../src/commands/deck-sync'
import type { DeckSyncReport } from '../../src/deck-sync/engine'
import { resetLogger } from '../../src/util/logger'
import { captureConsole, captureStream } from '../helpers/capture'
import { runInProcess } from '../helpers/cli'
import type { StubbedFetch } from '../helpers/stub-fetch'
import { bindWorkspace, type BoundWorkspace } from '../helpers/workspace'
import { stubArchidekt, tokenValidForAnHour } from './helpers/archidekt'

const REFRESH_URL = 'https://archidekt.com/api/rest-auth/token/refresh/'

let ws: BoundWorkspace
let stubbed: StubbedFetch | undefined

beforeEach(async () => {
  ws = await bindWorkspace()
  resetLogger()
})

afterEach(async () => {
  stubbed?.restore()
  stubbed = undefined
  resetLogger()
  await ws.dispose()
})

/** A stored login whose access token has expired and whose refresh token still works. */
async function storeExpiredLogin(): Promise<void> {
  const expired = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 60 }))
  const token: ArchidektToken = {
    access_token: `header.${expired.toString('base64url')}.signature`,
    refresh_token: tokenValidForAnHour(),
    user: { id: 1, username: 'tester' },
  }
  const loginsDir = path.join(ws.dir, '.logins')
  await fs.mkdir(loginsDir, { recursive: true })
  await fs.writeFile(path.join(loginsDir, 'archidekt.json'), JSON.stringify(token))
}

async function storedAccessToken(): Promise<string> {
  const raw = await fs.readFile(path.join(ws.dir, '.logins', 'archidekt.json'), 'utf-8')
  return (JSON.parse(raw) as ArchidektToken).access_token
}

describe('deck-sync --output json stdout (Integration)', () => {
  test('a session refreshed on the way leaves stdout holding only the report', async () => {
    await storeExpiredLogin()
    const refreshed = tokenValidForAnHour()
    stubbed = stubArchidekt({ [REFRESH_URL]: () => Response.json({ access: refreshed }) })

    let exitCode = 1
    let stdout = ''
    const consoleOut = await captureConsole(['log'], async () => {
      stdout = await captureStream('stdout', async () => {
        exitCode = await runInProcess(registerDeckSyncCommand, [
          'deck-sync',
          'pull',
          '--output',
          'json',
        ])
      })
    })

    // The refresh happened: the run is the one this test is about.
    expect(stubbed.sent.map((sent) => sent.url)).toEqual([REFRESH_URL])
    expect(await storedAccessToken()).toBe(refreshed)
    expect(exitCode).toBe(0)
    expect(consoleOut.lines.log).toEqual([])
    const report = JSON.parse(stdout) as DeckSyncReport
    expect(report.decks).toEqual([])
  })
})
