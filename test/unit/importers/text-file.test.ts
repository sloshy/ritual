import { describe, expect, test, beforeAll, afterAll } from 'bun:test'
import { importFromTextFile } from '../../../src/importers/text-file'
import path from 'path'
import { rmdir, unlink } from 'fs/promises'

const TEST_DIR = path.join(process.cwd(), 'test', 'temp')
const TEST_FILE = path.join(TEST_DIR, 'test_deck.txt')

describe('Text File Importer', () => {
  beforeAll(async () => {
    await Bun.write(
      TEST_FILE,
      `---
name: "File Deck"
description: "My cool deck"
---
1 Sol Ring
# Commander
1 Test Commander
`,
    )
  })

  afterAll(async () => {
    await unlink(TEST_FILE).catch(() => {})
  })

  test('parses text file with frontmatter and sections', async () => {
    const deck = await importFromTextFile(TEST_FILE)

    expect(deck.name).toBe('File Deck')
    expect(deck.description).toBe('My cool deck')

    // Should have Main and Commander sections

    const main = deck.sections.find((s) => s.name === 'Main')
    expect(main).toBeDefined()
    expect(main?.cards[0]?.name).toBe('Sol Ring')

    const commander = deck.sections.find((s) => s.name === 'Commander')
    expect(commander).toBeDefined()
    expect(commander?.cards[0]?.name).toBe('Test Commander')
  })
})
