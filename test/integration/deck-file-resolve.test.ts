import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { resolveDeckFilePath } from '../../src/deck-file'
import { withTempDir } from './helpers/cli'

/**
 * `resolveDeckFilePath` is how the admin API turns a deck slug from a URL into a
 * file. It must resolve a name the same way the CLI's shared resolver does, or
 * the admin site and the CLI would disagree about which deck a name refers to.
 */
async function withDecks(files: string[], run: (dir: string) => Promise<void>): Promise<void> {
  await withTempDir(async (dir) => {
    for (const file of files) {
      await fs.writeFile(path.join(dir, file), '---\nname: X\n---\n\n## Main\n')
    }
    await run(dir)
  })
}

describe('resolveDeckFilePath (Integration)', () => {
  test('resolves the literal file name', async () => {
    await withDecks(['Winota Stax.md'], async (dir) => {
      expect(await resolveDeckFilePath(dir, 'Winota Stax')).toBe(path.join(dir, 'Winota Stax.md'))
      expect(await resolveDeckFilePath(dir, 'Winota Stax.md')).toBe(
        path.join(dir, 'Winota Stax.md'),
      )
    })
  })

  test('resolves ignoring case, diacritics, and separators', async () => {
    await withDecks(['Winota Stax.md', 'Café Standard.md'], async (dir) => {
      // A hyphenated slug finds the spaced file, as `ritual price winota-stax` does.
      expect(await resolveDeckFilePath(dir, 'winota-stax')).toBe(path.join(dir, 'Winota Stax.md'))
      expect(await resolveDeckFilePath(dir, 'winota_stax')).toBe(path.join(dir, 'Winota Stax.md'))
      expect(await resolveDeckFilePath(dir, 'cafe standard')).toBe(
        path.join(dir, 'Café Standard.md'),
      )
    })
  })

  test('resolves a deck left over from when files were kebab-cased', async () => {
    await withDecks(['black-panther.md'], async (dir) => {
      expect(await resolveDeckFilePath(dir, 'Black Panther')).toBe(
        path.join(dir, 'black-panther.md'),
      )
    })
  })

  test('refuses an ambiguous name rather than picking one', async () => {
    // Two decks whose names differ only in punctuation: the old lookup silently
    // returned whichever file came first.
    await withDecks(['Mono Red.md', 'mono-red.md'], async (dir) => {
      expect(await resolveDeckFilePath(dir, 'mono red')).toBeNull()
    })
  })

  test('returns null for an unknown deck and for a path escaping the decks dir', async () => {
    await withDecks(['Winota Stax.md'], async (dir) => {
      expect(await resolveDeckFilePath(dir, 'No Such Deck')).toBeNull()
      expect(await resolveDeckFilePath(dir, '../../etc/passwd')).toBeNull()
    })
  })
})
