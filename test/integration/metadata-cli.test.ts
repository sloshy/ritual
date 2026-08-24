import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { runCli } from './helpers/cli'
import {
  createWorkspace,
  removeWorkspace,
  writeCollectionFile,
  writeDeckFile,
  writeWantedFile,
} from './helpers/workspace'

/**
 * `ritual metadata` — the scripting surface over list front matter. The write
 * engines (merge semantics, body preservation, sidecar rule) are pinned by the
 * deck/collection metadata API tests; what belongs here per the layering
 * policy is the CLI wiring: argument/flag handling, value coercion, exit
 * codes, and one representative file side effect per path.
 */

describe('metadata CLI (Integration)', () => {
  let dir: string

  beforeEach(async () => {
    dir = await createWorkspace()
  })

  afterEach(async () => {
    await removeWorkspace(dir)
  })

  test('set/get/unset round-trip a collection labels default, card lines untouched', async () => {
    const filePath = await writeCollectionFile(dir, 'binder', {
      entries: [
        { name: 'Sol Ring', set: 'c21', collectorNumber: '263', labels: ['keep'], cardId: 1 },
      ],
    })

    const set = await runCli(['metadata', 'set', 'binder', 'labels', 'trade,sale'], dir)
    expect(set.exitCode).toBe(0)
    expect(set.stdout).toContain(`Set labels = ["sale","trade"] on collection 'binder'`)

    const content = await fs.readFile(filePath, 'utf-8')
    expect(content).toContain('labels:')
    expect(content).toContain('- Sol Ring (C21:263) [keep] &1')
    // Metadata is not a card change: no changelog appears.
    expect(await Bun.file(path.join(dir, 'collections', 'binder.changes.md')).exists()).toBeFalse()

    const get = await runCli(['metadata', 'get', 'binder', 'labels', '--output', 'json'], dir)
    expect(get.exitCode).toBe(0)
    expect(JSON.parse(get.stdout)).toEqual(['sale', 'trade'])

    const unset = await runCli(['metadata', 'unset', 'binder', 'labels'], dir)
    expect(unset.exitCode).toBe(0)
    expect((await fs.readFile(filePath, 'utf-8')).startsWith('# ')).toBeTrue()
  })

  test('set/get/unset round-trip a deck labels default, card lines untouched', async () => {
    const filePath = await writeDeckFile(dir, 'burn', {
      frontMatter: { name: 'Burn' },
      cards: [
        { quantity: 4, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 1 },
      ],
    })

    const set = await runCli(['metadata', 'set', 'burn', 'labels', 'proxy'], dir)
    expect(set.exitCode).toBe(0)
    expect(set.stdout).toContain(`Set labels = ["proxy"] on deck 'burn'`)

    const content = await fs.readFile(filePath, 'utf-8')
    expect(content).toContain('labels:')
    expect(content).toContain('4 Lightning Bolt (LEA:161) &1')

    const get = await runCli(['metadata', 'get', 'burn', 'labels', '--output', 'json'], dir)
    expect(JSON.parse(get.stdout)).toEqual(['proxy'])

    const unset = await runCli(['metadata', 'unset', 'burn', 'labels'], dir)
    expect(unset.exitCode).toBe(0)
    expect(await fs.readFile(filePath, 'utf-8')).not.toContain('labels:')
  })

  test('a label a deck cannot carry is a usage error naming the deck vocabulary', async () => {
    await writeDeckFile(dir, 'burn', { frontMatter: { name: 'Burn' }, cards: [] })
    const result = await runCli(['metadata', 'set', 'burn', 'labels', 'sale'], dir)
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain("Invalid label 'sale'")
    expect(result.stderr).toContain('proxy')
  })

  test('a keep conflict is a usage error and writes nothing', async () => {
    const filePath = await writeCollectionFile(dir, 'binder', {
      entries: [{ name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 1 }],
    })
    const before = await fs.readFile(filePath, 'utf-8')
    const result = await runCli(['metadata', 'set', 'binder', 'labels', 'keep,sale'], dir)
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain("'keep' cannot be combined")
    expect(await fs.readFile(filePath, 'utf-8')).toBe(before)
  })

  test('a replace repairs an invalid stored labels value; --remove reads it and refuses', async () => {
    const filePath = path.join(dir, 'collections', 'binder.md')
    // `labels: sale` (a scalar) is only an advisory at parse time; every reader
    // loads the file, so the one command that can repair it must not choke.
    await fs.writeFile(filePath, '---\nlabels: sale\n---\n\n# Binder\n')

    const remove = await runCli(['metadata', 'set', 'binder', 'labels', 'sale', '--remove'], dir)
    expect(remove.exitCode).toBe(1)
    expect(remove.stderr).toContain("stored 'labels' value is invalid")

    const repair = await runCli(['metadata', 'set', 'binder', 'labels', 'trade'], dir)
    expect(repair.exitCode).toBe(0)
    const get = await runCli(['metadata', 'get', 'binder', 'labels', '--output', 'json'], dir)
    expect(JSON.parse(get.stdout)).toEqual(['trade'])
  })

  test('deck tags support add/remove merging, and removing the last tag clears the key', async () => {
    await writeDeckFile(dir, 'burn', {
      frontMatter: { name: 'Burn', format: 'modern', tags: ['aggro'] },
      cards: [
        { quantity: 4, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 1 },
      ],
    })

    const add = await runCli(
      ['metadata', 'set', 'burn', 'tags', 'budget', '--add', '--output', 'json'],
      dir,
    )
    expect(add.exitCode).toBe(0)
    expect(JSON.parse(add.stdout)).toEqual({
      type: 'deck',
      list: 'burn',
      property: 'tags',
      value: ['aggro', 'budget'],
    })

    const removeOne = await runCli(['metadata', 'set', 'burn', 'tags', 'aggro', '--remove'], dir)
    expect(removeOne.exitCode).toBe(0)

    // Removing the last tag clears the key ("Cleared" wording, value null) and
    // `get` then reports not_found — the same contract labels follow.
    const removeLast = await runCli(['metadata', 'set', 'burn', 'tags', 'budget', '--remove'], dir)
    expect(removeLast.exitCode).toBe(0)
    expect(removeLast.stdout).toContain("Cleared tags on deck 'burn'")
    const get = await runCli(['metadata', 'get', 'burn', 'tags'], dir)
    expect(get.exitCode).toBe(3)
  })

  test('deck description joins its values and format validates against the vocabulary', async () => {
    await writeDeckFile(dir, 'burn', {
      frontMatter: { name: 'Burn', format: 'modern' },
      cards: [
        { quantity: 1, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 1 },
      ],
    })

    const description = await runCli(
      ['metadata', 'set', 'burn', 'description', 'A', 'budget', 'burn', 'list'],
      dir,
    )
    expect(description.exitCode).toBe(0)
    const get = await runCli(['metadata', 'get', 'burn', 'description'], dir)
    expect(get.stdout.trim()).toBe('A budget burn list')

    const badFormat = await runCli(['metadata', 'set', 'burn', 'format', 'bogus'], dir)
    expect(badFormat.exitCode).toBe(2)
    expect(badFormat.stderr).toContain("Invalid deck format 'bogus'")
  })

  test('unset works on the deck branch too, and unknown/rejected properties are usage errors', async () => {
    await writeDeckFile(dir, 'burn', {
      frontMatter: { name: 'Burn', description: 'temp' },
      cards: [],
    })

    const unset = await runCli(['metadata', 'unset', 'burn', 'description'], dir)
    expect(unset.exitCode).toBe(0)
    expect((await runCli(['metadata', 'get', 'burn', 'description'], dir)).exitCode).toBe(3)

    const unknown = await runCli(['metadata', 'set', 'burn', 'bogus', 'x'], dir)
    expect(unknown.exitCode).toBe(2)
    expect(unknown.stderr).toContain("Unknown metadata field 'bogus'")

    // The HTTP route's concurrency token is not a CLI property, and the
    // display name has its own command — both refuse instead of no-op writes.
    const token = await runCli(['metadata', 'set', 'burn', 'contentHash', 'abc'], dir)
    expect(token.exitCode).toBe(2)
    const name = await runCli(['metadata', 'set', 'burn', 'name', 'New Name'], dir)
    expect(name.exitCode).toBe(2)
    expect(name.stderr).toContain('ritual rename')
  })

  test('list prints every settable key in text and the full mapping in JSON', async () => {
    const filePath = await writeDeckFile(dir, 'burn', {
      frontMatter: { name: 'Burn', format: 'modern', tags: ['aggro'] },
      cards: [],
    })
    // A hand-authored unknown key must survive and appear in the JSON payload.
    const content = await fs.readFile(filePath, 'utf-8')
    await fs.writeFile(filePath, content.replace('---\n', '---\nowner: me\n'))

    const text = await runCli(['metadata', 'list', 'burn'], dir)
    expect(text.exitCode).toBe(0)
    expect(text.stdout).toContain('format = modern')
    expect(text.stdout).toContain('description = (unset)')

    const json = await runCli(['metadata', 'list', 'burn', '--output', 'json'], dir)
    const payload = JSON.parse(json.stdout) as {
      type: string
      list: string
      frontMatter: Record<string, unknown>
    }
    expect(payload.type).toBe('deck')
    expect(payload.frontMatter).toMatchObject({ format: 'modern', owner: 'me' })
  })

  test('get on an unset property is not_found (exit 3)', async () => {
    await writeCollectionFile(dir, 'binder', {
      entries: [{ name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 1 }],
    })
    const result = await runCli(['metadata', 'get', 'binder', 'labels', '--output', 'json'], dir)
    expect(result.exitCode).toBe(3)
    const body = JSON.parse(result.stderr) as { error: { code: string } }
    expect(body.error.code).toBe('not_found')
  })

  test('unreadable front matter is a runtime error (exit 1) on both list types', async () => {
    await fs.writeFile(
      path.join(dir, 'collections', 'binder.md'),
      '---\nlabels: [sale\n---\n\n# Binder\n',
    )
    await fs.writeFile(path.join(dir, 'decks', 'burn.md'), '---\ntags: [x\n---\n\n# Burn\n')

    for (const args of [
      ['metadata', 'set', 'binder', 'labels', 'sale'],
      ['metadata', 'list', 'burn', '--output', 'json'],
    ]) {
      const result = await runCli(args, dir)
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('could not be read as YAML')
    }
  })

  test('set/get/unset round-trip a wanted list description, card lines untouched', async () => {
    const filePath = await writeWantedFile(dir, 'wants', {
      entries: [{ name: 'Mana Crypt', cardId: 1 }],
    })

    // Multiple values join with spaces, exactly as a deck's description does.
    const set = await runCli(
      ['metadata', 'set', 'wants', 'description', 'Cards', 'I', 'still', 'need'],
      dir,
    )
    expect(set.exitCode).toBe(0)
    expect(set.stdout).toContain(`on wanted list 'wants'`)

    const content = await fs.readFile(filePath, 'utf-8')
    expect(content).toContain('description: Cards I still need')
    expect(content).toContain('- Mana Crypt &1')

    const get = await runCli(['metadata', 'get', 'wants', 'description', '--output', 'json'], dir)
    expect(JSON.parse(get.stdout)).toBe('Cards I still need')

    // `list` prints the wanted vocabulary, which is these two keys and nothing else.
    const listed = await runCli(['metadata', 'list', 'wants'], dir)
    expect(listed.exitCode).toBe(0)
    expect(listed.stdout).toContain('description = Cards I still need')
    expect(listed.stdout).toContain('image = (unset)')
    expect(listed.stdout).not.toContain('labels')

    const unset = await runCli(['metadata', 'unset', 'wants', 'description'], dir)
    expect(unset.exitCode).toBe(0)
    expect((await fs.readFile(filePath, 'utf-8')).startsWith('# ')).toBeTrue()
  })

  test('a label key on a wanted list is an unknown field (exit 2)', async () => {
    await writeWantedFile(dir, 'wants', { entries: [{ name: 'Mana Crypt', cardId: 1 }] })
    const result = await runCli(['metadata', 'set', 'wants', 'labels', 'keep'], dir)
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('Accepted fields for a wanted list: description')
  })

  test('a collection description writes beside its labels', async () => {
    const filePath = await writeCollectionFile(dir, 'binder', {
      entries: [{ name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 1 }],
    })
    await runCli(['metadata', 'set', 'binder', 'labels', 'sale'], dir)
    const set = await runCli(['metadata', 'set', 'binder', 'description', 'My trade binder'], dir)
    expect(set.exitCode).toBe(0)

    expect(set.stdout).toContain(`on collection 'binder'`)
    const content = await fs.readFile(filePath, 'utf-8')
    expect(content).toContain('description: My trade binder')
    expect(content).toContain('labels:')
    expect(content).toContain('- Sol Ring (C21:263) &1')
  })

  test('an unusable stored description is reported, not answered as unset', async () => {
    await fs.writeFile(
      path.join(dir, 'wanted', 'wants.md'),
      '---\ndescription:\n  text: nope\n---\n\n# Wants\n\n- Mana Crypt &1\n',
    )
    const result = await runCli(['metadata', 'get', 'wants', 'description'], dir)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("The stored 'description' value is invalid")
  })

  test('a metadata write never stamps ids onto id-less card lines', async () => {
    const filePath = path.join(dir, 'collections', 'binder.md')
    await fs.writeFile(filePath, '# Binder\n\n## Main\n- Sol Ring (C21:263)\n')

    const result = await runCli(['metadata', 'set', 'binder', 'labels', 'sale'], dir)
    expect(result.exitCode).toBe(0)
    // The command is front-matter-only, so it is not in the backfill
    // allowlist: the id-less line must survive exactly as written.
    expect(await fs.readFile(filePath, 'utf-8')).toContain('- Sol Ring (C21:263)\n')
    expect(await fs.readFile(filePath, 'utf-8')).not.toContain('&1')
  })
})
