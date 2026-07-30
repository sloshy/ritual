import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  computeHash,
  hashPath,
  isHashCurrent,
  isRitualClean,
  loadHash,
  saveHash,
  writeFileWithHash,
  appendFileWithHash,
} from '../../src/content-hash'

const tmpDir = path.join(import.meta.dir, '..', 'temp', 'content-hash-test')

beforeEach(async () => {
  await fs.mkdir(tmpDir, { recursive: true })
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('computeHash', () => {
  it('returns a 64-char hex string', () => {
    const hash = computeHash('hello world')
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('hashPath', () => {
  it('appends .sha256 to the file path', () => {
    expect(hashPath('/foo/bar.md')).toBe('/foo/bar.md.sha256')
  })
})

describe('isHashCurrent', () => {
  it('is true when the stored hash matches the content', () => {
    const content = '# Deck\n- Sol Ring\n'
    expect(isHashCurrent(content, computeHash(content))).toBe(true)
  })

  it('is false when the stored hash is stale', () => {
    expect(isHashCurrent('new content', computeHash('old content'))).toBe(false)
  })

  it('is false when there is no stored hash', () => {
    expect(isHashCurrent('anything', null)).toBe(false)
  })
})

describe('saveHash / loadHash', () => {
  it('round-trips a hash through the sidecar file', async () => {
    const filePath = path.join(tmpDir, 'test.md')
    const hash = computeHash('some content')

    await saveHash(filePath, hash)
    const loaded = await loadHash(filePath)

    expect(loaded).toBe(hash)
  })

  it('returns null when sidecar does not exist', async () => {
    const filePath = path.join(tmpDir, 'nonexistent.md')
    const loaded = await loadHash(filePath)
    expect(loaded).toBeNull()
  })
})

describe('isRitualClean', () => {
  it('is true when the sidecar matches the content', async () => {
    const filePath = path.join(tmpDir, 'clean.md')
    const content = '# Deck\n- Sol Ring &1\n'
    await writeFileWithHash(filePath, content)

    expect(await isRitualClean(filePath, content)).toBe(true)
  })

  it('is false when the sidecar is stale (hand edit after a Ritual write)', async () => {
    const filePath = path.join(tmpDir, 'stale.md')
    await writeFileWithHash(filePath, '# Deck\n- Sol Ring &1\n')

    expect(await isRitualClean(filePath, '# Deck\n- Sol Ring &1\n- Time Walk\n')).toBe(false)
  })

  it('is false when no sidecar exists', async () => {
    const filePath = path.join(tmpDir, 'unstamped.md')
    expect(await isRitualClean(filePath, 'anything')).toBe(false)
  })
})

describe('writeFileWithHash', () => {
  it('writes file content and sidecar hash', async () => {
    const filePath = path.join(tmpDir, 'write-test.md')
    const content = '# Deck\n- Sol Ring\n'

    const hash = await writeFileWithHash(filePath, content)

    expect(hash).toBe(computeHash(content))
    expect(await fs.readFile(filePath, 'utf-8')).toBe(content)
    expect(await loadHash(filePath)).toBe(hash)
  })

  it('overwrites existing content and updates hash', async () => {
    const filePath = path.join(tmpDir, 'overwrite.md')

    await writeFileWithHash(filePath, 'old content')
    const newHash = await writeFileWithHash(filePath, 'new content')

    expect(await fs.readFile(filePath, 'utf-8')).toBe('new content')
    expect(newHash).toBe(computeHash('new content'))
    expect(await loadHash(filePath)).toBe(newHash)
  })
})

describe('appendFileWithHash', () => {
  it('creates file if it does not exist', async () => {
    const filePath = path.join(tmpDir, 'append-new.md')
    const data = '- Lightning Bolt\n'

    const hash = await appendFileWithHash(filePath, data)

    expect(await fs.readFile(filePath, 'utf-8')).toBe(data)
    expect(hash).toBe(computeHash(data))
    expect(await loadHash(filePath)).toBe(hash)
  })

  it('appends to existing file and updates hash', async () => {
    const filePath = path.join(tmpDir, 'append-existing.md')
    await fs.writeFile(filePath, '# Collection\n')

    const hash = await appendFileWithHash(filePath, '- Card A\n')

    const expected = '# Collection\n- Card A\n'
    expect(await fs.readFile(filePath, 'utf-8')).toBe(expected)
    expect(hash).toBe(computeHash(expected))
    expect(await loadHash(filePath)).toBe(hash)
  })
})
