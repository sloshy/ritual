import { describe, expect, it } from 'bun:test'
import { importFromTextFile } from '../../src/importers/text-file'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rm } from 'node:fs/promises'

async function withTempFile(content: string, run: (filePath: string) => Promise<void>) {
  const filePath = join(tmpdir(), `ritual-${crypto.randomUUID()}.txt`)
  await Bun.write(filePath, content)
  try {
    await run(filePath)
  } finally {
    await rm(filePath, { force: true })
  }
}

describe('importFromTextFile (frontmatter)', () => {
  it('parses YAML frontmatter and deck content', async () => {
    await withTempFile(
      `---
name: "My Deck"
description: "Line 1\\nLine 2"
sourceUrl: "https://example.com/deck/123"
sourceId: "123"
---
## Main
4 Lightning Bolt
2 Counterspell
`,
      async (filePath) => {
        const deck = await importFromTextFile(filePath)

        expect(deck.name).toBe('My Deck')
        expect(deck.description).toBe('Line 1\nLine 2')
        expect(deck.sourceUrl).toBe('https://example.com/deck/123')
        expect(deck.sourceId).toBe('123')
        expect(deck.sections).toHaveLength(1)
        expect(deck.sections[0]?.name).toBe('Main')
        expect(deck.sections[0]?.cards).toEqual([
          { quantity: 4, name: 'Lightning Bolt' },
          { quantity: 2, name: 'Counterspell' },
        ])
      },
    )
  })

  it('falls back to filename when frontmatter name is missing', async () => {
    await withTempFile(
      `## Main
3 Island
`,
      async (filePath) => {
        const deck = await importFromTextFile(filePath)
        expect(deck.name).toMatch(/^ritual-/)
        expect(deck.sections[0]?.cards).toEqual([{ quantity: 3, name: 'Island' }])
      },
    )
  })
})
