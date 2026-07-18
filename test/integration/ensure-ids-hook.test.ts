import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { runCli } from './helpers/cli'
import { withWorkspace } from './helpers/workspace'

/**
 * Pins the root preAction hook in index.ts: commands in the
 * COMMANDS_WITHOUT_LIST_IDS skip set must never trigger the file-writing
 * card-ID backfill, while every other command backfills missing `&N` ids
 * before its action runs.
 */
describe('card-ID backfill preAction hook (Integration)', () => {
  test('a skip-set command leaves an id-less list untouched; a non-skipped one backfills ids', async () => {
    await withWorkspace(async (dir) => {
      // Raw markdown, deliberately not the fixture serializer — it assigns
      // card IDs, and this test needs an id-less line on disk.
      const deckPath = path.join(dir, 'decks', 'test.md')
      const original = '---\nname: Test Deck\n---\n\n## Main\n\n1 Sol Ring\n'
      await fs.writeFile(deckPath, original)

      // `lists` is in the skip set: the file must stay byte-identical.
      const lists = await runCli(['lists'], dir)
      expect(lists.exitCode).toBe(0)
      expect(await fs.readFile(deckPath, 'utf-8')).toBe(original)

      // `hash` is not skipped: the hook assigns the missing id before it runs.
      const hash = await runCli(['hash'], dir)
      expect(hash.exitCode).toBe(0)
      const after = await fs.readFile(path.join(dir, 'decks', 'test.md'), 'utf-8')
      expect(after).toContain('1 Sol Ring &1')
    })
  })
})
