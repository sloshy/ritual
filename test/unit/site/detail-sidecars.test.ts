import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { loadCollectionSource } from '../../../src/site/details/collection'
import { loadDeckSource } from '../../../src/site/details/deck'

/**
 * What the detail loaders read beside a list file: the custom-art sidecar and
 * (for decks) the front-matter label default. Sidecar parsing itself is pinned
 * in test/unit/card-art.test.ts; this covers the loaders' warning channel, which
 * is what build-site prints and what the live server logs.
 */
describe('detail loaders: art sidecar', () => {
  let dir: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(tmpdir(), 'ritual-detail-sidecar-'))
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
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
