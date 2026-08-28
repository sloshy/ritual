import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { loadCollectionSource } from '../../../src/site-build/collection'
import { loadDeckSource } from '../../../src/site-build/deck'
import { loadWantedSource } from '../../../src/site-build/wanted'
import { createWorkspace, removeWorkspace } from '../../helpers/workspace'

/**
 * What the detail loaders read beside a list file: the custom-art sidecar and
 * (for decks) the front-matter label default. Sidecar parsing itself is pinned
 * in test/unit/card-art.test.ts; this covers the loaders' warning channel, which
 * is what build-site prints and what the live server logs.
 */
describe('detail loaders: art sidecar', () => {
  let dir: string

  beforeEach(async () => {
    dir = await createWorkspace({ dirs: [], config: false })
  })

  afterEach(async () => {
    await removeWorkspace(dir)
  })

  async function writeList(name: string, content: string, art?: string): Promise<void> {
    await fs.writeFile(path.join(dir, `${name}.md`), content)
    if (art !== undefined) await fs.writeFile(path.join(dir, `${name}.art.json`), art)
  }

  test('a collection carries its art map, keyed by card id', async () => {
    await writeList(
      'binder',
      '# Binder\n\n- Arcane Signet (ECC:55) &1\n',
      '{ "1": { "file": "signet.jpg" } }',
    )

    const loaded = await loadCollectionSource(dir, 'binder')

    expect(typeof loaded).not.toBe('string')
    if (typeof loaded === 'string') return
    expect(loaded.art?.get(1)).toEqual({ file: 'signet.jpg' })
    expect(loaded.warnings).toHaveLength(0)
  })

  test('art for a card the list no longer has warns with the raw id, and is kept', async () => {
    await writeList(
      'binder',
      '# Binder\n\n- Arcane Signet (ECC:55) &1\n',
      '{ "1": { "file": "signet.jpg" }, "9": { "url": "https://example.com/gone.png" } }',
    )

    const loaded = await loadCollectionSource(dir, 'binder')

    if (typeof loaded === 'string') throw new Error(loaded)
    expect(loaded.warnings).toHaveLength(1)
    expect(loaded.warnings[0]).toContain('9')
    expect(loaded.art?.has(9)).toBe(true)
  })

  test('an unparseable sidecar warns and leaves the list with no art', async () => {
    await writeList('binder', '# Binder\n\n- Arcane Signet (ECC:55) &1\n', '{ "1": { "file": 3 } }')

    const loaded = await loadCollectionSource(dir, 'binder')

    if (typeof loaded === 'string') throw new Error(loaded)
    expect(loaded.warnings).toHaveLength(1)
    expect(loaded.warnings[0]).toContain('"file" must be a string')
    expect(loaded.art?.size).toBe(0)
  })

  test('a missing sidecar is the normal case: no art, no warning', async () => {
    await writeList('binder', '# Binder\n\n- Arcane Signet (ECC:55) &1\n')

    const loaded = await loadCollectionSource(dir, 'binder')

    if (typeof loaded === 'string') throw new Error(loaded)
    expect(loaded.art?.size).toBe(0)
    expect(loaded.warnings).toHaveLength(0)
  })

  test('a deck carries its front-matter label default and its art map', async () => {
    await writeList(
      'burn',
      '---\nname: Burn\nlabels:\n  - proxy\n---\n\n## Mainboard\n\n4 Lightning Bolt &1\n',
      '{ "1": { "url": "https://example.com/bolt.png" } }',
    )

    const loaded = await loadDeckSource(dir, 'burn')

    if (typeof loaded === 'string') throw new Error(loaded)
    expect(loaded.labels).toEqual(['proxy'])
    expect(loaded.art?.get(1)).toEqual({ url: 'https://example.com/bolt.png' })
  })
})

/**
 * The other thing the loaders read off a list file: its `image:` cover
 * override. The grammar lives in test/unit/list-image.test.ts; what is pinned
 * here is that all three loaders surface a usable value on `image` and report an
 * unusable one through the same warning channel the art sidecar uses — the
 * channel build-site prints and the live server logs.
 */
