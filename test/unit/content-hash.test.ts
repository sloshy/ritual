import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  computeHash,
  hashPath,
  loadHash,
  saveHash,
  getContentHash,
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

  it('is deterministic', () => {
    expect(computeHash('test')).toBe(computeHash('test'))
  })

  it('differs for different inputs', () => {
    expect(computeHash('a')).not.toBe(computeHash('b'))
  })
})

describe('hashPath', () => {
  it('appends .sha256 to the file path', () => {
    expect(hashPath('/foo/bar.md')).toBe('/foo/bar.md.sha256')
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

describe('getContentHash', () => {
  it('returns cached hash from sidecar when available', async () => {
    const filePath = path.join(tmpDir, 'cached.md')
    const content = '# Test\n'
    const hash = computeHash(content)

    // Pre-save the hash
    await saveHash(filePath, hash)

    const result = await getContentHash(filePath, content)
    expect(result).toBe(hash)
  })

  it('computes and saves hash when sidecar is missing', async () => {
    const filePath = path.join(tmpDir, 'fresh.md')
    const content = '# Fresh\n'
    const expected = computeHash(content)

    const result = await getContentHash(filePath, content)
    expect(result).toBe(expected)

    // Sidecar should now exist
    const saved = await loadHash(filePath)
    expect(saved).toBe(expected)
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
