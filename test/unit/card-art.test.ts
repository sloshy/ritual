import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  artSidecarPath,
  cardArtFilePath,
  isCardArtRefError,
  loadCardArt,
  parseCardArtInput,
  parseCardArtRef,
  parseCardArtSidecar,
  parseCardIdKey,
  reconcileCardArt,
  reconcileCardArtMap,
  reconciledArtPath,
  saveCardArt,
  serializeCardArtSidecar,
  type CardArtMap,
  type CardArtRef,
} from '../../src/card-art'

const testDir = path.join(import.meta.dir, '../.test-card-art')

const exists = (p: string): Promise<boolean> => Bun.file(p).exists()

/** The parsed art map, or a thrown failure naming the parse error. */
function unwrapArt(result: ReturnType<typeof parseCardArtSidecar>): CardArtMap {
  if (!result.ok) throw new Error(`expected a parse, got: ${result.message}`)
  return result.art
}

/** The rejection message of a single-reference parse, or a thrown failure. */
function refError(result: CardArtRef | { error: string }): string {
  if (!isCardArtRefError(result)) {
    throw new Error(`expected a rejection, got: ${JSON.stringify(result)}`)
  }
  return result.error
}

describe('artSidecarPath', () => {
  test('replaces the .md extension', () => {
    expect(artSidecarPath('/w/decks/Burn.md')).toBe('/w/decks/Burn.art.json')
  })

  test('only the trailing .md is replaced', () => {
    expect(artSidecarPath('/w/decks/Notes.md.md')).toBe('/w/decks/Notes.md.art.json')
  })
})

