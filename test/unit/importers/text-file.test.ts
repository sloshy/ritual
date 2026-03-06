import { describe, expect, test, beforeAll, afterAll } from 'bun:test'
import { importFromTextFile } from '../../../src/importers/text-file'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { unlink } from 'node:fs/promises'

const TEST_FILE = join(tmpdir(), `ritual-test-${crypto.randomUUID()}.txt`)
const TEST_PRIMER_FILE = TEST_FILE.replace(/\.txt$/, '.primer.md')

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
    await unlink(TEST_PRIMER_FILE).catch(() => {})
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

  test('loads primer from sidecar .primer.md file', async () => {
    await Bun.write(TEST_PRIMER_FILE, '## Overview\n\nThis deck does stuff.\n')
    const deck = await importFromTextFile(TEST_FILE)
    expect(deck.primer).toBe('## Overview\n\nThis deck does stuff.')
  })

  test('returns undefined primer when no sidecar file exists', async () => {
    await unlink(TEST_PRIMER_FILE).catch(() => {})
    const deck = await importFromTextFile(TEST_FILE)
    expect(deck.primer).toBeUndefined()
  })
})
