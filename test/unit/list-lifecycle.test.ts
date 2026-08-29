import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  createList,
  deleteList,
  isListLifecycleError,
  listDisplayName,
  renameList,
  type CreateListSuccess,
  type DeleteListSuccess,
  type ListLifecycleError,
  type RenameListSuccess,
} from '../../src/list/list-lifecycle'
import { parseDeckFrontMatter } from '../../src/list/deck-file'
import { computeHash } from '../../src/changes/content-hash'
import { bindWorkspace, type BoundWorkspace } from '../helpers/workspace'

let ws: BoundWorkspace
let decksDir: string
let collectionsDir: string

function unwrap<S>(result: S | ListLifecycleError): S {
  if (isListLifecycleError(result)) {
    throw new Error(`Expected success, got ${result.kind}: ${result.message}`)
  }
  return result
}

function unwrapError<S>(result: S | ListLifecycleError): ListLifecycleError {
  if (!isListLifecycleError(result)) {
    throw new Error('Expected a lifecycle error, got success')
  }
  return result
}

const exists = (filePath: string): Promise<boolean> => Bun.file(filePath).exists()

describe('list-lifecycle engine', () => {
  beforeEach(async () => {
    ws = await bindWorkspace({ dirs: ['decks', 'collections'], config: false })
    decksDir = path.join(ws.dir, 'decks')
    collectionsDir = path.join(ws.dir, 'collections')
  })

  afterEach(async () => {
    await ws.dispose()
  })

  describe('createList', () => {
    test('creates a deck file with front matter, Main section, and hash sidecar', async () => {
      const result = unwrap<CreateListSuccess>(await createList('deck', 'My Deck', 'modern'))

      expect(result.slug).toBe('My Deck')
      expect(result.filePath).toBe(path.join(decksDir, 'My Deck.md'))
      expect(result.touchedFiles).toEqual([result.filePath, `${result.filePath}.sha256`])

      const frontMatter = await parseDeckFrontMatter(result.filePath)
      expect(frontMatter.format).toBe('modern')
      expect(await listDisplayName('deck', result.filePath)).toBe('My Deck')
      expect(await fs.readFile(result.filePath, 'utf-8')).toContain('# My Deck\n\n## Main')
      expect(await exists(`${result.filePath}.sha256`)).toBe(true)
    })

    test('creates a flat list as a bare H1 heading', async () => {
      const result = unwrap<CreateListSuccess>(await createList('collection', 'Binder'))

      expect(await fs.readFile(result.filePath, 'utf-8')).toBe('# Binder\n\n')
      expect(await exists(`${result.filePath}.sha256`)).toBe(true)
    })

    test('rejects an unknown deck format without writing a file', async () => {
      const error = unwrapError(await createList('deck', 'Cube', 'cube'))
      expect(error.kind).toBe('invalid-format')
      expect(error.message).toContain("Invalid deck format 'cube'")
      expect(await exists(path.join(decksDir, 'Cube.md'))).toBe(false)
    })

    test('rejects a name with no usable filename characters', async () => {
      const error = unwrapError(await createList('collection', '???'))
      expect(error.kind).toBe('invalid-name')
      expect(error.message).toContain('no characters usable in a file name')
    })

    test('refuses to overwrite an existing file', async () => {
      unwrap(await createList('deck', 'Existing'))
      const error = unwrapError(await createList('deck', 'Existing'))
      expect(error.kind).toBe('already-exists')
      expect(error.message).toContain("A deck named 'Existing' already exists")
    })

    test('refuses a name that only folds onto an existing list of the same type', async () => {
      // The audit's repro: both decks would be permanently unaddressable by the
      // folded name, so the second creation is refused instead.
      unwrap(await createList('deck', 'Atraxa Superfriends'))
      const error = unwrapError(await createList('deck', 'atraxa superfriends'))
      expect(error.kind).toBe('already-exists')
      expect(error.message).toBe(
        "A deck named 'Atraxa Superfriends' already exists (it matches 'atraxa superfriends' under list-name folding).",
      )
      expect(await exists(path.join(decksDir, 'atraxa superfriends.md'))).toBe(false)
    })

    test.each([
      ['punctuation', 'Mono-Red Burn', 'Mono Red Burn'],
      ['accents', 'Cafe Standard', 'Café Standard'],
      ['a stripped colon', 'Atraxa Praetors Voice', "Atraxa: Praetors' Voice"],
      ['an apostrophe', "Praetors' Voice", 'Praetors Voice'],
    ])('refuses a second deck differing only by %s', async (_label, first, second) => {
      unwrap(await createList('deck', first))
      expect(unwrapError(await createList('deck', second)).kind).toBe('already-exists')
    })

    test('a folded name in another list type is not a collision', async () => {
      unwrap(await createList('deck', 'Staples'))
      const collection = unwrap<CreateListSuccess>(await createList('collection', 'staples'))
      expect(await exists(collection.filePath)).toBe(true)
    })
  })

  describe('renameList', () => {
    test('moves the file with its changelog, primer and art sidecars and drops the old .sha256', async () => {
      const oldPath = path.join(decksDir, 'Old Deck.md')
      const oldContent = '---\nformat: commander\n---\n\n# Old Deck\n\n## Main\n'
      await fs.writeFile(oldPath, oldContent)
      // A current sidecar: the file is Ritual-clean, so the rename writes a
      // fresh hash for the new content.
      await fs.writeFile(`${oldPath}.sha256`, computeHash(oldContent) + '\n')
      await fs.writeFile(path.join(decksDir, 'Old Deck.changes.md'), '# Changelog\n')
      await fs.writeFile(path.join(decksDir, 'Old Deck.primer.md'), '# Primer\n')
      await fs.writeFile(
        path.join(decksDir, 'Old Deck.art.json'),
        '{\n  "1": { "url": "https://example.test/a.png" }\n}\n',
      )

      const result = unwrap<RenameListSuccess>(await renameList('deck', oldPath, 'New Deck'))

      expect(result.newSlug).toBe('New Deck')
      expect(result.oldName).toBe('Old Deck')
      const newPath = path.join(decksDir, 'New Deck.md')
      expect(result.newFilePath).toBe(newPath)

      // Old file and every sidecar are gone from the old name.
      expect(await exists(oldPath)).toBe(false)
      expect(await exists(`${oldPath}.sha256`)).toBe(false)
      expect(await exists(path.join(decksDir, 'Old Deck.changes.md'))).toBe(false)
      expect(await exists(path.join(decksDir, 'Old Deck.primer.md'))).toBe(false)
      expect(await exists(path.join(decksDir, 'Old Deck.art.json'))).toBe(false)

      // New file, fresh hash, moved sidecars.
      expect(await exists(newPath)).toBe(true)
      expect(await exists(`${newPath}.sha256`)).toBe(true)
      expect(await exists(path.join(decksDir, 'New Deck.changes.md'))).toBe(true)
      expect(await exists(path.join(decksDir, 'New Deck.primer.md'))).toBe(true)
      expect(await exists(path.join(decksDir, 'New Deck.art.json'))).toBe(true)

      // Display name rewritten in the H1; the front matter is untouched.
      const content = await fs.readFile(newPath, 'utf-8')
      expect(content).toBe('---\nformat: commander\n---\n\n# New Deck\n\n## Main\n')
    })

    test('a hand-edited file (stale sidecar) is renamed without stamping a new .sha256', async () => {
      const oldPath = path.join(decksDir, 'Edited Deck.md')
      await fs.writeFile(
        oldPath,
        '---\nname: "Edited Deck"\nformat: commander\n---\n\n## Main\n\n1 Sol Ring &1\n',
      )
      // A stale sidecar: the file holds hand edits Ritual has not recorded.
      // Writing a fresh hash here would make detect-changes skip them.
      await fs.writeFile(`${oldPath}.sha256`, computeHash('some earlier content') + '\n')

      const result = unwrap<RenameListSuccess>(await renameList('deck', oldPath, 'Renamed Deck'))

      expect(await exists(result.newFilePath)).toBe(true)
      expect(await exists(`${result.newFilePath}.sha256`)).toBe(false)
      expect(await exists(`${oldPath}.sha256`)).toBe(false)
    })

    test('a deck with no H1 gains one after its front matter, and keeps the front matter', async () => {
      const oldPath = path.join(decksDir, 'Plain.md')
      await fs.writeFile(oldPath, '---\nformat: commander\n---\n\n## Main\n')

      const result = unwrap<RenameListSuccess>(await renameList('deck', oldPath, 'The "Best" Deck'))

      expect(result.oldName).toBe('Plain')
      const content = await fs.readFile(result.newFilePath, 'utf-8')
      expect(content).toBe('---\nformat: commander\n---\n\n# The "Best" Deck\n\n## Main\n')
      expect(await listDisplayName('deck', result.newFilePath)).toBe('The "Best" Deck')
    })

    test('a new name containing replacement patterns is written literally', async () => {
      const oldPath = path.join(decksDir, 'Old.md')
      await fs.writeFile(oldPath, '---\nformat: commander\n---\n\n# Old\n\n## Main\n')

      const result = unwrap<RenameListSuccess>(await renameList('deck', oldPath, 'Cost $& Value'))

      const content = await fs.readFile(result.newFilePath, 'utf-8')
      expect(content).toContain('# Cost $& Value')
      expect(await listDisplayName('deck', result.newFilePath)).toBe('Cost $& Value')
    })

    test('rewrites the first H1 of a flat list and preserves the body', async () => {
      const oldPath = path.join(collectionsDir, 'Old Binder.md')
      await fs.writeFile(oldPath, '# Old Binder\n\n- Sol Ring (C19:221) &1\n')

      const result = unwrap<RenameListSuccess>(
        await renameList('collection', oldPath, 'New Binder'),
      )

      const content = await fs.readFile(result.newFilePath, 'utf-8')
      expect(content.startsWith('# New Binder\n')).toBe(true)
      expect(content).toContain('- Sol Ring (C19:221) &1')
    })

    test('updates the display name in place when the slug does not change', async () => {
      const filePath = path.join(collectionsDir, 'Binder.md')
      await fs.writeFile(filePath, '# My Binder Title\n\n- Sol Ring (C19:221) &1\n')

      const result = unwrap<RenameListSuccess>(await renameList('collection', filePath, 'Binder'))

      expect(result.newFilePath).toBe(filePath)
      expect(result.oldName).toBe('My Binder Title')
      const content = await fs.readFile(filePath, 'utf-8')
      expect(content.startsWith('# Binder\n')).toBe(true)
    })

    test('refuses a rename onto an existing slug', async () => {
      await fs.writeFile(path.join(collectionsDir, 'A.md'), '# A\n\n')
      await fs.writeFile(path.join(collectionsDir, 'B.md'), '# B\n\n')

      const error = unwrapError(
        await renameList('collection', path.join(collectionsDir, 'A.md'), 'B'),
      )
      expect(error.kind).toBe('already-exists')
    })

    test('refuses a rename onto a name that folds onto another list', async () => {
      await fs.writeFile(path.join(collectionsDir, 'Trade Binder.md'), '# Trade Binder\n\n')
      await fs.writeFile(path.join(collectionsDir, 'Spares.md'), '# Spares\n\n')

      const error = unwrapError(
        await renameList('collection', path.join(collectionsDir, 'Spares.md'), 'trade-binder'),
      )
      expect(error.kind).toBe('already-exists')
      expect(error.message).toContain("A collection named 'Trade Binder' already exists")
      expect(await exists(path.join(collectionsDir, 'Spares.md'))).toBe(true)
    })

    test('a folded name held by another list type is not a collision', async () => {
      await fs.writeFile(path.join(decksDir, 'Staples.md'), '---\nname: Staples\n---\n\n## Main\n')
      const filePath = path.join(collectionsDir, 'Binder.md')
      await fs.writeFile(filePath, '# Binder\n\n')

      const result = unwrap<RenameListSuccess>(await renameList('collection', filePath, 'staples'))
      expect(result.newFilePath).toBe(path.join(collectionsDir, 'staples.md'))
    })

    test('a case-only rename is not a collision with the list itself', async () => {
      // On a case-insensitive file system the destination path *is* the source
      // file. The seam makes that reachable here; the two-step move is what
      // actually changes the spelling on disk.
      const filePath = path.join(collectionsDir, 'binder.md')
      await fs.writeFile(filePath, '# binder\n\n- Sol Ring (C19:221) &1\n')
      await fs.writeFile(path.join(collectionsDir, 'binder.changes.md'), '# Changelog\n')
      const originalInode = (await fs.stat(filePath)).ino

      const result = unwrap<RenameListSuccess>(
        await renameList('collection', filePath, 'Binder', { isSameFile: async () => true }),
      )

      expect(result.newSlug).toBe('Binder')
      expect(result.oldFilePath).toBe(filePath)
      const newPath = path.join(collectionsDir, 'Binder.md')
      expect(result.newFilePath).toBe(newPath)
      expect(await fs.readFile(newPath, 'utf-8')).toBe('# Binder\n\n- Sol Ring (C19:221) &1\n')
      // Every sidecar followed, and no temp file was left behind.
      expect(await exists(path.join(collectionsDir, 'Binder.changes.md'))).toBe(true)
      expect(await exists(path.join(collectionsDir, 'binder.changes.md'))).toBe(false)
      expect(
        (await fs.readdir(collectionsDir)).filter((f) => f.startsWith('.ritual-rename')),
      ).toEqual([])
      // The discriminator between the two rename branches: the two-step move
      // renames the *same* inode, where the ordinary path writes a new file and
      // unlinks the old one.
      expect((await fs.stat(newPath)).ino).toBe(originalInode)
    })

    test('a same-file destination moves the .sha256, primer and art sidecars too', async () => {
      const filePath = path.join(decksDir, 'burn.md')
      const content = '---\nname: burn\nformat: modern\n---\n\n# burn\n\n## Main\n'
      await fs.writeFile(filePath, content)
      await fs.writeFile(`${filePath}.sha256`, computeHash(content) + '\n')
      await fs.writeFile(path.join(decksDir, 'burn.primer.md'), '# Primer\n')
      await fs.writeFile(
        path.join(decksDir, 'burn.art.json'),
        '{\n  "1": { "file": "burn.jpg" }\n}\n',
      )
      const originalInode = (await fs.stat(filePath)).ino

      const result = unwrap<RenameListSuccess>(
        await renameList('deck', filePath, 'Burn', { isSameFile: async () => true }),
      )

      const newPath = path.join(decksDir, 'Burn.md')
      expect(result.newFilePath).toBe(newPath)
      expect(await exists(`${newPath}.sha256`)).toBe(true)
      expect(await exists(path.join(decksDir, 'Burn.primer.md'))).toBe(true)
      expect(await exists(path.join(decksDir, 'burn.primer.md'))).toBe(false)
      expect(await exists(path.join(decksDir, 'Burn.art.json'))).toBe(true)
      expect(await exists(path.join(decksDir, 'burn.art.json'))).toBe(false)
      // The hash was refreshed for the rewritten display name, so the file stays
      // Ritual-clean.
      const renamed = await fs.readFile(newPath, 'utf-8')
      expect(await fs.readFile(`${newPath}.sha256`, 'utf-8')).toBe(computeHash(renamed) + '\n')
      expect(result.touchedFiles).toContain(newPath)
      expect(result.touchedFiles).toContain(filePath)
      // The two-step move renames the file in place rather than writing a new one.
      expect((await fs.stat(newPath)).ino).toBe(originalInode)
    })

    test('a same-file destination drops a stale .sha256 rather than carrying it', async () => {
      // The one outcome that differs between the two rename branches: a
      // hand-edited file must not keep a sidecar that would make detect-changes
      // call it clean and drop its edits' changelog entries.
      const filePath = path.join(decksDir, 'burn.md')
      const content = '---\nname: burn\nformat: modern\n---\n\n# burn\n\n## Main\n'
      await fs.writeFile(filePath, content)
      await fs.writeFile(`${filePath}.sha256`, computeHash('some earlier content') + '\n')
      const originalInode = (await fs.stat(filePath)).ino

      const result = unwrap<RenameListSuccess>(
        await renameList('deck', filePath, 'Burn', { isSameFile: async () => true }),
      )

      const newPath = path.join(decksDir, 'Burn.md')
      expect(result.newFilePath).toBe(newPath)
      expect(await exists(`${newPath}.sha256`)).toBe(false)
      expect(await exists(`${filePath}.sha256`)).toBe(false)
      expect((await fs.stat(newPath)).ino).toBe(originalInode)
    })

    test('reports a missing source file as not-found', async () => {
      const error = unwrapError(
        await renameList('collection', path.join(collectionsDir, 'Missing.md'), 'Whatever'),
      )
      expect(error.kind).toBe('not-found')
    })
  })

  describe('deleteList', () => {
    test('removes the file and every sidecar, including the .sha256 hash', async () => {
      // Pins the fix for the old admin deck-delete handler, which hand-rolled the
      // sidecar paths and orphaned the .sha256 sidecar on deck deletion.
      const filePath = path.join(decksDir, 'Doomed.md')
      await fs.writeFile(filePath, '---\nname: "Doomed"\n---\n\n## Main\n')
      await fs.writeFile(`${filePath}.sha256`, 'hash\n')
      await fs.writeFile(path.join(decksDir, 'Doomed.changes.md'), '# Changelog\n')
      await fs.writeFile(path.join(decksDir, 'Doomed.primer.md'), '# Primer\n')
      await fs.writeFile(
        path.join(decksDir, 'Doomed.art.json'),
        '{\n  "1": { "file": "d.jpg" }\n}\n',
      )

      const result = unwrap<DeleteListSuccess>(await deleteList('deck', filePath))

      expect(result.deletedFiles).toEqual([
        filePath,
        `${filePath}.sha256`,
        path.join(decksDir, 'Doomed.changes.md'),
        path.join(decksDir, 'Doomed.primer.md'),
        path.join(decksDir, 'Doomed.art.json'),
      ])
      expect(await exists(filePath)).toBe(false)
      expect(await exists(`${filePath}.sha256`)).toBe(false)
      expect(await exists(path.join(decksDir, 'Doomed.changes.md'))).toBe(false)
      expect(await exists(path.join(decksDir, 'Doomed.primer.md'))).toBe(false)
      expect(await exists(path.join(decksDir, 'Doomed.art.json'))).toBe(false)
    })

    test('only touches the files that exist', async () => {
      const filePath = path.join(collectionsDir, 'Bare.md')
      await fs.writeFile(filePath, '# Bare\n\n')

      const result = unwrap<DeleteListSuccess>(await deleteList('collection', filePath))
      expect(result.deletedFiles).toEqual([filePath])
    })

    test('reports a missing file as not-found', async () => {
      const error = unwrapError(await deleteList('deck', path.join(decksDir, 'Missing.md')))
      expect(error.kind).toBe('not-found')
    })
  })

  describe('listDisplayName', () => {
    test("reads a deck's and a flat list's H1", async () => {
      const deckPath = path.join(decksDir, 'slugged.md')
      await fs.writeFile(deckPath, '---\nformat: modern\n---\n\n# Pretty Deck Name\n\n## Main\n')
      expect(await listDisplayName('deck', deckPath)).toBe('Pretty Deck Name')

      const flatPath = path.join(collectionsDir, 'slugged.md')
      await fs.writeFile(flatPath, '# Pretty Binder Name\n\n')
      expect(await listDisplayName('collection', flatPath)).toBe('Pretty Binder Name')
    })

    test('falls back to the file slug when no display name is present', async () => {
      const deckPath = path.join(decksDir, 'Legacy Deck.md')
      await fs.writeFile(deckPath, '---\nname: Ignored Legacy Name\n---\n\n## Main\n')
      expect(await listDisplayName('deck', deckPath)).toBe('Legacy Deck')

      const flatPath = path.join(collectionsDir, 'No Title.md')
      await fs.writeFile(flatPath, '- Sol Ring (C19:221) &1\n')
      expect(await listDisplayName('collection', flatPath)).toBe('No Title')
    })
  })
})