describe('parseCardArtSidecar', () => {
  test('reads file and url references keyed by card id', () => {
    const art = unwrapArt(
      parseCardArtSidecar(
        '{"5":{"file":"proxies/sol-ring.jpg"},"12":{"url":"https://example.test/bolt.png"}}',
      ),
    )
    expect(art.get(5)).toEqual({ file: 'proxies/sol-ring.jpg' })
    expect(art.get(12)).toEqual({ url: 'https://example.test/bolt.png' })
  })

  test('an empty object is an empty map, not a failure', () => {
    const result = parseCardArtSidecar('{}')
    expect(result.ok).toBe(true)
    expect(unwrapArt(result).size).toBe(0)
  })

  test('normalizes redundant path segments', () => {
    const art = unwrapArt(parseCardArtSidecar('{"1":{"file":"./proxies//sol-ring.jpg"}}'))
    expect(art.get(1)).toEqual({ file: 'proxies/sol-ring.jpg' })
  })

  test('rejects a file path that escapes the art directory', () => {
    const result = parseCardArtSidecar('{"1":{"file":"../../etc/passwd"}}')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('escapes the art directory')
  })

  test('rejects a path that only escapes after normalization', () => {
    const result = parseCardArtSidecar('{"1":{"file":"proxies/../../secrets.png"}}')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('escapes the art directory')
  })

  test('rejects an absolute file path', () => {
    const result = parseCardArtSidecar('{"1":{"file":"/var/art/bolt.png"}}')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('not absolute')
  })

  test('rejects a Windows drive-letter path, which is absolute too', () => {
    const result = parseCardArtSidecar('{"1":{"file":"C:/art/bolt.png"}}')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('not absolute')
  })

  test('rejects backslash separators, so one spelling stays canonical', () => {
    const result = parseCardArtSidecar('{"1":{"file":"proxies\\\\bolt.png"}}')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('forward slashes')
  })

  test('rejects a file whose extension is not an image the art route serves', () => {
    const result = parseCardArtSidecar('{"1":{"file":"notes.txt"}}')
    expect(result.ok).toBe(false)
    // The message names the whole allowlist: "not an image" alone leaves the
    // user guessing which formats are in.
    if (!result.ok) {
      expect(result.message).toContain('not an image file')
      expect(result.message).toContain('.png')
      expect(result.message).toContain('.webp')
    }
  })

  test('rejects a file with no extension at all', () => {
    const result = parseCardArtSidecar('{"1":{"file":"proxies/bolt"}}')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('not an image file')
  })

  test('accepts an image extension whatever its casing', () => {
    const art = unwrapArt(parseCardArtSidecar('{"1":{"file":"proxies/Bolt.PNG"}}'))
    // The path keeps the casing the file system has; only the check is folded.
    expect(art.get(1)).toEqual({ file: 'proxies/Bolt.PNG' })
  })

  test('rejects SVG, which can carry script on a same-origin route', () => {
    const result = parseCardArtSidecar('{"1":{"file":"bolt.svg"}}')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('not an image file')
  })

  test('a url needs no extension — the browser decides what it can render', () => {
    const art = unwrapArt(parseCardArtSidecar('{"1":{"url":"https://example.test/art?id=7"}}'))
    expect(art.get(1)).toEqual({ url: 'https://example.test/art?id=7' })
  })

  test('rejects a non-http(s) url', () => {
    const result = parseCardArtSidecar('{"1":{"url":"file:///etc/passwd"}}')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('http(s)')
  })

  test('rejects an entry carrying both a file and a url', () => {
    const result = parseCardArtSidecar('{"1":{"file":"a.png","url":"https://example.test/a.png"}}')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('not both')
  })

  test('rejects a key that is not a card id', () => {
    const result = parseCardArtSidecar('{"sol-ring":{"file":"a.png"}}')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('&N')
  })

  test('rejects malformed JSON and a non-object document', () => {
    expect(parseCardArtSidecar('{').ok).toBe(false)
    const array = parseCardArtSidecar('[{"file":"a.png"}]')
    expect(array.ok).toBe(false)
    if (!array.ok) expect(array.message).toContain('JSON object')
  })

  test('warns about ids the list no longer has, keeping the entries', () => {
    const result = parseCardArtSidecar('{"1":{"file":"a.png"},"9":{"file":"b.png"}}', {
      knownCardIds: new Set([1]),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Raw ids, deliberately unresolved: the cards they named are gone.
    expect(result.warnings).toEqual([{ kind: 'unknown-card-ids', ids: [9] }])
    expect(result.art.size).toBe(2)
  })

  test('warns about nothing when every id is still in the list', () => {
    const result = parseCardArtSidecar('{"1":{"file":"a.png"}}', { knownCardIds: new Set([1, 2]) })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.warnings).toEqual([])
  })
})

describe('parseCardArtRef', () => {
  test('rejects a reference with neither a file nor a url', () => {
    expect(refError(parseCardArtRef({}))).toContain('"file" or a "url"')
  })

  test('rejects unknown keys rather than dropping them on the next save', () => {
    expect(refError(parseCardArtRef({ file: 'a.png', scale: 2 }))).toContain('scale')
  })

  test('rejects a non-object reference', () => {
    expect(refError(parseCardArtRef('a.png'))).toContain('must be an object')
  })

  test('rejects a non-string file or url — JSON has no type check of its own', () => {
    expect(refError(parseCardArtRef({ file: 7 }))).toContain('"file" must be a string')
    expect(refError(parseCardArtRef({ url: ['https://example.test/a.png'] }))).toContain(
      '"url" must be a string',
    )
  })

  test('rejects an empty or whitespace-only file', () => {
    expect(refError(parseCardArtRef({ file: '   ' }))).toContain('must not be empty')
  })

  test('rejects a directory, which names no image', () => {
    // Both spellings the normalizer can leave behind: a bare `.` and a path
    // that ends in a separator.
    expect(refError(parseCardArtRef({ file: '.' }))).toContain('is a directory')
    expect(refError(parseCardArtRef({ file: 'proxies/' }))).toContain('is a directory')
  })

  test('rejects a url string the URL parser cannot read at all', () => {
    // Distinct from the http(s) check below it: this one never parses.
    expect(refError(parseCardArtRef({ url: 'https://' }))).toContain('is not a valid URL')
  })
})

describe('parseCardArtInput', () => {
  test('reads a bare path as a file reference', () => {
    expect(parseCardArtInput('  proxies/bolt.png  ')).toEqual({ file: 'proxies/bolt.png' })
  })

  test('reads an http(s) value as a url reference', () => {
    expect(parseCardArtInput('https://example.test/a.png')).toEqual({
      url: 'https://example.test/a.png',
    })
  })

  test('a mistyped scheme is reported as a bad URL, not read as a file name', () => {
    expect(refError(parseCardArtInput('ftp://example.test/a.png'))).toContain('http(s)')
  })

  test('rejects an empty value', () => {
    expect(refError(parseCardArtInput('   '))).toContain('must not be empty')
  })

  test('rejects a file that is not an image, where the user typed it', () => {
    expect(refError(parseCardArtInput('notes.txt'))).toContain('not an image file')
  })
})

describe('serializeCardArtSidecar', () => {
  test('writes numerically ascending keys, two-space indent and a trailing newline', () => {
    const art: CardArtMap = new Map([
      [12, { url: 'https://example.test/bolt.png' }],
      [5, { file: 'proxies/sol-ring.jpg' }],
    ])
    expect(serializeCardArtSidecar(art)).toBe(
      '{\n' +
        '  "5": {\n' +
        '    "file": "proxies/sol-ring.jpg"\n' +
        '  },\n' +
        '  "12": {\n' +
        '    "url": "https://example.test/bolt.png"\n' +
        '  }\n' +
        '}\n',
    )
  })

  test('round-trips through the parser', () => {
    const art: CardArtMap = new Map([
      [1, { file: 'a/b.png' }],
      [30, { url: 'https://example.test/c.png' }],
    ])
    expect(unwrapArt(parseCardArtSidecar(serializeCardArtSidecar(art)))).toEqual(art)
  })
})

describe('cardArtFilePath', () => {
  test('resolves a reference against the art directory', () => {
    expect(cardArtFilePath('/w/art', { file: 'proxies/bolt.png' })).toBe('/w/art/proxies/bolt.png')
  })
})

describe('loadCardArt / saveCardArt', () => {
  const listPath = path.join(testDir, 'Burn.md')

  beforeEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true })
    await fs.mkdir(testDir, { recursive: true })
    await fs.writeFile(listPath, '# Burn\n')
  })

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true })
  })

  test('an absent sidecar loads as empty art', async () => {
    const result = await loadCardArt(listPath)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.art.size).toBe(0)
  })

  test('saves and reloads the sidecar beside the list', async () => {
    const art: CardArtMap = new Map([[3, { file: 'bolt.png' }]])
    const saved = await saveCardArt(listPath, art)

    expect(saved).toEqual({ path: artSidecarPath(listPath), action: 'written' })
    const reloaded = await loadCardArt(listPath)
    expect(reloaded.ok).toBe(true)
    if (reloaded.ok) expect(reloaded.art).toEqual(art)
  })

  test('saving empty art removes the sidecar instead of writing an empty object', async () => {
    await saveCardArt(listPath, new Map([[3, { file: 'bolt.png' }]]))

    expect(await saveCardArt(listPath, new Map())).toEqual({
      path: artSidecarPath(listPath),
      action: 'removed',
    })
    expect(await exists(artSidecarPath(listPath))).toBe(false)
    // Nothing to remove the second time round.
    expect((await saveCardArt(listPath, new Map())).action).toBe('absent')
  })

  test('a malformed sidecar is reported, not silently read as no art', async () => {
    await fs.writeFile(artSidecarPath(listPath), '{"1":{"file":"../escape.png"}}\n')

    const result = await loadCardArt(listPath)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain(artSidecarPath(listPath))
      expect(result.message).toContain('escapes the art directory')
    }
  })

  test('a read that fails for anything but absence is reported, not read as no art', async () => {
    // A directory where the sidecar belongs: EISDIR, not ENOENT. Only "the file
    // is not there" may mean "this list has no art" — every other read failure
    // hides art that is still on disk, and treating it as empty would let the
    // next save delete the lot.
    await fs.mkdir(artSidecarPath(listPath), { recursive: true })

    const result = await loadCardArt(listPath)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain(artSidecarPath(listPath))
  })

  test('passes the known-id check through to the parser', async () => {
    await saveCardArt(listPath, new Map([[7, { file: 'bolt.png' }]]))

    const result = await loadCardArt(listPath, { knownCardIds: new Set([1]) })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.warnings).toEqual([{ kind: 'unknown-card-ids', ids: [7] }])
  })
})

