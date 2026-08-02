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
} from '../../src/list-lifecycle'
import { parseDeckFrontMatter } from '../../src/deck-file'
import { computeHash } from '../../src/content-hash'
import { setBaseDir } from '../../src/base-dir'

const testDir = path.join(import.meta.dir, '../.test-list-lifecycle')
const decksDir = path.join(testDir, 'decks')
const collectionsDir = path.join(testDir, 'collections')

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
  const originalCwd = process.cwd()

  beforeEach(async () => {
    await fs.mkdir(decksDir, { recursive: true })
    await fs.mkdir(collectionsDir, { recursive: true })
    setBaseDir(testDir)
  })

  afterEach(async () => {
    setBaseDir(originalCwd)
    await fs.rm(testDir, { recursive: true, force: true })
  })

  describe('createList', () => {
    test('creates a deck file with front matter, Main section, and hash sidecar', async () => {
      const result = unwrap<CreateListSuccess>(await createList('deck', 'My Deck', 'modern'))

      expect(result.slug).toBe('My Deck')
      expect(result.filePath).toBe(path.join(decksDir, 'My Deck.md'))
      expect(result.touchedFiles).toEqual([result.filePath, `${result.filePath}.sha256`])

      const frontMatter = await parseDeckFrontMatter(result.filePath)
      expect(frontMatter.name).toBe('My Deck')
      expect(frontMatter.format).toBe('modern')
      expect(await fs.readFile(result.filePath, 'utf-8')).toContain('## Main')
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
      expect(error.message).toContain("A deck with slug 'Existing' already exists")
    })
  })

  describe('renameList', () => {
    test('moves the file with its changelog and primer sidecars and drops the old .sha256', async () => {
      const oldPath = path.join(decksDir, 'Old Deck.md')
      const oldContent = '---\nname: "Old Deck"\nformat: commander\n---\n\n# Old Deck\n\n## Main\n'
      await fs.writeFile(oldPath, oldContent)
      // A current sidecar: the file is Ritual-clean, so the rename writes a
      // fresh hash for the new content.
      await fs.writeFile(`${oldPath}.sha256`, computeHash(oldContent) + '\n')
      await fs.writeFile(path.join(decksDir, 'Old Deck.changes.md'), '# Changelog\n')
      await fs.writeFile(path.join(decksDir, 'Old Deck.primer.md'), '# Primer\n')

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

      // New file, fresh hash, moved sidecars.
      expect(await exists(newPath)).toBe(true)
      expect(await exists(`${newPath}.sha256`)).toBe(true)
      expect(await exists(path.join(decksDir, 'New Deck.changes.md'))).toBe(true)
      expect(await exists(path.join(decksDir, 'New Deck.primer.md'))).toBe(true)

      // Display name rewritten in front matter (canonical gray-matter form,
      // matching every deck save) and legacy H1.
      const content = await fs.readFile(newPath, 'utf-8')
      expect(content).toContain('name: New Deck')
      expect(content).toContain('# New Deck')
      expect(content).not.toContain('Old Deck')
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

    test('a new name containing quotes yields valid YAML front matter', async () => {
      const oldPath = path.join(decksDir, 'Plain.md')
      await fs.writeFile(oldPath, '---\nname: Plain\nformat: commander\n---\n\n## Main\n')

      const result = unwrap<RenameListSuccess>(await renameList('deck', oldPath, 'The "Best" Deck'))

      const content = await fs.readFile(result.newFilePath, 'utf-8')
      const reparsed = await parseDeckFrontMatter(result.newFilePath)
      expect(reparsed.name).toBe('The "Best" Deck')
      expect(content).toContain('format: commander')
    })

    test('a new name containing replacement patterns is written literally', async () => {
      const oldPath = path.join(decksDir, 'Old.md')
      await fs.writeFile(oldPath, '---\nname: Old\nformat: commander\n---\n\n# Old\n\n## Main\n')

      const result = unwrap<RenameListSuccess>(await renameList('deck', oldPath, 'Cost $& Value'))

      const content = await fs.readFile(result.newFilePath, 'utf-8')
      expect(content).toContain('# Cost $& Value')
      const reparsed = await parseDeckFrontMatter(result.newFilePath)
      expect(reparsed.name).toBe('Cost $& Value')
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

    test('reports a missing source file as not-found', async () => {
      const error = unwrapError(
        await renameList('collection', path.join(collectionsDir, 'Missing.md'), 'Whatever'),
      )
      expect(error.kind).toBe('not-found')
    })
  })

  describe('deleteList', () => {
    test('removes the file and all three sidecars, including the .sha256 hash', async () => {
      // Pins the fix for the old admin deck-delete handler, which hand-rolled the
      // sidecar paths and orphaned the .sha256 sidecar on deck deletion.
      const filePath = path.join(decksDir, 'Doomed.md')
      await fs.writeFile(filePath, '---\nname: "Doomed"\n---\n\n## Main\n')
      await fs.writeFile(`${filePath}.sha256`, 'hash\n')
      await fs.writeFile(path.join(decksDir, 'Doomed.changes.md'), '# Changelog\n')
      await fs.writeFile(path.join(decksDir, 'Doomed.primer.md'), '# Primer\n')

      const result = unwrap<DeleteListSuccess>(await deleteList('deck', filePath))

      expect(result.touchedFiles).toEqual([
        filePath,
        `${filePath}.sha256`,
        path.join(decksDir, 'Doomed.changes.md'),
        path.join(decksDir, 'Doomed.primer.md'),
      ])
      expect(await exists(filePath)).toBe(false)
      expect(await exists(`${filePath}.sha256`)).toBe(false)
      expect(await exists(path.join(decksDir, 'Doomed.changes.md'))).toBe(false)
      expect(await exists(path.join(decksDir, 'Doomed.primer.md'))).toBe(false)
    })

    test('only touches the files that exist', async () => {
      const filePath = path.join(collectionsDir, 'Bare.md')
      await fs.writeFile(filePath, '# Bare\n\n')

      const result = unwrap<DeleteListSuccess>(await deleteList('collection', filePath))
      expect(result.touchedFiles).toEqual([filePath])
    })

    test('reports a missing file as not-found', async () => {
      const error = unwrapError(await deleteList('deck', path.join(decksDir, 'Missing.md')))
      expect(error.kind).toBe('not-found')
    })
  })

  describe('listDisplayName', () => {
    test("reads a deck's front-matter name and a flat list's H1", async () => {
      const deckPath = path.join(decksDir, 'slugged.md')
      await fs.writeFile(deckPath, '---\nname: "Pretty Deck Name"\n---\n\n## Main\n')
      expect(await listDisplayName('deck', deckPath)).toBe('Pretty Deck Name')

      const flatPath = path.join(collectionsDir, 'slugged.md')
      await fs.writeFile(flatPath, '# Pretty Binder Name\n\n')
      expect(await listDisplayName('collection', flatPath)).toBe('Pretty Binder Name')
    })

    test('falls back to the file slug when no display name is present', async () => {
      const flatPath = path.join(collectionsDir, 'No Title.md')
      await fs.writeFile(flatPath, '- Sol Ring (C19:221) &1\n')
      expect(await listDisplayName('collection', flatPath)).toBe('No Title')
    })
  })
})
