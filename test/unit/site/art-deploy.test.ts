import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import {
  deployCardArt,
  undeployedArtFiles,
  type CardArtDeployResult,
} from '../../../src/site-build/art-deploy'
import { siteArtUrl } from '../../../src/list/art-url'

/**
 * The copy half of build-site's custom-art support: which files land in the
 * built tree, and what the build has to warn about. Sidecar parsing itself is
 * pinned in test/unit/card-art.test.ts.
 */
describe('deployCardArt', () => {
  let dir: string
  let artDir: string
  let buildDir: string
  let listsDir: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(tmpdir(), 'ritual-art-deploy-'))
    artDir = path.join(dir, 'art')
    buildDir = path.join(dir, 'build')
    listsDir = path.join(dir, 'decks')
    await fs.mkdir(artDir, { recursive: true })
    await fs.mkdir(buildDir, { recursive: true })
    await fs.mkdir(listsDir, { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  /** Write an art file with `content` at an art-dir-relative path. */
  async function writeArt(relPath: string, content: string): Promise<void> {
    const filePath = path.join(artDir, relPath)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, content)
  }

  /** Write a list's `.art.json` sidecar and return the list's `.md` path. */
  async function writeList(name: string, art: Record<string, unknown>): Promise<string> {
    const listFilePath = path.join(listsDir, `${name}.md`)
    await fs.writeFile(listFilePath, `# ${name}\n`)
    await fs.writeFile(path.join(listsDir, `${name}.art.json`), JSON.stringify(art))
    return listFilePath
  }

  function deploy(listFilePaths: readonly string[]): Promise<CardArtDeployResult> {
    return deployCardArt({ listFilePaths, artDir, buildDir })
  }

  test('copies referenced files into art/, keeping their relative path', async () => {
    await writeArt('proxies/sol-ring.png', 'ring')
    const list = await writeList('burn', { '5': { file: 'proxies/sol-ring.png' } })

    const result = await deploy([list])

    expect(result.warnings).toEqual([])
    expect(result.missing).toEqual([])
    expect(result.copied.map((f) => f.relPath)).toEqual(['proxies/sol-ring.png'])
    const dest = path.join(buildDir, 'art', 'proxies', 'sol-ring.png')
    expect(await Bun.file(dest).text()).toBe('ring')
    expect(result.copied[0]?.destPath).toBe(dest)
  })

  test('copies a file shared by two lists exactly once', async () => {
    await writeArt('shared.png', 'shared')
    const first = await writeList('one', { '1': { file: 'shared.png' } })
    const second = await writeList('two', {
      '2': { file: 'shared.png' },
      '3': { file: 'shared.png' },
    })

    const result = await deploy([first, second])

    expect(result.copied.map((f) => f.relPath)).toEqual(['shared.png'])
  })

  test('url references are not files and are never copied', async () => {
    const list = await writeList('urls', { '1': { url: 'https://example.test/bolt.png' } })

    const result = await deploy([list])

    expect(result.copied).toEqual([])
    expect(result.missing).toEqual([])
    // Nothing referenced a file, so the build tree gets no art directory at all.
    expect(await Bun.file(path.join(buildDir, 'art')).exists()).toBe(false)
  })

  test('a referenced file that is not on disk is reported once, by its raw path', async () => {
    await writeArt('here.png', 'here')
    const list = await writeList('mixed', {
      '1': { file: 'here.png' },
      '2': { file: 'gone.png' },
      '3': { file: 'gone.png' },
    })

    const result = await deploy([list])

    expect(result.missing).toEqual(['gone.png'])
    expect(result.copied.map((f) => f.relPath)).toEqual(['here.png'])
  })

  test('a directory in the art dir counts as missing, not as a copyable file', async () => {
    // Named like an image: a reference with no image extension never parses,
    // so the only way a directory reaches the copy step is by wearing one.
    await fs.mkdir(path.join(artDir, 'folder.png'), { recursive: true })
    const list = await writeList('dirref', { '1': { file: 'folder.png' } })

    const result = await deploy([list])

    expect(result.missing).toEqual(['folder.png'])
    expect(result.copied).toEqual([])
  })

  test('an unreadable sidecar warns and leaves the other lists deployed', async () => {
    await writeArt('good.png', 'good')
    const broken = path.join(listsDir, 'broken.md')
    await fs.writeFile(broken, '# broken\n')
    await fs.writeFile(path.join(listsDir, 'broken.art.json'), '{ not json')
    const good = await writeList('good', { '1': { file: 'good.png' } })

    const result = await deploy([broken, good])

    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]?.kind).toBe('sidecar-unreadable')
    expect(result.copied.map((f) => f.relPath)).toEqual(['good.png'])
  })

  test('a source the build cannot even stat warns instead of failing the build', async () => {
    await writeArt('good.png', 'good')
    // A symlink pointing at itself: stat fails with ELOOP, which is neither
    // ENOENT nor ENOTDIR, and used to abort the whole site build.
    await fs.symlink('loop.png', path.join(artDir, 'loop.png'))
    const list = await writeList('loops', {
      '1': { file: 'loop.png' },
      '2': { file: 'good.png' },
    })

    const result = await deploy([list])

    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toMatchObject({ kind: 'source-unreadable', relPath: 'loop.png' })
    // The rest of the build's art still lands.
    expect(result.copied.map((f) => f.relPath)).toEqual(['good.png'])
    // And the card gets no baked `customArt`, since nothing was deployed for it.
    expect(undeployedArtFiles(result)).toEqual(new Set(['loop.png']))
  })

  test('a list with no sidecar contributes nothing and is not an error', async () => {
    const bare = path.join(listsDir, 'bare.md')
    await fs.writeFile(bare, '# bare\n')

    const result = await deploy([bare])

    expect(result).toEqual({ copied: [], missing: [], warnings: [] })
  })

  /**
   * A list's `image:` cover is the second kind of local reference the build has
   * to deploy — it lives in the list's own front matter, not in any sidecar.
   */
  describe('list cover images', () => {
    /** Write a list file whose front matter carries the given `image:` block. */
    async function writeCoverList(name: string, imageYaml: string): Promise<string> {
      const listFilePath = path.join(listsDir, `${name}.md`)
      await fs.writeFile(listFilePath, `---\nimage:\n${imageYaml}---\n\n# ${name}\n`)
      return listFilePath
    }

    test('a cover file is copied like any other art reference', async () => {
      await writeArt('covers/atraxa.png', 'cover')
      const list = await writeCoverList('praetors', '  file: covers/atraxa.png\n')

      const result = await deploy([list])

      expect(result.copied.map((f) => f.relPath)).toEqual(['covers/atraxa.png'])
      expect(await fs.readFile(path.join(buildDir, 'art', 'covers', 'atraxa.png'), 'utf-8')).toBe(
        'cover',
      )
    })

    test('a cover file that is not on disk is reported as missing, not silently baked', async () => {
      const list = await writeCoverList('praetors', '  file: covers/gone.png\n')

      const result = await deploy([list])

      expect(result.missing).toEqual(['covers/gone.png'])
      expect(undeployedArtFiles(result)).toEqual(new Set(['covers/gone.png']))
    })

    test("a cover is deployed even when the list's art sidecar is unreadable", async () => {
      // The ordering this whole feature depends on: the sidecar guard abandons
      // the list, so a cover handled after it would be neither copied nor
      // reported — and the detail would bake a path with no file behind it.
      await writeArt('covers/atraxa.png', 'cover')
      const list = await writeCoverList('praetors', '  file: covers/atraxa.png\n')
      await fs.writeFile(path.join(listsDir, 'praetors.art.json'), '{ not json')

      const result = await deploy([list])

      expect(result.copied.map((f) => f.relPath)).toEqual(['covers/atraxa.png'])
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0]?.kind).toBe('sidecar-unreadable')
    })

    test('a cover a card sidecar also names is copied exactly once', async () => {
      await writeArt('shared.png', 'shared')
      const listFilePath = path.join(listsDir, 'shared.md')
      await fs.writeFile(listFilePath, '---\nimage:\n  file: shared.png\n---\n\n# shared\n')
      await fs.writeFile(
        path.join(listsDir, 'shared.art.json'),
        JSON.stringify({ '1': { file: 'shared.png' } }),
      )

      const result = await deploy([listFilePath])

      expect(result.copied.map((f) => f.relPath)).toEqual(['shared.png'])
    })

    test('card and url covers name no local file and contribute nothing', async () => {
      const byCard = await writeCoverList('bycard', '  card: 5\n')
      const byUrl = await writeCoverList('byurl', '  url: https://example.com/a.jpg\n')

      const result = await deploy([byCard, byUrl])

      expect(result).toEqual({ copied: [], missing: [], warnings: [] })
    })
  })

  test('undeployedArtFiles collects every path the build did not deploy', async () => {
    const result: CardArtDeployResult = {
      copied: [{ relPath: 'ok.png', sourcePath: 'a', destPath: 'b' }],
      missing: ['gone.png'],
      warnings: [
        { kind: 'sidecar-unreadable', listFilePath: 'decks/x.md', message: 'bad' },
        { kind: 'source-unreadable', relPath: 'loop.png', message: 'ELOOP' },
        { kind: 'copy-failed', relPath: 'denied.png', message: 'EACCES' },
      ],
    }

    // The sidecar warning names no file path — it is not an art file at all.
    expect(undeployedArtFiles(result)).toEqual(new Set(['gone.png', 'loop.png', 'denied.png']))
  })
})

describe('siteArtUrl', () => {
  test('prefixes the site art directory', () => {
    expect(siteArtUrl('proxies/sol-ring.png')).toBe('art/proxies/sol-ring.png')
  })

  test('encodes each segment but keeps the separators', () => {
    expect(siteArtUrl('my art/sol ring #1.png')).toBe('art/my%20art/sol%20ring%20%231.png')
  })
})