describe('parseCardIdKey', () => {
  test('accepts a canonical positive integer', () => {
    expect(parseCardIdKey('1')).toBe(1)
    expect(parseCardIdKey('42')).toBe(42)
  })

  test('refuses everything that is not one, including what Number() would take', () => {
    for (const key of ['0', '01', ' 4', '4 ', '4.0', '1e3', '-2', '', 'x']) {
      expect(parseCardIdKey(key)).toBeNull()
    }
  })
})

describe('reconcileCardArtMap', () => {
  const art = (): CardArtMap =>
    new Map<number, CardArtRef>([
      [1, { file: 'bolt.png' }],
      [2, { url: 'https://example.com/ring.png' }],
    ])

  test('an empty reconcile changes nothing and keeps the same map', () => {
    const before = art()
    const result = reconcileCardArtMap(before, {})

    expect(result.changed).toBe(false)
    expect(result.art).toBe(before)
  })

  test('drops a removed card’s entry', () => {
    const result = reconcileCardArtMap(art(), { removed: [1] })

    expect(result.changed).toBe(true)
    expect([...result.art.keys()]).toEqual([2])
  })

  test('removing an id the sidecar never had is not a change', () => {
    expect(reconcileCardArtMap(art(), { removed: [99] }).changed).toBe(false)
  })

  test('re-files a renumbered entry under its new id', () => {
    const result = reconcileCardArtMap(art(), { renumbered: new Map([[1, 5]]) })

    expect(result.changed).toBe(true)
    expect(result.art.get(5)).toEqual({ file: 'bolt.png' })
    expect(result.art.has(1)).toBe(false)
  })

  test('a renumber wins the id an entry the same edit removed had held', () => {
    const result = reconcileCardArtMap(art(), {
      removed: [2],
      renumbered: new Map([[1, 2]]),
    })

    expect(result.art.get(2)).toEqual({ file: 'bolt.png' })
    expect(result.art.size).toBe(1)
  })

  test('installs a carried reference under the id the destination allocated', () => {
    const result = reconcileCardArtMap(new Map(), {
      added: new Map<number, CardArtRef>([[9, { file: 'bolt.png' }]]),
    })

    expect(result.changed).toBe(true)
    expect(result.art.get(9)).toEqual({ file: 'bolt.png' })
  })

  test('a re-add under a freed id survives the removal in the same reconcile', () => {
    const result = reconcileCardArtMap(art(), {
      removed: [1],
      added: new Map<number, CardArtRef>([[1, { url: 'https://example.com/new.png' }]]),
    })

    expect(result.art.get(1)).toEqual({ url: 'https://example.com/new.png' })
  })
})

