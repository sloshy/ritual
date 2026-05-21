import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { tmpdir } from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { saveDeck } from '../../src/commands/import'
import { sanitizeDeckFileName } from '../../src/utils'
import { type DeckData } from '../../src/types'
import { MemoryLogger, resetLogger, setLogger } from '../test-utils'

/** The path saveDeck writes a deck to, mirroring its filename derivation. */
function deckPath(dir: string, name: string): string {
  return path.join(dir, `${sanitizeDeckFileName(name)}.md`)
}

const sampleDeck: DeckData = {
  name: 'Integration Deck',
  sourceId: 'source-123',
  sections: [{ name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring' }] }],
}

const deckWithPrimer: DeckData = {
  name: 'Primer Deck',
  sections: [{ name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring' }] }],
  primer: '## Overview\n\nThis is a great deck.',
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

  test('dry-run with primer logs primer sidecar path but writes nothing', async () => {
    await withTempDir(async (dir) => {
      await saveDeck(deckWithPrimer, dir, { dryRun: true, nonInteractive: true })

      const files = await fs.readdir(dir)
      expect(files).toHaveLength(0)
      expect(
        logger.entries.some(
          (entry) =>
            entry.level === 'info' &&
            typeof entry.args[0] === 'string' &&
            entry.args[0].includes('[dry-run] Would save primer to:'),
        ),
      ).toBeTrue()
    })
  })

  test('non-interactive conflict without overwrite throws', async () => {
    await withTempDir(async (dir) => {
      await Bun.write(deckPath(dir, sampleDeck.name), '# existing')

      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
      await expect(saveDeck(sampleDeck, dir, { nonInteractive: true })).rejects.toThrow(
        'Import conflict',
      )
    })
  })

  test('assumeYes overwrites in non-interactive mode', async () => {
    await withTempDir(async (dir) => {
      const conflictPath = deckPath(dir, sampleDeck.name)
      await Bun.write(conflictPath, '# existing')

      await saveDeck(sampleDeck, dir, { nonInteractive: true, assumeYes: true })

      const updated = await Bun.file(conflictPath).text()
      expect(updated).toContain('# Integration Deck')
      expect(updated).toContain('1 Sol Ring')
    })
  })

  // Locate the deck markdown saveDeck wrote, without assuming its exact filename.
  async function readWrittenDeck(dir: string): Promise<string> {
    const files = await fs.readdir(dir)
    const deckFile = files.find((f) => f.endsWith('.md') && !f.endsWith('.primer.md'))
    if (!deckFile) throw new Error(`no deck file written in ${dir}`)
    return fs.readFile(path.join(dir, deckFile), 'utf-8')
  }

  test('writes a stable &N id on every card line', async () => {
    await withTempDir(async (dir) => {
      await saveDeck(sampleDeck, dir, { nonInteractive: true })

      const content = await readWrittenDeck(dir)
      expect(content).toContain('1 Sol Ring &1')
    })
  })

  test('preserves printing metadata captured by the importer', async () => {
    await withTempDir(async (dir) => {
      const deckWithPrinting: DeckData = {
        name: 'Printing Deck',
        sections: [
          {
            name: 'Main',
            cards: [
              { quantity: 1, name: 'Mana Crypt', set: '2xm', collectorNumber: '1', finish: 'foil' },
            ],
          },
        ],
      }
      await saveDeck(deckWithPrinting, dir, { nonInteractive: true })

      const content = await readWrittenDeck(dir)
      expect(content).toContain('1 Mana Crypt (2XM:1) [foil] &1')
    })
  })

  test('deck with primer writes .primer.md sidecar and no primer in frontmatter', async () => {
    await withTempDir(async (dir) => {
      await saveDeck(deckWithPrimer, dir, { nonInteractive: true })

      const deckFilePath = deckPath(dir, deckWithPrimer.name)
      const deckContent = await Bun.file(deckFilePath).text()
      expect(deckContent).not.toContain('primer:')

      const primerContent = await Bun.file(deckFilePath.replace(/\.md$/, '.primer.md')).text()
      expect(primerContent).toContain('## Overview')
      expect(primerContent).toContain('This is a great deck.')
    })
  })
})
