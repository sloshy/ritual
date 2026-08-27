import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { loadCustomThemes } from '../../../src/site-build/assets'
import { parseCustomTheme } from '../../../src/theme/themes'

/**
 * `--theme-file` loading: the first failure is the whole answer, and it names
 * the file. The theme *shape* rules are `parseCustomTheme`'s own tests.
 */

async function withThemeDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ritual-themes-'))
  try {
    await run(dir)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

const VALID_THEME = { name: 'sunset', variables: { '--bg': '#111' } }
const BAD_THEME = { name: 'sunset', variables: { bg: '#111' } }

describe('loadCustomThemes', () => {
  test('an unreadable path is an error naming the path', async () => {
    await withThemeDir(async (dir) => {
      const missing = path.join(dir, 'nope.json')
      const result = await loadCustomThemes([missing])
      expect(typeof result).toBe('string')
      expect(result).toContain(missing)
    })
  })

  test('a file the theme parser rejects carries the parser reason', async () => {
    await withThemeDir(async (dir) => {
      const file = path.join(dir, 'bad.json')
      await fs.writeFile(file, JSON.stringify(BAD_THEME))
      const reason = parseCustomTheme(BAD_THEME)
      if (typeof reason !== 'string') throw new Error('fixture must be rejected by the parser')

      const result = await loadCustomThemes([file])
      expect(result).toContain(file)
      expect(result).toContain(reason)
    })
  })

  test('a bad second file fails the whole load with no partial array', async () => {
    await withThemeDir(async (dir) => {
      const good = path.join(dir, 'good.json')
      const bad = path.join(dir, 'bad.json')
      await fs.writeFile(good, JSON.stringify(VALID_THEME))
      await fs.writeFile(bad, '{')

      const result = await loadCustomThemes([good, bad])
      expect(typeof result).toBe('string')
      expect(result).toContain(bad)
      expect(result).not.toContain(good)
    })
  })
})
