import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { parseDeckFrontMatter } from '../../src/deck-file'
import { runCli } from './helpers/cli'
import { withWorkspace } from './helpers/workspace'

describe('new-deck CLI (Integration)', () => {
  test('creates a deck file with a slug derived from the name and default commander format', async () => {
    await withWorkspace(async (dir) => {
      const result = await runCli(['new-deck', 'My Cool Deck'], dir)
      expect(result.exitCode).toBe(0)

      const filePath = path.join(dir, 'decks', 'my-cool-deck.md')
      // Frontmatter preserves the original display name verbatim while the file
      // name is the slugified form. Default format is commander.
      const frontMatter = await parseDeckFrontMatter(filePath)
      expect(frontMatter.name).toBe('My Cool Deck')
      expect(frontMatter.format).toBe('commander')
      expect(await fs.readFile(filePath, 'utf-8')).toContain('## Main')
    })
  })

  test('slugifies punctuation-heavy names into kebab-case', async () => {
    await withWorkspace(async (dir) => {
      const result = await runCli(['new-deck', "Atraxa's Praetorian!! ++Stax++"], dir)
      expect(result.exitCode).toBe(0)

      // Non-alphanumerics collapse to single hyphens and leading/trailing hyphens are
      // stripped. The test fixes the slug shape so the rule changes are obvious.
      const filePath = path.join(dir, 'decks', 'atraxa-s-praetorian-stax.md')
      // The slug rewrite must not leak into the frontmatter — the display name
      // is preserved verbatim, punctuation and all.
      const frontMatter = await parseDeckFrontMatter(filePath)
      expect(frontMatter.name).toBe("Atraxa's Praetorian!! ++Stax++")
    })
  })

  test('--format overrides the default', async () => {
    await withWorkspace(async (dir) => {
      const result = await runCli(['new-deck', 'Stompy', '--format', 'modern'], dir)
      expect(result.exitCode).toBe(0)

      const frontMatter = await parseDeckFrontMatter(path.join(dir, 'decks', 'stompy.md'))
      expect(frontMatter.format).toBe('modern')
    })
  })

  test('--format is stored as its canonical key', async () => {
    await withWorkspace(async (dir) => {
      const result = await runCli(['new-deck', 'Kenrith', '--format', 'EDH'], dir)
      expect(result.exitCode).toBe(0)

      const frontMatter = await parseDeckFrontMatter(path.join(dir, 'decks', 'kenrith.md'))
      expect(frontMatter.format).toBe('commander')
    })
  })

  test('rejects an unknown --format without writing a file', async () => {
    await withWorkspace(async (dir) => {
      const result = await runCli(['new-deck', 'Cube', '--format', 'cube'], dir)
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain("Invalid deck format 'cube'")

      expect(await fs.exists(path.join(dir, 'decks', 'cube.md'))).toBe(false)
    })
  })

  test('refuses to overwrite an existing deck file', async () => {
    await withWorkspace(async (dir) => {
      const filePath = path.join(dir, 'decks', 'existing.md')
      const original = '---\nname: "Existing"\n---\n\nDo not touch.\n'
      await fs.writeFile(filePath, original)

      const result = await runCli(['new-deck', 'Existing'], dir)
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('already exists')

      // The pre-existing file must remain untouched on the refusal path.
      const after = await fs.readFile(filePath, 'utf-8')
      expect(after).toBe(original)
    })
  })
})
