import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  applyDeckMetadata,
  DECK_METADATA_KEYS,
  mergeDeckMetadata,
} from '../../src/list/deck-metadata'
import { parseDeckFrontMatter } from '../../src/list/deck-file'
import { createWorkspace, removeWorkspace } from '../helpers/workspace'

/**
 * The deck metadata write is front-matter only, so a cover image lands in the
 * block while every card line — `&N` ids included — survives byte for byte.
 */

let testDir: string
let deckPath: string

const BODY = ['## Main', '1 Sol Ring &1', '1 Lightning Bolt (LEA:161) &2', ''].join('\n')

async function writeDeck(frontMatter: string): Promise<void> {
  await fs.writeFile(deckPath, `---\n${frontMatter}---\n\n${BODY}`)
}

beforeEach(async () => {
  testDir = await createWorkspace({ dirs: [], config: false })
  deckPath = path.join(testDir, 'Burn.md')
})

afterEach(async () => {
  await removeWorkspace(testDir)
})

describe('DECK_METADATA_KEYS', () => {
  test('image is a writable deck metadata key', () => {
    expect(DECK_METADATA_KEYS).toContain('image')
  })
})

describe('mergeDeckMetadata', () => {
  test('an absent key is left alone, and null clears', () => {
    const existing = { name: 'Burn', image: { card: 2 } as const }
    expect(mergeDeckMetadata(existing, {}).image).toEqual({ card: 2 })
    expect(mergeDeckMetadata(existing, { image: null })).not.toHaveProperty('image')
    expect(mergeDeckMetadata(existing, { image: { url: 'https://e.com/a.png' } }).image).toEqual({
      url: 'https://e.com/a.png',
    })
  })
})

describe('applyDeckMetadata', () => {
  test('writes an image and leaves the card lines byte-identical', async () => {
    await writeDeck('name: Burn\nformat: commander\n')
    const write = await applyDeckMetadata(deckPath, { image: { card: 2 } })
    expect(typeof write).not.toBe('string')
    const content = await fs.readFile(deckPath, 'utf-8')
    expect(content).toContain('1 Lightning Bolt (LEA:161) &2')
    expect((await parseDeckFrontMatter(deckPath)).image).toEqual({ card: 2 })
  })

  test('clears the key on null, leaving the other keys in place', async () => {
    await writeDeck('name: Burn\nimage:\n  card: 2\n')
    await applyDeckMetadata(deckPath, { image: null })
    const frontMatter = await parseDeckFrontMatter(deckPath)
    expect(frontMatter).not.toHaveProperty('image')
    expect(frontMatter.name).toBe('Burn')
  })

  test('a valid cover survives a metadata write of another key unchanged', async () => {
    await writeDeck('name: Burn\nimage:\n  file: alters/x.png\n')
    await applyDeckMetadata(deckPath, { description: 'Fast red' })
    expect((await parseDeckFrontMatter(deckPath)).image).toEqual({ file: 'alters/x.png' })
  })
})
