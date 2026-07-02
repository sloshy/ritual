import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileExists, formatDuration } from '../../src/utils'

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

describe('formatDuration', () => {
  test('formats sub-minute, minutes, hours, and day durations', () => {
    expect(formatDuration(30_000)).toBe('less than a minute')
    expect(formatDuration(45 * 60_000)).toBe('45 minutes')
    expect(formatDuration(3 * 60 * 60_000 + 5 * 60_000)).toBe('3 hours, 5 minutes')
    expect(formatDuration(26 * 60 * 60_000)).toBe('1 day, 2 hours')
  })

  test('omits minute precision once the total exceeds a day', () => {
    expect(formatDuration(24 * 60 * 60_000 + 61_000)).toBe('1 day')
  })

  test('uses singular unit names for one minute and one hour', () => {
    expect(formatDuration(60_000)).toBe('1 minute')
    expect(formatDuration(60 * 60_000 + 60_000)).toBe('1 hour, 1 minute')
  })
})
