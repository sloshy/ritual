import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { parseDeckFrontMatter } from '../../src/deck-file'
import { runCli } from './helpers/cli'
import { withWorkspace } from './helpers/workspace'

describe('new-deck CLI (Integration)', () => {
  test('names the file as the deck is named, with the default commander format', async () => {
    await withWorkspace(async (dir) => {
      const result = await runCli(['new-deck', 'My Cool Deck'], dir)
      expect(result.exitCode).toBe(0)

      // The file is named exactly as entered — case and spaces preserved, not
      // lowercased or kebab-cased.
      const filePath = path.join(dir, 'decks', 'My Cool Deck.md')
      const frontMatter = await parseDeckFrontMatter(filePath)
      expect(frontMatter.name).toBe('My Cool Deck')
      expect(frontMatter.format).toBe('commander')
      expect(await fs.readFile(filePath, 'utf-8')).toContain('## Main')
    })
  })

  test('keeps punctuation, stripping only filename-illegal characters', async () => {
    await withWorkspace(async (dir) => {
      const result = await runCli(['new-deck', "Atraxa: Praetors' Voice? <Stax>"], dir)
      expect(result.exitCode).toBe(0)

      // `: ? < >` are illegal on Windows and are dropped; the apostrophe and the
      // spaces survive. The display name keeps every character.
      const filePath = path.join(dir, 'decks', "Atraxa Praetors' Voice Stax.md")
      const frontMatter = await parseDeckFrontMatter(filePath)
      expect(frontMatter.name).toBe("Atraxa: Praetors' Voice? <Stax>")
    })
  })

  test('rejects a name with no usable filename characters', async () => {
    await withWorkspace(async (dir) => {
      const result = await runCli(['new-deck', '???'], dir)
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('no characters usable in a file name')

      expect(await fs.readdir(path.join(dir, 'decks'))).toEqual([])
    })
  })

  test('--format overrides the default', async () => {
    await withWorkspace(async (dir) => {
      const result = await runCli(['new-deck', 'Stompy', '--format', 'modern'], dir)
      expect(result.exitCode).toBe(0)

      const frontMatter = await parseDeckFrontMatter(path.join(dir, 'decks', 'Stompy.md'))
      expect(frontMatter.format).toBe('modern')
    })
  })

  test('--format is stored as its canonical key', async () => {
    await withWorkspace(async (dir) => {
      const result = await runCli(['new-deck', 'Kenrith', '--format', 'EDH'], dir)
      expect(result.exitCode).toBe(0)

      const frontMatter = await parseDeckFrontMatter(path.join(dir, 'decks', 'Kenrith.md'))
      expect(frontMatter.format).toBe('commander')
    })
  })

  test('rejects an unknown --format without writing a file', async () => {
    await withWorkspace(async (dir) => {
      const result = await runCli(['new-deck', 'Cube', '--format', 'cube'], dir)
      // Invalid user input is a usage error (exit code 2).
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain("Invalid deck format 'cube'")

      expect(await fs.exists(path.join(dir, 'decks', 'Cube.md'))).toBe(false)
    })
  })

  test('refuses to overwrite an existing deck file', async () => {
    await withWorkspace(async (dir) => {
      const filePath = path.join(dir, 'decks', 'Existing.md')
      const original = '---\nname: "Existing"\n---\n\nDo not touch.\n'
      await fs.writeFile(filePath, original)

      const result = await runCli(['new-deck', 'Existing'], dir)
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('already exists')

      // The pre-existing file must remain untouched on the refusal path.
      const after = await fs.readFile(filePath, 'utf-8')
      expect(after).toBe(original)
    })
  })
})
