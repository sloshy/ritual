import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import {
  applyFlatListChange,
  flatListTargetSection,
  loadCollectionSession,
  loadWantedSession,
} from '../../src/commands/flat-list-session'
import { allocateId } from '../../src/card-id'
import {
  createAddChange,
  createSetNoteChange,
  createSetPrintingChange,
} from '../../src/change-event'

describe('flat-list session models', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ritual-test-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  async function writeList(name: string, content: string): Promise<string> {
    const filePath = path.join(tmpDir, name)
    await fs.writeFile(filePath, content)
    return filePath
  }

  describe('collection session', () => {
    test('add appends a canonical line to the last section and reuses pooled IDs', async () => {
      // ID 2 is missing, so the pool should hand it out before going sequential.
      const filePath = await writeList(
        'binder.md',
        '# My Binder\n\n## Trade\n- Sol Ring (C19:221) [foil] [NM] &1\n\n## Keep\n- Lightning Bolt (LEA:161) &3\n',
      )
      const session = await loadCollectionSession(filePath)

      expect(session.title).toBe('My Binder')
      expect(flatListTargetSection(session)).toBe('Keep')

      const cardId = allocateId(session.pool)
      expect(cardId).toBe(2)

      await applyFlatListChange(
        session,
        createAddChange('Mana Crypt', {
          set: '2xm',
          collectorNumber: '270',
          finish: 'foil',
          condition: 'NM',
          cardId,
          section: flatListTargetSection(session),
        }),
      )

      // Like an admin save, re-serialization normalizes condition-less entries to [NM].
      const content = await fs.readFile(filePath, 'utf-8')
      expect(content).toBe(
        '# My Binder\n\n## Trade\n- Sol Ring (C19:221) [foil] [NM] &1\n\n## Keep\n- Lightning Bolt (LEA:161) [NM] &3\n- Mana Crypt (2XM:270) [foil] [NM] &2\n',
      )
    })

    test('set-note and set-printing target entries by card ID, not file position', async () => {
      const filePath = await writeList(
        'binder.md',
        '# Binder\n\n- Sol Ring (C19:221) &1\n- Lightning Bolt (LEA:161) &2\n',
      )
      const session = await loadCollectionSession(filePath)

      // Target the FIRST entry even though another card was added after it.
      await applyFlatListChange(
        session,
        createSetNoteChange('Sol Ring', { note: 'signed', cardId: 1 }),
      )
      await applyFlatListChange(
        session,
        createSetPrintingChange('Sol Ring', {
          set: 'ltc',
          collectorNumber: '284',
          finish: 'foil',
          condition: 'LP',
          cardId: 1,
        }),
      )

      const content = await fs.readFile(filePath, 'utf-8')
      expect(content).toContain('- Sol Ring (LTC:284) [foil] [LP] {signed} &1\n')
      expect(content).toContain('- Lightning Bolt (LEA:161) [NM] &2\n')
    })

    test('a malformed entry is skipped with a warning, not silently mangled', async () => {
      // A bare name line is not part of the collection grammar (no set/CN).
      const filePath = await writeList(
        'binder.md',
        '# Binder\n\n- Nameless Card\n- Sol Ring (C19:221) &1\n',
      )
      const session = await loadCollectionSession(filePath)
      expect(session.entries).toHaveLength(1)
      expect(session.entries[0]!.name).toBe('Sol Ring')
    })

    test('entries without IDs get pool-assigned ones that persist on first save', async () => {
      const filePath = await writeList('binder.md', '# Binder\n\n- Sol Ring (C19:221)\n')
      const session = await loadCollectionSession(filePath)
      expect(session.entries[0]!.cardId).toBe(1)

      await applyFlatListChange(
        session,
        createAddChange('Lightning Bolt', {
          set: 'lea',
          collectorNumber: '161',
          cardId: allocateId(session.pool),
          section: flatListTargetSection(session),
        }),
      )
      const content = await fs.readFile(filePath, 'utf-8')
      expect(content).toContain('- Sol Ring (C19:221) [NM] &1\n')
      expect(content).toContain('- Lightning Bolt (LEA:161) [NM] &2\n')
    })
  })

  describe('wanted session', () => {
    test('a name-only add writes a bare name line', async () => {
      const filePath = await writeList('wishlist.md', '# Wishlist\n\n')
      const session = await loadWantedSession(filePath)
      const cardId = allocateId(session.pool)
      await applyFlatListChange(
        session,
        createAddChange('Black Lotus', { cardId, section: flatListTargetSection(session) }),
      )
      const content = await fs.readFile(filePath, 'utf-8')
      expect(content).toContain('- Black Lotus &1\n')
      expect(content).not.toContain('(')
    })

    test('supports name-only adds and printing edits that clear back to name-only', async () => {
      const filePath = await writeList('wishlist.md', '# Wishlist\n\n- Black Lotus &1\n')
      const session = await loadWantedSession(filePath)
      expect(session.entries[0]!.state).toBe('name-only')

      const cardId = allocateId(session.pool)
      await applyFlatListChange(
        session,
        createAddChange('Mana Crypt', {
          set: '2xm',
          collectorNumber: '270',
          finish: 'foil',
          cardId,
          section: flatListTargetSection(session),
        }),
      )
      let content = await fs.readFile(filePath, 'utf-8')
      expect(content).toContain('- Mana Crypt (2XM:270) [foil] &2\n')

      // Clearing the printing reverts the entry to a name-only line.
      await applyFlatListChange(session, createSetPrintingChange('Mana Crypt', { cardId }))
      content = await fs.readFile(filePath, 'utf-8')
      expect(content).toContain('- Mana Crypt &2\n')
      expect(content).not.toContain('2XM')
    })
  })
})
