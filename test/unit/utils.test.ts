import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileExists } from '../../src/utils'

describe('fileExists', () => {
  test('returns true for an existing file and false for a missing one', async () => {
    const dir = path.join(os.tmpdir(), `ritual-fileexists-${crypto.randomUUID()}`)
    await fs.mkdir(dir, { recursive: true })
    try {
      const present = path.join(dir, 'present.txt')
      await fs.writeFile(present, 'hi', 'utf-8')

      expect(await fileExists(present)).toBe(true)
      expect(await fileExists(path.join(dir, 'absent.txt'))).toBe(false)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
