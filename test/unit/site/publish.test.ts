import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import {
  buildAndPublish,
  createBuildScratchDir,
  publishAtomically,
} from '../../../src/site/publish'

/**
 * The scratch-and-swap seam shared by `ritual build-site` and the admin build
 * route: the published directory holds the previous tree or the new one, never
 * a half-written one.
 */
describe('site publish', () => {
  let root: string
  let distDir: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(tmpdir(), 'ritual-publish-'))
    distDir = path.join(root, 'dist')
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  const writePrevious = async (marker: string): Promise<void> => {
    await fs.mkdir(distDir, { recursive: true })
    await fs.writeFile(path.join(distDir, 'index.html'), marker)
  }

  const read = (file: string): Promise<string> => fs.readFile(path.join(distDir, file), 'utf-8')

  test('the published directory is readable by whoever serves it', async () => {
    // The scratch directory *becomes* dist/, and `mkdtemp` makes it 0700 — so
    // without a reset the published site was enterable only by its owner, and a
    // deploy that serves it as nginx/www-data broke. `mkdir`'s mode is the
    // baseline it replaced.
    const expected = 0o777 & ~process.umask()

    await buildAndPublish(distDir, async (buildDir) => {
      await fs.writeFile(path.join(buildDir, 'index.html'), 'new')
      return true
    })

    expect((await fs.stat(distDir)).mode & 0o777).toBe(expected)
  })

  test('a successful build replaces the previous site', async () => {
    await writePrevious('old')
    const published = await buildAndPublish(distDir, async (buildDir) => {
      await fs.writeFile(path.join(buildDir, 'index.html'), 'new')
      return true
    })
    expect(published).toBe(true)
    expect(await read('index.html')).toBe('new')
  })

  test('a build that reports failure leaves the previous site published', async () => {
    await writePrevious('old')
    const published = await buildAndPublish(distDir, async (buildDir) => {
      await fs.writeFile(path.join(buildDir, 'index.html'), 'half-written')
      return false
    })
    expect(published).toBe(false)
    expect(await read('index.html')).toBe('old')
  })

  test('a build that throws leaves the previous site published and cleans up', async () => {
    await writePrevious('old')
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
    await expect(
      buildAndPublish(distDir, async (buildDir) => {
        await fs.writeFile(path.join(buildDir, 'index.html'), 'half-written')
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(await read('index.html')).toBe('old')
    const leftovers = (await fs.readdir(root)).filter((n) => n.startsWith('.dist-build-'))
    expect(leftovers).toEqual([])
  })

  test('publishing into a directory that does not exist yet works', async () => {
    const published = await buildAndPublish(distDir, async (buildDir) => {
      await fs.writeFile(path.join(buildDir, 'index.html'), 'first')
      return true
    })
    expect(published).toBe(true)
    expect(await read('index.html')).toBe('first')
  })

  test('the scratch directory is created beside the target, so the swap is a rename', async () => {
    const scratch = await createBuildScratchDir(distDir)
    expect(path.dirname(scratch)).toBe(root)
    await fs.writeFile(path.join(scratch, 'index.html'), 'swapped')
    await publishAtomically(scratch, distDir)
    expect(await read('index.html')).toBe('swapped')
  })
})
