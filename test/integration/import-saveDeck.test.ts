import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import path from 'node:path'
import fs from 'node:fs/promises'
import {
  saveDeck,
  type ConflictResolution,
  type SaveListOutcome,
} from '../../src/importers/save-list'
import { ExitCode } from '../../src/util/errors'
import { parseDeckFrontMatter } from '../../src/list/deck-file'
import { sanitizeListFileName } from '../../src/list/list-file-name'
import type { DeckData } from '../../src/list/deck'
import {
  parseArchidektDeckResponse,
  type ArchidektDeckResponse,
} from '../../src/importers/archidekt-types'
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
      await saveDeck(deckWithPrimer, dir, { dryRun: true })

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
      await expect(saveDeck(deck, dir)).rejects.toThrow('no characters usable in a file name')
      expect(await fs.readdir(dir)).toEqual([])
    })
  })

  test('conflict with prompts disabled throws instead of prompting', async () => {
    await withTempDir(async (dir) => {
      await Bun.write(deckPath(dir, sampleDeck.name), '# existing')

      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
      await expect(saveDeck(sampleDeck, dir)).rejects.toThrow('Import conflict')
    })
  })

  test.each([
    [
      'a fenced body `sourceId:` is not a conflict',
      '# Notes\n\n```\nsourceId: source-123\n```\n',
      false,
    ],
    [
      'a single-quoted front-matter sourceId is',
      "---\nname: Other\nsourceId: 'source-123'\n---\n",
      true,
    ],
    [
      // A bare numeric scalar is a YAML number, which the front-matter
      // validator does not read as a source id either.
      'an unquoted numeric sourceId is not a string id',
      '---\nname: Other\nsourceId: 123\n---\n',
      false,
    ],
  ])('sourceId scan is front-matter scoped: %s', async (_label, existing, conflicts) => {
    await withTempDir(async (dir) => {
      await Bun.write(deckPath(dir, 'Other'), existing)
      const deck: DeckData = {
        ...sampleDeck,
        sourceId: existing.includes('123\n') ? '123' : sampleDeck.sourceId,
      }
      const attempt = saveDeck(deck, dir)
      if (conflicts) {
        // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
        await expect(attempt).rejects.toThrow("Import conflict for 'Other.md'")
      } else {
        expect(await attempt).toMatchObject({ status: 'saved', action: 'created' })
      }
    })
  })

  test.each<[string, ConflictResolution, Partial<SaveListOutcome> | RegExp]>([
    ['overwrite', { action: 'overwrite' }, { status: 'saved', action: 'overwritten' }],
    ['rename', { action: 'rename', newName: 'Fresh Name' }, { status: 'saved', action: 'renamed' }],
    ['cancel', { action: 'cancel' }, { status: 'cancelled' }],
    [
      'rename onto an existing deck',
      { action: 'rename', newName: 'Taken' },
      /Import conflict for 'Taken.md'/,
    ],
    ['rename with nothing usable', { action: 'rename', newName: '???' }, /no characters usable/],
  ])(
    'an injected resolver answering %s decides the conflict',
    async (_label, resolution, expected) => {
      await withTempDir(async (dir) => {
        await Bun.write(deckPath(dir, sampleDeck.name), '# existing')
        await Bun.write(deckPath(dir, 'Taken'), '# taken')
        const resolveConflict = async (): Promise<ConflictResolution> => resolution

        if (expected instanceof RegExp) {
          // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
          await expect(saveDeck(sampleDeck, dir, { resolveConflict })).rejects.toMatchObject({
            message: expect.stringMatching(expected),
            exitCode: ExitCode.UsageError,
          })
        } else {
          expect(await saveDeck(sampleDeck, dir, { resolveConflict })).toMatchObject(expected)
          if (resolution.action === 'rename') {
            expect(await Bun.file(deckPath(dir, resolution.newName)).exists()).toBeTrue()
          }
          if (resolution.action === 'overwrite') {
            const written = await Bun.file(deckPath(dir, sampleDeck.name)).text()
            expect(written).not.toBe('# existing')
            expect(written).toContain('1 Sol Ring &1')
          }
        }
      })
    },
  )

  test('assumeYes overwrites a conflict with prompts disabled', async () => {
    await withTempDir(async (dir) => {
      const conflictPath = deckPath(dir, sampleDeck.name)
      await Bun.write(conflictPath, '# existing')

      await saveDeck(sampleDeck, dir, { assumeYes: true })

      const frontMatter = await parseDeckFrontMatter(conflictPath)
      expect(frontMatter.name).toBe('Integration Deck')
      expect(frontMatter.sourceId).toBe('source-123')
      expect(await Bun.file(conflictPath).text()).toContain('1 Sol Ring')
    })
  })

  test('persists the format the source service reported', async () => {
    await withTempDir(async (dir) => {
      const deck: DeckData = { ...sampleDeck, format: 'modern' }
      await saveDeck(deck, dir)

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
      await saveDeck(deck, dir)

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
      await saveDeck(deckWithPrinting, dir)

      const content = await readWrittenDeck(dir)
      expect(content).toContain('1 Mana Crypt (2XM:1) [foil] &1')
    })
  })

  test('an Archidekt deck response lands on disk with its printings and finishes', async () => {
    // The URL-import fidelity path end to end: parser -> saveDeck -> file.
    await withTempDir(async (dir) => {
      const response: ArchidektDeckResponse = {
        name: 'Fetched Deck',
        deckFormat: 3,
        categories: [{ id: 1, name: 'Commander' }],
        cards: [
          {
            quantity: 1,
            categories: [1],
            modifier: 'Foil',
            card: {
              name: 'Krenko, Mob Boss',
              oracleCard: { name: 'Krenko, Mob Boss' },
              collectorNumber: '149',
              edition: { editioncode: 'm19' },
            },
          },
          {
            quantity: 4,
            modifier: 'Normal',
            card: {
              name: 'Lightning Bolt',
              oracleCard: { name: 'Lightning Bolt' },
              collectorNumber: '146',
              edition: { editioncode: 'm10' },
            },
          },
        ],
      }

      await saveDeck(parseArchidektDeckResponse(response, '7031486'), dir)

      const content = await readWrittenDeck(dir)
      expect(content).toContain('## Commander\n1 Krenko, Mob Boss (M19:149) [foil] &1')
      expect(content).toContain('## Main\n4 Lightning Bolt (M10:146) &2')
      expect(content).toContain('format: commander')
    })
  })

  test('deck with primer writes .primer.md sidecar and no primer in frontmatter', async () => {
    await withTempDir(async (dir) => {
      await saveDeck(deckWithPrimer, dir)

      const deckFilePath = deckPath(dir, deckWithPrimer.name)
      const deckContent = await Bun.file(deckFilePath).text()
      expect(deckContent).not.toContain('primer:')

      const primerContent = await Bun.file(deckFilePath.replace(/\.md$/, '.primer.md')).text()
      expect(primerContent).toContain('## Overview')
      expect(primerContent).toContain('This is a great deck.')
    })
  })
})
