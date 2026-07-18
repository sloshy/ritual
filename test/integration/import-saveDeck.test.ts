import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import path from 'node:path'
import fs from 'node:fs/promises'
import { saveDeck } from '../../src/commands/import'
import { parseDeckFrontMatter } from '../../src/deck-file'
import { sanitizeListFileName } from '../../src/list-file-name'
import { type DeckData } from '../../src/types'
import { MemoryLogger, resetLogger, setLogger } from '../test-utils'
import { withTempDir } from './helpers/cli'

/** The path saveDeck writes a deck to, mirroring its filename derivation. */
function deckPath(dir: string, name: string): string {
  return path.join(dir, `${sanitizeListFileName(name)}.md`)
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

describe('saveDeck (Integration)', () => {
  let logger: MemoryLogger

  beforeEach(() => {
    logger = new MemoryLogger()
    setLogger(logger)
  })

  afterEach(() => {
    resetLogger()
  })

  test('dry-run writes nothing and logs the deck and primer sidecar paths', async () => {
    await withTempDir(async (dir) => {
      await saveDeck(deckWithPrimer, dir, { dryRun: true, noPrompts: true })

      const files = await fs.readdir(dir)
      expect(files).toHaveLength(0)
      const loggedInfo = (text: string): boolean =>
        logger.entries.some(
          (entry) =>
            entry.level === 'info' &&
            typeof entry.args[0] === 'string' &&
            entry.args[0].includes(text),
        )
      expect(loggedInfo('[dry-run] Would save deck to:')).toBeTrue()
      expect(loggedInfo('[dry-run] Would save primer to:')).toBeTrue()
    })
  })

  test('refuses a deck name with no usable filename characters, writing nothing', async () => {
    // The name comes from the source service, so it is not trusted: before, this
    // wrote a file literally called `.md`.
    await withTempDir(async (dir) => {
      const deck: DeckData = { ...sampleDeck, name: '???' }

      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
      await expect(saveDeck(deck, dir, { noPrompts: true })).rejects.toThrow(
        'no characters usable in a file name',
      )
      expect(await fs.readdir(dir)).toEqual([])
    })
  })

  test('conflict with prompts disabled throws instead of prompting', async () => {
    await withTempDir(async (dir) => {
      await Bun.write(deckPath(dir, sampleDeck.name), '# existing')

      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
      await expect(saveDeck(sampleDeck, dir, { noPrompts: true })).rejects.toThrow(
        'Import conflict',
      )
    })
  })

  test('assumeYes overwrites a conflict with prompts disabled', async () => {
    await withTempDir(async (dir) => {
      const conflictPath = deckPath(dir, sampleDeck.name)
      await Bun.write(conflictPath, '# existing')

      await saveDeck(sampleDeck, dir, { noPrompts: true, assumeYes: true })

      const frontMatter = await parseDeckFrontMatter(conflictPath)
      expect(frontMatter.name).toBe('Integration Deck')
      expect(frontMatter.sourceId).toBe('source-123')
      expect(await Bun.file(conflictPath).text()).toContain('1 Sol Ring')
    })
  })

  test('persists the format the source service reported', async () => {
    await withTempDir(async (dir) => {
      const deck: DeckData = { ...sampleDeck, format: 'modern' }
      await saveDeck(deck, dir, { noPrompts: true })

      const frontMatter = await parseDeckFrontMatter(deckPath(dir, deck.name))
      expect(frontMatter.format).toBe('modern')
    })
  })

  test('persists a format inferred from the sections when the source reported none', async () => {
    // An Archidekt/Moxfield deck whose format Ritual cannot map still has a
    // Commander section; the site infers "Commander" from it, and the import must
    // write that down so every other surface reads the same format.
    await withTempDir(async (dir) => {
      const deck: DeckData = {
        name: 'Commander Import',
        sections: [
          { name: 'Commander', cards: [{ quantity: 1, name: 'Atraxa' }] },
          { name: 'Main', cards: [{ quantity: 1, name: 'Sol Ring' }] },
        ],
      }
      await saveDeck(deck, dir, { noPrompts: true })

      const frontMatter = await parseDeckFrontMatter(deckPath(dir, deck.name))
      expect(frontMatter.format).toBe('commander')
    })
  })

  // Locate the deck markdown saveDeck wrote, without assuming its exact filename.
  async function readWrittenDeck(dir: string): Promise<string> {
    const files = await fs.readdir(dir)
    const deckFile = files.find((f) => f.endsWith('.md') && !f.endsWith('.primer.md'))
    if (!deckFile) throw new Error(`no deck file written in ${dir}`)
    return fs.readFile(path.join(dir, deckFile), 'utf-8')
  }

  test('writes a stable &N id and keeps importer printing metadata on the card line', async () => {
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
      await saveDeck(deckWithPrinting, dir, { noPrompts: true })

      const content = await readWrittenDeck(dir)
      expect(content).toContain('1 Mana Crypt (2XM:1) [foil] &1')
    })
  })

  test('deck with primer writes .primer.md sidecar and no primer in frontmatter', async () => {
    await withTempDir(async (dir) => {
      await saveDeck(deckWithPrimer, dir, { noPrompts: true })

      const deckFilePath = deckPath(dir, deckWithPrimer.name)
      const deckContent = await Bun.file(deckFilePath).text()
      expect(deckContent).not.toContain('primer:')

      const primerContent = await Bun.file(deckFilePath.replace(/\.md$/, '.primer.md')).text()
      expect(primerContent).toContain('## Overview')
      expect(primerContent).toContain('This is a great deck.')
    })
  })
})
