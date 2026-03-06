import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { replaceLastLine } from '../../src/commands/collection-helpers'

describe('replaceLastLine', () => {
  let tmpDir: string
  let filePath: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ritual-test-'))
    filePath = path.join(tmpDir, 'collection.md')
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('replaces the last line when it matches', async () => {
    await fs.writeFile(filePath, '- Card A (SET:1) [NM]\n- Card B (SET:2) [foil] [NM]\n')

    const result = await replaceLastLine(
      filePath,
      '- Card B (SET:2) [foil] [NM]\n',
      '- Card B (SET:2) [foil] [LP]\n',
    )

    expect(result.replaced).toBe(true)
    const content = await fs.readFile(filePath, 'utf-8')
    expect(content).toBe('- Card A (SET:1) [NM]\n- Card B (SET:2) [foil] [LP]\n')
  })

  test('does not modify file when last line does not match', async () => {
    const original = '- Card A (SET:1) [NM]\n- Card B (SET:2) [foil] [NM]\n'
    await fs.writeFile(filePath, original)

    const result = await replaceLastLine(
      filePath,
      '- Card C (SET:3)\n',
      '- Card C (SET:3) [foil]\n',
    )

    expect(result.replaced).toBe(false)
    const content = await fs.readFile(filePath, 'utf-8')
    expect(content).toBe(original)
  })

  test('preserves all other lines when replacing', async () => {
    await fs.writeFile(
      filePath,
      '# My Collection\n\n- Card A (SET:1)\n- Card B (SET:2)\n- Card C (SET:3)\n',
    )

    const result = await replaceLastLine(
      filePath,
      '- Card C (SET:3)\n',
      '- Card C (SET:3) [foil] [NM]\n',
    )

    expect(result.replaced).toBe(true)
    const content = await fs.readFile(filePath, 'utf-8')
    expect(content).toBe(
      '# My Collection\n\n- Card A (SET:1)\n- Card B (SET:2)\n- Card C (SET:3) [foil] [NM]\n',
    )
  })
})
