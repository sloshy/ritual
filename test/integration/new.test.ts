import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { parseDeckFrontMatter } from '../../src/deck-file'
import { runCli } from './helpers/cli'
import { withWorkspace } from './helpers/workspace'

describe('new CLI (Integration)', () => {
  test('names the file as the deck is named, with the default commander format', async () => {
    await withWorkspace(async (dir) => {
      const result = await runCli(['new', 'deck', 'My Cool Deck'], dir)
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

  test('creates collections and wanted lists as bare H1 files', async () => {
    await withWorkspace(async (dir) => {
      expect((await runCli(['new', 'collection', 'My Binder'], dir)).exitCode).toBe(0)
      expect((await runCli(['new', 'wanted', 'Grail List'], dir)).exitCode).toBe(0)

      const collection = await fs.readFile(path.join(dir, 'collections', 'My Binder.md'), 'utf-8')
      expect(collection).toBe('# My Binder\n\n')
      const wanted = await fs.readFile(path.join(dir, 'wanted', 'Grail List.md'), 'utf-8')
      expect(wanted).toBe('# Grail List\n\n')
    })
  })

  test('keeps punctuation, stripping only filename-illegal characters', async () => {
    await withWorkspace(async (dir) => {
      const result = await runCli(['new', 'deck', "Atraxa: Praetors' Voice? <Stax>"], dir)
      expect(result.exitCode).toBe(0)

      // `: ? < >` are illegal on Windows and are dropped; the apostrophe and the
      // spaces survive. The display name keeps every character.
      const filePath = path.join(dir, 'decks', "Atraxa Praetors' Voice Stax.md")
      const frontMatter = await parseDeckFrontMatter(filePath)
      expect(frontMatter.name).toBe("Atraxa: Praetors' Voice? <Stax>")
    })
  })

  test('rejects an unknown list type', async () => {
    await withWorkspace(async (dir) => {
      const result = await runCli(['new', 'binder', 'Whatever'], dir)
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain("Invalid list type 'binder'")
    })
  })

  test('rejects a name with no usable filename characters', async () => {
    await withWorkspace(async (dir) => {
      const result = await runCli(['new', 'deck', '???'], dir)
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('no characters usable in a file name')

      expect(await fs.readdir(path.join(dir, 'decks'))).toEqual([])
    })
  })

  test('--format overrides the default', async () => {
    await withWorkspace(async (dir) => {
      const result = await runCli(['new', 'deck', 'Stompy', '--format', 'modern'], dir)
      expect(result.exitCode).toBe(0)

      const frontMatter = await parseDeckFrontMatter(path.join(dir, 'decks', 'Stompy.md'))
      expect(frontMatter.format).toBe('modern')
    })
  })

  test('--format is stored as its canonical key', async () => {
    await withWorkspace(async (dir) => {
      const result = await runCli(['new', 'deck', 'Kenrith', '--format', 'EDH'], dir)
      expect(result.exitCode).toBe(0)

      const frontMatter = await parseDeckFrontMatter(path.join(dir, 'decks', 'Kenrith.md'))
      expect(frontMatter.format).toBe('commander')
    })
  })

  test('rejects an unknown --format without writing a file', async () => {
    await withWorkspace(async (dir) => {
      const result = await runCli(['new', 'deck', 'Cube', '--format', 'cube'], dir)
      // Invalid user input is a usage error (exit code 2).
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain("Invalid deck format 'cube'")

      expect(await fs.exists(path.join(dir, 'decks', 'Cube.md'))).toBe(false)
    })
  })

  test('rejects --format for non-deck lists', async () => {
    await withWorkspace(async (dir) => {
      const result = await runCli(['new', 'collection', 'Binder', '--format', 'modern'], dir)
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('--format only applies to decks')

      expect(await fs.exists(path.join(dir, 'collections', 'Binder.md'))).toBe(false)
    })
  })

  test('refuses to overwrite an existing deck file', async () => {
    await withWorkspace(async (dir) => {
      const filePath = path.join(dir, 'decks', 'Existing.md')
      const original = '---\nname: "Existing"\n---\n\nDo not touch.\n'
      await fs.writeFile(filePath, original)

      const result = await runCli(['new', 'deck', 'Existing'], dir)
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('already exists')

      // The pre-existing file must remain untouched on the refusal path.
      const after = await fs.readFile(filePath, 'utf-8')
      expect(after).toBe(original)
    })
  })

  test('--output json emits the created list summary', async () => {
    await withWorkspace(async (dir) => {
      const result = await runCli(['new', 'deck', 'Json Deck', '--output', 'json'], dir)
      expect(result.exitCode).toBe(0)

      const payload = JSON.parse(result.stdout) as {
        type: string
        slug: string
        name: string
        filePath: string
      }
      expect(payload).toEqual({
        type: 'deck',
        slug: 'Json Deck',
        name: 'Json Deck',
        filePath: path.join(dir, 'decks', 'Json Deck.md'),
      })
    })
  })
})
