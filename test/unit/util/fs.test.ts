import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileExists, fileExistsExactly } from '../../../src/util/fs'
import { withWorkspace } from '../../helpers/workspace'

describe('fileExistsExactly', () => {
  test('matches the name as spelled, where a path lookup may match any casing', async () => {
    await withWorkspace(async (dir) => {
      await fs.writeFile(path.join(dir, 'Atraxa Binder.md'), '')

      expect(await fileExistsExactly(path.join(dir, 'Atraxa Binder.md'))).toBeTrue()
      // On a case-insensitive file system (macOS, Windows) fileExists says yes
      // to this spelling; the exact check never does.
      expect(await fileExistsExactly(path.join(dir, 'atraxa binder.md'))).toBeFalse()
      expect(await fileExists(path.join(dir, 'Atraxa Binder.md'))).toBeTrue()
    })
  })

  test('is false for a missing file and for a missing directory', async () => {
    await withWorkspace(async (dir) => {
      expect(await fileExistsExactly(path.join(dir, 'Nope.md'))).toBeFalse()
      expect(await fileExistsExactly(path.join(dir, 'no-such-dir', 'Nope.md'))).toBeFalse()
    })
  })
})
