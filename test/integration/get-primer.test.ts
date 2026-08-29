import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { runCli, withTempDir } from './helpers/cli'
import { writeDeckFile } from '../helpers/workspace'

/**
 * `get-primer` distinguishes "this deck has no primer" from "fetching it broke":
 * an absent sidecar is a missing resource (exit 3), so a script can branch on
 * the exit code alone.
 */
describe('get-primer command (Integration)', () => {
  test('prints the primer sidecar and exits 0', async () => {
    await withTempDir(async (dir) => {
      await writeDeckFile(dir, 'burn', {
        name: 'Burn',
        frontMatter: { format: 'modern' },
        cards: [{ quantity: 1, name: 'Lightning Bolt', cardId: 1 }],
      })
      await fs.writeFile(
        path.join(dir, 'decks', 'burn.primer.md'),
        '# Burn\n\nPoint the red cards at the face.\n',
      )

      const result = await runCli(['get-primer', 'burn'], dir)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Point the red cards at the face.')
    })
  })

  test('a deck with no primer sidecar is not-found, not a runtime error', async () => {
    await withTempDir(async (dir) => {
      await writeDeckFile(dir, 'burn', {
        name: 'Burn',
        frontMatter: { format: 'modern' },
        cards: [{ quantity: 1, name: 'Lightning Bolt', cardId: 1 }],
      })

      const result = await runCli(['get-primer', 'burn'], dir)

      expect(result.exitCode).toBe(3)
      expect(result.stderr).toContain('has no primer (.primer.md sidecar)')
      expect(result.stdout).toBe('')
    })
  })

  test('an unknown deck name is not-found', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['get-primer', 'no-such-deck'], dir)

      expect(result.exitCode).toBe(3)
    })
  })
})