describe('detail loaders: list image', () => {
  let dir: string

  beforeEach(async () => {
    dir = await createWorkspace({ dirs: [], config: false })
  })

  afterEach(async () => {
    await removeWorkspace(dir)
  })

  const write = (name: string, content: string): Promise<void> =>
    fs.writeFile(path.join(dir, `${name}.md`), content)

  test('a deck carries its cover override', async () => {
    await write(
      'burn',
      '---\nname: Burn\nimage:\n  card: 1\n---\n\n## Mainboard\n\n4 Lightning Bolt &1\n',
    )

    const loaded = await loadDeckSource(dir, 'burn')

    if (typeof loaded === 'string') throw new Error(loaded)
    expect(loaded.image).toEqual({ card: 1 })
    expect(loaded.warnings).toHaveLength(0)
  })

  test('a collection carries its cover override', async () => {
    await write(
      'binder',
      '---\nimage:\n  file: covers/binder.png\n---\n\n# Binder\n\n- Arcane Signet (ECC:55) &1\n',
    )

    const loaded = await loadCollectionSource(dir, 'binder')

    if (typeof loaded === 'string') throw new Error(loaded)
    expect(loaded.image).toEqual({ file: 'covers/binder.png' })
    expect(loaded.warnings).toHaveLength(0)
  })

  test('both flat list types carry their description', async () => {
    await write(
      'binder',
      '---\ndescription: Everything I will trade away.\n---\n\n# Binder\n\n- Arcane Signet (ECC:55) &1\n',
    )
    const binder = await loadCollectionSource(dir, 'binder')
    if (typeof binder === 'string') throw new Error(binder)
    expect(binder.description).toBe('Everything I will trade away.')
    expect(binder.warnings).toHaveLength(0)

    await write('wants', '---\ndescription: Cards I need.\n---\n\n# Wants\n\n- Arcane Signet &1\n')
    const wants = await loadWantedSource(dir, 'wants')
    if (typeof wants === 'string') throw new Error(wants)
    expect(wants.description).toBe('Cards I need.')
    expect(wants.warnings).toHaveLength(0)
  })

  test('a description that is not text warns and leaves the list without one', async () => {
    await write('bad', '---\ndescription:\n  text: nope\n---\n\n# Bad\n\n- Arcane Signet &1\n')

    const bad = await loadWantedSource(dir, 'bad')

    if (typeof bad === 'string') throw new Error(bad)
    expect(bad.description).toBeUndefined()
    expect(bad.warnings.some((warning) => warning.includes("'description' ignored"))).toBeTrue()
  })

  test('a deck reports a dropped description too, and drops a blank one silently', async () => {
    // The deck path validates front matter into a typed shape, so the drop is
    // read back off the raw block — the same audibility the flat lists have.
    await write('burn', '---\nname: Burn\ndescription:\n  text: nope\n---\n\n4 Lightning Bolt &1\n')
    const bad = await loadDeckSource(dir, 'burn')
    if (typeof bad === 'string') throw new Error(bad)
    expect(bad.data.description).toBeUndefined()
    expect(bad.warnings.some((warning) => warning.includes("'description' ignored"))).toBeTrue()

    // Blank says nothing on every list type, so it reads as absent with no word.
    await write('blank', '---\nname: Blank\ndescription: "   "\n---\n\n4 Lightning Bolt &1\n')
    const blank = await loadDeckSource(dir, 'blank')
    if (typeof blank === 'string') throw new Error(blank)
    expect(blank.data.description).toBeUndefined()
    expect(blank.warnings).toHaveLength(0)
  })

  test('a wanted list carries its cover override — one of its two front-matter keys', async () => {
    await write(
      'wants',
      '---\nimage:\n  url: https://example.com/cover.jpg\n---\n\n# Wants\n\n- Arcane Signet &1\n',
    )

    const loaded = await loadWantedSource(dir, 'wants')

    if (typeof loaded === 'string') throw new Error(loaded)
    expect(loaded.image).toEqual({ url: 'https://example.com/cover.jpg' })
    expect(loaded.warnings).toHaveLength(0)
  })

  test('an unusable cover value warns and leaves the list on the built-in cover', async () => {
    // A scalar is not the grammar: `image: alters/x.png` has no mapping key, so
    // it is reported rather than guessed at.
    await write(
      'binder',
      '---\nimage: alters/x.png\n---\n\n# Binder\n\n- Arcane Signet (ECC:55) &1\n',
    )

    const loaded = await loadCollectionSource(dir, 'binder')

    if (typeof loaded === 'string') throw new Error(loaded)
    expect(loaded.image).toBeUndefined()
    expect(loaded.warnings).toHaveLength(1)
    expect(loaded.warnings[0]).toContain("'image' ignored")
  })

  test('a deck reports an unusable cover too, rather than dropping it silently', async () => {
    // The deck path is the asymmetric one: `validateDeckFrontMatter` drops the
    // key, and the deck's next whole-file save would delete it from the user's
    // file — so the drop has to be audible here, as it is on a flat list.
    await write(
      'burn',
      '---\nname: Burn\nimage:\n  card: 0\n---\n\n## Mainboard\n\n4 Lightning Bolt &1\n',
    )

    const loaded = await loadDeckSource(dir, 'burn')

    if (typeof loaded === 'string') throw new Error(loaded)
    expect(loaded.image).toBeUndefined()
    expect(loaded.warnings.some((warning) => warning.includes("'image' ignored"))).toBeTrue()
  })

  test("a flat list's own front-matter advisories reach the same channel", async () => {
    // Unreadable YAML: the block round-trips verbatim, so this is an advisory —
    // but it is one the user must hear, exactly like an ignored cover.
    await write('binder', '---\nlabels: [\n---\n\n# Binder\n\n- Arcane Signet (ECC:55) &1\n')

    const loaded = await loadCollectionSource(dir, 'binder')

    if (typeof loaded === 'string') throw new Error(loaded)
    expect(
      loaded.warnings.some((warning) => warning.includes('could not be read as YAML')),
    ).toBeTrue()
  })
})
