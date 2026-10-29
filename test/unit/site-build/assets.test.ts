import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { loadCustomThemes } from '../../../src/site-build/assets'
import { parseCustomTheme } from '../../../src/theme/themes'
import { isMessageParseError } from '../../../src/sync/message'
import { pseudoCatalog, pseudoString, withGuardedLocaleAsync } from '../../helpers/sync-text'
import { createWorkspace, removeWorkspace } from '../../helpers/workspace'

/**
 * Custom theme loading (`--theme-file` or `site.themeFiles`): the first
 * failure is the whole answer, and it names the file and where it came from. The theme *shape* rules are `parseCustomTheme`'s own tests.
 */

async function withThemeDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await createWorkspace({ dirs: [], config: false })
  try {
    await run(dir)
  } finally {
    await removeWorkspace(dir)
  }
}

const VALID_THEME = { name: 'sunset', variables: { '--bg': '#111' } }
const BAD_THEME = { name: 'sunset', variables: { bg: '#111' } }

describe('loadCustomThemes', () => {
  test('an unreadable path is an error naming the path', async () => {
    await withThemeDir(async (dir) => {
      const missing = path.join(dir, 'nope.json')
      const result = await loadCustomThemes([missing], '--theme-file')
      // cli.buildSite.themeFileUnreadable: its fixed opening, then the OS reason.
      expect(result).toBeString()
      expect(result).toStartWith(`Failed to read --theme-file '${missing}': `)
    })
  })

  test('a file the theme parser rejects carries the parser reason', async () => {
    await withThemeDir(async (dir) => {
      const file = path.join(dir, 'bad.json')
      await fs.writeFile(file, JSON.stringify(BAD_THEME))
      const parsed = parseCustomTheme(BAD_THEME)
      if (!isMessageParseError(parsed)) throw new Error('fixture must be rejected by the parser')

      expect(await loadCustomThemes([file], '--theme-file')).toBe(
        `--theme-file '${file}': ${parsed.error.message}`,
      )
    })
  })

  test('the parser reason is nested in the CLI language, not glued on in English', async () => {
    await withThemeDir(async (dir) => {
      const file = path.join(dir, 'bad.json')
      await fs.writeFile(file, JSON.stringify(BAD_THEME))
      await withGuardedLocaleAsync('en-XA', pseudoCatalog(), async () => {
        const result = await loadCustomThemes([file], '--theme-file')
        const reason = pseudoString('site.theme.file.variableName').replace('{name}', 'bg')
        expect(result).toBe(
          pseudoString('cli.buildSite.themeFileInvalid')
            .replace('{source}', '--theme-file')
            .replace('{path}', file)
            .replace('{reason}', reason),
        )
      })
    })
  })

  test('every file loads, in order', async () => {
    await withThemeDir(async (dir) => {
      const first = path.join(dir, 'first.json')
      const second = path.join(dir, 'second.json')
      await fs.writeFile(first, JSON.stringify(VALID_THEME))
      await fs.writeFile(second, JSON.stringify({ ...VALID_THEME, name: 'dusk' }))
      const result = await loadCustomThemes([first, second], 'site.themeFiles')
      if (typeof result === 'string') throw new Error(result)
      expect(result.map((theme) => theme.name)).toEqual(['sunset', 'dusk'])
    })
  })

  test('a bad second file fails the whole load with no partial array', async () => {
    await withThemeDir(async (dir) => {
      const good = path.join(dir, 'good.json')
      const bad = path.join(dir, 'bad.json')
      await fs.writeFile(good, JSON.stringify(VALID_THEME))
      await fs.writeFile(bad, '{')

      const result = await loadCustomThemes([good, bad], 'site.themeFiles')
      // cli.buildSite.themeFileNotJson, naming only the file that failed.
      expect(result).toBeString()
      expect(result).toStartWith(`site.themeFiles '${bad}' is not valid JSON: `)
      expect(result).not.toContain(good)
    })
  })
})
