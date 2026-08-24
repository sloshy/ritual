import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  applyDescriptionPatch,
  applyFlatListMetadata,
  applyImagePatch,
  applyLabelsPatch,
  FLAT_LIST_METADATA_KEYS,
} from '../../src/flat-list-metadata'
import { readFrontMatterMapping } from '../../src/front-matter-write'
import { readListImageFile, writeListImage } from '../../src/list-image-file'

/**
 * The flat-list metadata writer is front-matter only: card lines, `&N` ids and
 * every hand-authored key must survive a write of a neighbouring key untouched,
 * and an unreadable block must refuse the write rather than clobber it.
 */

const testDir = path.join(import.meta.dir, '../.test-flat-list-metadata')
const listPath = path.join(testDir, 'Binder.md')

const BODY = ['- Sol Ring (LEA:270) &1', '- Lightning Bolt (LEA:161) &2', ''].join('\n')

/** Write a list file with `frontMatter` (raw block text) above the shared body. */
async function writeList(frontMatter?: string): Promise<void> {
  const block = frontMatter === undefined ? '' : `---\n${frontMatter}---\n\n`
  await fs.writeFile(listPath, `${block}# Binder\n\n${BODY}`)
}

/** The list file's front-matter mapping after a write. */
async function readMapping(): Promise<Record<string, unknown>> {
  const parsed = readFrontMatterMapping(await fs.readFile(listPath, 'utf-8'))
  if (!parsed.ok) throw new Error(`front matter unreadable: ${parsed.reason}`)
  return parsed.data
}

beforeEach(async () => {
  await fs.mkdir(testDir, { recursive: true })
})

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true })
})

describe('FLAT_LIST_METADATA_KEYS', () => {
  test('a wanted list carries the description and cover image, a collection labels too', () => {
    expect(FLAT_LIST_METADATA_KEYS.wanted).toEqual(['description', 'image'])
    expect(FLAT_LIST_METADATA_KEYS.collection).toEqual(['description', 'labels', 'image'])
  })
})

describe('applyImagePatch', () => {
  test('writes the canonical single-key mapping and clears on null', () => {
    expect(applyImagePatch({}, { card: 4 })).toEqual({ image: { card: 4 } })
    expect(applyImagePatch({ image: { card: 4 }, labels: ['sale'] }, null)).toEqual({
      labels: ['sale'],
    })
  })

  test('never mutates the mapping it was given', () => {
    const data = { image: { card: 4 } }
    applyImagePatch(data, null)
    expect(data).toEqual({ image: { card: 4 } })
  })
})

describe('applyDescriptionPatch', () => {
  test('writes the text and clears the key on null', () => {
    expect(applyDescriptionPatch({}, 'Cards I want')).toEqual({ description: 'Cards I want' })
    expect(applyDescriptionPatch({ description: 'old', labels: ['sale'] }, null)).toEqual({
      labels: ['sale'],
    })
  })
})

describe('applyFlatListMetadata', () => {
  test('writes a description and leaves the card lines byte-identical', async () => {
    await writeList()
    await applyFlatListMetadata(listPath, { description: 'Everything I own.' })
    expect(await fs.readFile(listPath, 'utf-8')).toContain(BODY)
    expect(await readMapping()).toEqual({ description: 'Everything I own.' })
  })

  test('a description write leaves labels and image alone, and null clears only it', async () => {
    await writeList('labels:\n  - sale\nimage:\n  card: 2\n')
    await applyFlatListMetadata(listPath, { description: 'My binder' })
    expect(await readMapping()).toEqual({
      labels: ['sale'],
      image: { card: 2 },
      description: 'My binder',
    })
    await applyFlatListMetadata(listPath, { description: null })
    expect(await readMapping()).toEqual({ labels: ['sale'], image: { card: 2 } })
  })

  test('writes an image and leaves the card lines byte-identical', async () => {
    await writeList()
    const write = await applyFlatListMetadata(listPath, { image: { file: 'alters/x.png' } })
    expect(typeof write).not.toBe('string')
    const content = await fs.readFile(listPath, 'utf-8')
    expect(content).toContain(BODY)
    expect(await readMapping()).toEqual({ image: { file: 'alters/x.png' } })
  })

  test('clears the key on null without disturbing the other keys', async () => {
    await writeList('labels:\n  - sale\nimage:\n  card: 2\n')
    await applyFlatListMetadata(listPath, { image: null })
    expect(await readMapping()).toEqual({ labels: ['sale'] })
  })

  test('applies labels and image in one patch, each by its own rule', async () => {
    await writeList()
    await applyFlatListMetadata(listPath, { labels: ['sale'], image: { card: 1 } })
    expect(await readMapping()).toEqual({ labels: ['sale'], image: { card: 1 } })
    await applyFlatListMetadata(listPath, { labels: [], image: { card: 2 } })
    expect(await readMapping()).toEqual({ image: { card: 2 } })
  })

  test('a hand-authored unknown key round-trips through an image write', async () => {
    await writeList('binderOwner: Ryan\n')
    await applyFlatListMetadata(listPath, { image: { url: 'https://e.com/a.png' } })
    expect(await readMapping()).toEqual({
      binderOwner: 'Ryan',
      image: { url: 'https://e.com/a.png' },
    })
  })

  test('refuses the write when the block is not a readable mapping', async () => {
    await writeList('- just\n- a list\n')
    const before = await fs.readFile(listPath, 'utf-8')
    const result = await applyFlatListMetadata(listPath, { image: { card: 1 } })
    expect(typeof result).toBe('string')
    expect(await fs.readFile(listPath, 'utf-8')).toBe(before)
  })
})

describe('readListImageFile and writeListImage', () => {
  test('round-trip a cover through the file', async () => {
    await writeList()
    const written = await writeListImage(listPath, { card: 2 })
    expect(typeof written).not.toBe('string')
    expect(await readListImageFile(listPath)).toEqual({ image: { card: 2 } })
    await writeListImage(listPath, null)
    expect(await readListImageFile(listPath)).toEqual({})
  })

  test('a missing file reads as no cover with an advisory rather than throwing', async () => {
    const read = await readListImageFile(path.join(testDir, 'nope.md'))
    expect(read.image).toBeUndefined()
    expect(read.advisory).toContain('could not be read')
  })

  test('an unusable value reads as an advisory, matching readListImage', async () => {
    await writeList('image: alters/x.png\n')
    const read = await readListImageFile(listPath)
    expect(read.image).toBeUndefined()
    // The literal, not the delegate's own return: asserting the two match would
    // track a wording bug in lockstep. Delegation is what the neighbouring
    // `readListImage` unit tests pin.
    expect(read.advisory).toContain('must be a mapping')
  })

  test('refuses to write over a block it cannot read', async () => {
    await writeList('- just\n- a list\n')
    const before = await fs.readFile(listPath, 'utf-8')
    expect(typeof (await writeListImage(listPath, { card: 1 }))).toBe('string')
    expect(await fs.readFile(listPath, 'utf-8')).toBe(before)
  })
})

describe('applyLabelsPatch', () => {
  test('is unchanged by the image work', () => {
    expect(applyLabelsPatch({}, ['sale'])).toEqual({ labels: ['sale'] })
    expect(applyLabelsPatch({ labels: ['sale'] }, [])).toEqual({})
  })
})