describe('reconcileCardArt', () => {
  const listPath = path.join(testDir, 'Burn.md')

  beforeEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true })
    await fs.mkdir(testDir, { recursive: true })
    await fs.writeFile(listPath, '# Burn\n')
  })

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true })
  })

  test('an empty reconcile touches nothing at all', async () => {
    const result = await reconcileCardArt(listPath, {})

    expect(result).toEqual({ ok: true, changed: false })
    expect(reconciledArtPath(result)).toBeUndefined()
    // Not even a sidecar read: a list with no art gets no file written either.
    expect(await exists(artSidecarPath(listPath))).toBe(false)
  })

  test('a removal rewrites the sidecar and reports the path written', async () => {
    await saveCardArt(
      listPath,
      new Map<number, CardArtRef>([
        [1, { file: 'bolt.png' }],
        [2, { file: 'ring.png' }],
      ]),
    )

    const result = await reconcileCardArt(listPath, { removed: [1] })

    expect(reconciledArtPath(result)).toBe(artSidecarPath(listPath))
    const reloaded = await loadCardArt(listPath)
    expect(reloaded.ok && [...reloaded.art.keys()]).toEqual([2])
  })

  test('removing the last entry deletes the sidecar', async () => {
    await saveCardArt(listPath, new Map<number, CardArtRef>([[1, { file: 'bolt.png' }]]))

    const result = await reconcileCardArt(listPath, { removed: [1] })

    expect(result).toEqual({
      ok: true,
      changed: true,
      saved: { path: artSidecarPath(listPath), action: 'removed' },
    })
    expect(await exists(artSidecarPath(listPath))).toBe(false)
  })

  test('a reconcile that changes nothing does not rewrite the file', async () => {
    await saveCardArt(listPath, new Map<number, CardArtRef>([[1, { file: 'bolt.png' }]]))
    const before = await fs.stat(artSidecarPath(listPath))

    const result = await reconcileCardArt(listPath, { removed: [7] })

    expect(result).toEqual({ ok: true, changed: false })
    expect((await fs.stat(artSidecarPath(listPath))).mtimeMs).toBe(before.mtimeMs)
  })

  test('an unreadable sidecar is reported and left exactly as it was', async () => {
    await fs.writeFile(artSidecarPath(listPath), '{ not json')

    const result = await reconcileCardArt(listPath, { removed: [1] })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain(artSidecarPath(listPath))
    expect(await fs.readFile(artSidecarPath(listPath), 'utf-8')).toBe('{ not json')
  })
})
