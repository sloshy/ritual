import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { renameWithRetry, writeFileAtomic } from '../../src/util/atomic-write'
import { MemoryFileSystemClient } from '../test-utils'
import { withWorkspace } from '../helpers/workspace'

/** An empty scratch directory: the subject is the only thing that writes to it. */
function inEmptyDir(run: (dir: string) => Promise<void>): Promise<void> {
  return withWorkspace(run, { dirs: [], config: false })
}

const posixOnly = test.skipIf(process.platform === 'win32' || process.getuid?.() === 0)

describe('writeFileAtomic', () => {
  test('replaces a file and leaves no temp file behind', async () => {
    await inEmptyDir(async (dir) => {
      const file = path.join(dir, 'List.md')
      await fs.writeFile(file, 'old\n')
      await writeFileAtomic(file, 'new\n')
      expect(await fs.readFile(file, 'utf-8')).toBe('new\n')
      expect(await fs.readdir(dir)).toEqual(['List.md'])
    })
  })

  test('concurrent writes to one path all succeed, and the file holds one of them whole', async () => {
    await inEmptyDir(async (dir) => {
      const file = path.join(dir, 'List.md')
      const contents = Array.from({ length: 8 }, (_, i) => `${String(i).repeat(4096)}\n`)
      await Promise.all(contents.map((content) => writeFileAtomic(file, content)))
      expect(contents).toContain(await fs.readFile(file, 'utf-8'))
      expect(await fs.readdir(dir)).toEqual(['List.md'])
    })
  })

  test('writes through a symlink, which stays a symlink', async () => {
    await inEmptyDir(async (dir) => {
      const target = path.join(dir, 'real.md')
      const link = path.join(dir, 'List.md')
      await fs.writeFile(target, 'old\n')
      await fs.symlink(target, link)
      await writeFileAtomic(link, 'new\n')
      expect((await fs.lstat(link)).isSymbolicLink()).toBeTrue()
      expect(await fs.readFile(target, 'utf-8')).toBe('new\n')
    })
  })

  posixOnly('gives the file the requested mode, even when it replaces a wider one', async () => {
    await inEmptyDir(async (dir) => {
      const file = path.join(dir, 'secret.json')
      await fs.writeFile(file, '{}', { mode: 0o644 })
      await writeFileAtomic(file, '{"token":"x"}', { mode: 0o600 })
      expect((await fs.stat(file)).mode & 0o777).toBe(0o600)
    })
  })

  posixOnly('keeps a replaced file’s mode when none is requested', async () => {
    await inEmptyDir(async (dir) => {
      const file = path.join(dir, 'List.md')
      await fs.writeFile(file, 'old\n')
      await fs.chmod(file, 0o640)
      await writeFileAtomic(file, 'new\n')
      expect((await fs.stat(file)).mode & 0o777).toBe(0o640)
    })
  })

  posixOnly('replaces a read-only file, since the folder decides', async () => {
    await inEmptyDir(async (dir) => {
      const file = path.join(dir, 'List.md')
      await fs.writeFile(file, 'old\n')
      await fs.chmod(file, 0o444)
      await writeFileAtomic(file, 'new\n')
      expect(await fs.readFile(file, 'utf-8')).toBe('new\n')
    })
  })

  describe('a failure removes the temp file and keeps the old content', () => {
    test.each([
      [
        'a failed rename',
        class extends MemoryFileSystemClient {
          override async rename(): Promise<void> {
            throw new Error('refused')
          }
        },
      ],
      [
        'a temp write that fails part-way (a full disk)',
        class extends MemoryFileSystemClient {
          override async writeFile(filePath: string, data: string | Uint8Array): Promise<void> {
            await super.writeFile(filePath, String(data).slice(0, 2))
            throw new Error('refused')
          }
        },
      ],
    ])('%s', async (_label, FailingFileSystem) => {
      const fileSystem = new FailingFileSystem()
      fileSystem.files.set('/w/List.md', 'old\n')
      // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
      await expect(writeFileAtomic('/w/List.md', 'new\n', { fs: fileSystem })).rejects.toThrow(
        'refused',
      )
      expect([...fileSystem.files]).toEqual([['/w/List.md', 'old\n']])
    })
  })
})

describe('renameWithRetry', () => {
  /** A rename stub, and how many times it was called. */
  type FlakyRename = { rename: () => Promise<void>; calls: () => number }

  /** A rename that fails with `codes`, one per call, then succeeds. */
  function flakyRename(codes: string[]): FlakyRename {
    let calls = 0
    return {
      rename: async () => {
        const code = codes[calls++]
        if (code !== undefined) throw Object.assign(new Error(code), { code })
      },
      calls: () => calls,
    }
  }

  test('waits out a file Windows briefly holds open', async () => {
    const flaky = flakyRename(['EPERM', 'EBUSY'])
    await renameWithRetry('/a', '/b', { rename: flaky.rename, platform: 'win32' })
    expect(flaky.calls()).toBe(3)
  })

  test.each([
    ['a lasting error on Windows', ['ENOENT'], 'win32'],
    ['a Windows lock error elsewhere', ['EPERM'], 'linux'],
  ] as const)('gives up at once on %s', async (_label, codes, platform) => {
    const flaky = flakyRename([...codes])
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
    await expect(renameWithRetry('/a', '/b', { rename: flaky.rename, platform })).rejects.toThrow(
      codes[0],
    )
    expect(flaky.calls()).toBe(1)
  })
})
