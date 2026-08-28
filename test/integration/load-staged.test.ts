import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { loadStagedOrThrow } from '../../src/list/move-staging'
import { createWorkspace, removeWorkspace } from '../helpers/workspace'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await createWorkspace({ dirs: [], config: false })
})

afterEach(async () => {
  await removeWorkspace(tmpDir)
})

describe('loadStagedOrThrow', () => {
  test('a deck whose lines the write would lose throws with the abort wording and the refusal', async () => {
    const filePath = path.join(tmpDir, 'fenced.md')
    await fs.writeFile(
      filePath,
      ['# Fenced', '', '1 Sol Ring &1', '```', 'inside', '```', ''].join('\n'),
    )
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
    await expect(
      loadStagedOrThrow(
        { ref: { type: 'deck', name: 'Fenced' }, filePath },
        { missingKey: 'cli.move.abortDestinationMissing', abortKey: 'cli.move.abortMove' },
      ),
    ).rejects.toThrow(/^Aborting move: /)
  })
})
