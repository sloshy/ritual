import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { tmpdir } from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { saveDeck } from '../../src/commands/import'
import { type DeckData } from '../../src/types'
import { MemoryLogger, resetLogger, setLogger } from '../test-utils'

const sampleDeck: DeckData = {
  name: 'Integration Deck',
  sourceId: 'source-123',
  sections: [{ name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring' }] }],
}

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = path.join(tmpdir(), `ritual-save-deck-${crypto.randomUUID()}`)
  await fs.mkdir(dir, { recursive: true })
  try {
    await run(dir)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

describe('saveDeck (Integration)', () => {
  let logger: MemoryLogger

  beforeEach(() => {
    logger = new MemoryLogger()
    setLogger(logger)
  })

  afterEach(() => {
    resetLogger()
  })

  test('dry-run does not write any files', async () => {
    await withTempDir(async (dir) => {
      await saveDeck(sampleDeck, dir, { dryRun: true, nonInteractive: true })

      const files = await fs.readdir(dir)
      expect(files).toHaveLength(0)
      expect(
        logger.entries.some(
          (entry) =>
            entry.level === 'info' &&
            typeof entry.args[0] === 'string' &&
            entry.args[0].includes('[dry-run] Would save deck to:'),
        ),
      ).toBeTrue()
    })
  })

  test('non-interactive conflict without overwrite throws', async () => {
    await withTempDir(async (dir) => {
      const conflictPath = path.join(dir, 'integration-deck.md')
      await Bun.write(conflictPath, '# existing')

      await expect(saveDeck(sampleDeck, dir, { nonInteractive: true })).rejects.toThrow(
        'Import conflict',
      )
    })
  })

  test('assumeYes overwrites in non-interactive mode', async () => {
    await withTempDir(async (dir) => {
      const conflictPath = path.join(dir, 'integration-deck.md')
      await Bun.write(conflictPath, '# existing')

      await saveDeck(sampleDeck, dir, { nonInteractive: true, assumeYes: true })

      const updated = await Bun.file(conflictPath).text()
      expect(updated).toContain('# Integration Deck')
      expect(updated).toContain('1 Sol Ring')
    })
  })
})
