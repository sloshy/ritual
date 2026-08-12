import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { registerImportCommand } from '../../src/commands/import'
import { MemoryLogger, resetLogger, setLogger } from '../../src/logger'
import { captureStream } from './helpers/capture'
import { runInProcess } from './helpers/cli'
import {
  ARCHIDEKT_DECK_ID,
  ARCHIDEKT_DECK_URL,
  REMOTE_BARE_DECK,
  REMOTE_FOIL_DECK,
  readImportedDeck,
} from './helpers/import-fixtures'
import { stubFetch, type StubbedFetch } from './helpers/stub-fetch'
import { bindWorkspace, type BoundWorkspace } from './helpers/workspace'

/**
 * The URL half of `ritual import`, driven in-process against a stubbed
 * Archidekt: specifically the printing choice — the `--sync-printings` /
 * `--no-sync-printings` pair, the `--no-input` softening, and the prompt
 * guard's refusal when the question cannot be asked. The save itself is
 * covered by `import-saveDeck.test.ts`; the text and CSV paths by
 * `import-text-cli.test.ts` / `import-csv-cli.test.ts`.
 */

const SOURCE_URL = `https://archidekt.com/decks/${ARCHIDEKT_DECK_ID}`

let ws: BoundWorkspace
let dir: string
let stub: StubbedFetch
let logger: MemoryLogger

async function runImport(args: string[]): Promise<number> {
  return runInProcess(registerImportCommand, ['import', ...args])
}

function logged(): string {
  return logger.entries.map((entry) => entry.args.map((arg) => String(arg)).join(' ')).join('\n')
}

beforeEach(async () => {
  ws = await bindWorkspace({ init: true })
  dir = ws.dir
  stub = stubFetch({ [ARCHIDEKT_DECK_URL]: () => Response.json(REMOTE_FOIL_DECK) })
  logger = new MemoryLogger()
  setLogger(logger)
})

afterEach(async () => {
  stub.restore()
  resetLogger()
  await ws.dispose()
})

describe('import <url> printings (Integration)', () => {
  test('--sync-printings keeps the exact printings without asking', async () => {
    expect(await runImport([SOURCE_URL, '--sync-printings'])).toBe(0)
    expect(await readImportedDeck(dir)).toContain('1 Sol Ring (LTC:284) [foil] &1')
  })

  test('--no-sync-printings imports bare card names', async () => {
    expect(await runImport([SOURCE_URL, '--no-sync-printings'])).toBe(0)
    const deck = await readImportedDeck(dir)
    expect(deck).toContain('1 Sol Ring &1')
    expect(deck).not.toContain('LTC')
    expect(deck).not.toContain('[foil]')
  })

  test('--no-input with neither flag keeps the printings and says so', async () => {
    process.env.RITUAL_NO_INPUT = '1'
    try {
      expect(await runImport([SOURCE_URL])).toBe(0)
    } finally {
      delete process.env.RITUAL_NO_INPUT
    }
    expect(logged()).toContain('Keeping the exact printings')
    expect(await readImportedDeck(dir)).toContain('1 Sol Ring (LTC:284) [foil] &1')
  })

  test('a deck stating no printings has nothing to decide and never asks', async () => {
    // The branch that keeps bare-name imports (MTGGoldfish, edition-less
    // entries) working non-interactively without either flag.
    stub.restore()
    stub = stubFetch({ [ARCHIDEKT_DECK_URL]: () => Response.json(REMOTE_BARE_DECK) })
    expect(await runImport([SOURCE_URL])).toBe(0)
    expect(await readImportedDeck(dir)).toContain('1 Sol Ring &1')
  })

  test('with no flag and no terminal, the unanswerable prompt is a usage error', async () => {
    // The test runner has no TTY, so the prompt guard fires; the refusal names
    // what was needed rather than hanging or silently picking a side.
    let exitCode = 0
    const stderr = await captureStream('stderr', async () => {
      exitCode = await runImport([SOURCE_URL])
    })
    expect(exitCode).toBe(2)
    expect(stderr).toContain('--sync-printings or --no-sync-printings')
    // Nothing was written for a run that could not decide.
    expect(await fs.readdir(path.join(dir, 'decks')).catch(() => [])).toEqual([])
  })

  test('--output json refuses the prompt rather than corrupting the payload', async () => {
    let exitCode = 0
    const stderr = await captureStream('stderr', async () => {
      exitCode = await runImport([SOURCE_URL, '--output', 'json'])
    })
    expect(exitCode).toBe(2)
    expect(stderr).toContain('--sync-printings or --no-sync-printings')
  })

  test('the JSON payload records which way the question was answered', async () => {
    await captureStream('stdout', async () => {
      await runImport([SOURCE_URL, '--no-sync-printings', '--output', 'json', '--quiet'])
    })
    const stdout = await captureStream('stdout', async () => {
      await runImport([
        SOURCE_URL,
        '--sync-printings',
        '--overwrite',
        '--output',
        'json',
        '--quiet',
      ])
    })
    type Payload = { syncPrintings?: boolean }
    const payload = JSON.parse(stdout) as Payload
    expect(payload.syncPrintings).toBe(true)
  })

  const urlOnlySources = [
    ['decklist.txt', '1 Sol Ring\n', 'on its card lines'],
    ['cards.csv', 'name\nSol Ring\n', 'through the column mapping'],
  ] as const

  for (const [file, content, branch] of urlOnlySources) {
    test(`the flags are URL-only: a ${file} source rejects them`, async () => {
      const filePath = path.join(dir, file)
      await fs.writeFile(filePath, content)
      let exitCode = 0
      const stderr = await captureStream('stderr', async () => {
        exitCode = await runImport([filePath, '--type', 'deck', '--sync-printings'])
      })
      expect(exitCode).toBe(2)
      expect(stderr).toContain('only apply to URL imports')
      // Each source kind gets its own explanation of where printings come from.
      expect(stderr).toContain(branch)
      expect(await fs.readdir(path.join(dir, 'decks')).catch(() => [])).toEqual([])
    })
  }
})
