import { describe, test, expect } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { appendChangelog } from '../../src/changelog-writer'
import type { ChangeEvent } from '../../src/change-event'

/** Test helper — builds a ChangeEvent with add-change defaults.
 *  Uses assertion since overrides may switch to a different union branch. */
function makeChange(overrides: Record<string, unknown> = {}): ChangeEvent {
  return {
    id: 'test-id',
    timestamp: Date.now(),
    action: 'add',
    cardName: 'Sol Ring',
    ...overrides,
  }
}

describe('appendChangelog', () => {
  test('creates changelog file when it does not exist', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'changelog-test-'))
    const filePath = path.join(tmpDir, 'Test.md')
    await fs.writeFile(filePath, '# Test\n')

    const change = makeChange()
    const changelogPath = await appendChangelog(filePath, 'Test', [change])

    expect(changelogPath).toBe(path.join(tmpDir, 'Test.changes.md'))
    const content = await fs.readFile(changelogPath, 'utf-8')
    expect(content).toContain('# Changelog for Test')
    expect(content).toContain('- Added "Sol Ring"')

    await fs.rm(tmpDir, { recursive: true })
  })

  test('appends to existing changelog', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'changelog-test-'))
    const filePath = path.join(tmpDir, 'Test.md')
    const changelogPath = path.join(tmpDir, 'Test.changes.md')
    await fs.writeFile(filePath, '# Test\n')
    await fs.writeFile(
      changelogPath,
      '# Changelog for Test\n\n## 2026-01-01T00:00:00Z\n\n- Added "Lightning Bolt"\n',
    )

    const change = makeChange({ cardName: 'Counterspell' })
    await appendChangelog(filePath, 'Test', [change])

    const content = await fs.readFile(changelogPath, 'utf-8')
    expect(content).toContain('- Added "Lightning Bolt"')
    expect(content).toContain('- Added "Counterspell"')

    await fs.rm(tmpDir, { recursive: true })
  })

  test('formats add with printing info', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'changelog-test-'))
    const filePath = path.join(tmpDir, 'Test.md')
    await fs.writeFile(filePath, '# Test\n')

    const change = makeChange({
      cardName: 'Demonic Tutor',
      set: 'UMA',
      collectorNumber: '93',
      finish: 'foil',
    })
    await appendChangelog(filePath, 'Test', [change])

    const content = await fs.readFile(path.join(tmpDir, 'Test.changes.md'), 'utf-8')
    expect(content).toContain('- Added "Demonic Tutor" (UMA:93) [foil]')

    await fs.rm(tmpDir, { recursive: true })
  })

  test('annotates a non-main board on add', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'changelog-test-'))
    const filePath = path.join(tmpDir, 'Test.md')
    await fs.writeFile(filePath, '# Test\n')

    const change = makeChange({ cardName: 'Cavern-Hoard Dragon', board: 'Maybeboard' })
    await appendChangelog(filePath, 'Test', [change])

    const content = await fs.readFile(path.join(tmpDir, 'Test.changes.md'), 'utf-8')
    expect(content).toContain('- Added "Cavern-Hoard Dragon" to Maybeboard')

    await fs.rm(tmpDir, { recursive: true })
  })

  test('annotates a non-main board on remove with "from"', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'changelog-test-'))
    const filePath = path.join(tmpDir, 'Test.md')
    await fs.writeFile(filePath, '# Test\n')

    const change = makeChange({ action: 'remove', cardName: 'Lightning Bolt', board: 'Sideboard' })
    await appendChangelog(filePath, 'Test', [change])

    const content = await fs.readFile(path.join(tmpDir, 'Test.changes.md'), 'utf-8')
    expect(content).toContain('- Removed "Lightning Bolt" from Sideboard')

    await fs.rm(tmpDir, { recursive: true })
  })

  test('omits the board annotation for the main board', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'changelog-test-'))
    const filePath = path.join(tmpDir, 'Test.md')
    await fs.writeFile(filePath, '# Test\n')

    const change = makeChange({ cardName: 'Sol Ring', board: 'Main' })
    await appendChangelog(filePath, 'Test', [change])

    const content = await fs.readFile(path.join(tmpDir, 'Test.changes.md'), 'utf-8')
    expect(content).toContain('- Added "Sol Ring"\n')
    expect(content).not.toContain('to Main')

    await fs.rm(tmpDir, { recursive: true })
  })

  test('formats remove action', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'changelog-test-'))
    const filePath = path.join(tmpDir, 'Test.md')
    await fs.writeFile(filePath, '# Test\n')

    const change = makeChange({ action: 'remove', cardName: 'Misty Rainforest' })
    await appendChangelog(filePath, 'Test', [change])

    const content = await fs.readFile(path.join(tmpDir, 'Test.changes.md'), 'utf-8')
    expect(content).toContain('- Removed "Misty Rainforest"')

    await fs.rm(tmpDir, { recursive: true })
  })

  test('formats set-commander action', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'changelog-test-'))
    const filePath = path.join(tmpDir, 'Test.md')
    await fs.writeFile(filePath, '# Test\n')

    const change = makeChange({ action: 'set-commander', cardName: 'Atraxa' })
    await appendChangelog(filePath, 'Test', [change])

    const content = await fs.readFile(path.join(tmpDir, 'Test.changes.md'), 'utf-8')
    expect(content).toContain('- Set "Atraxa" as commander')

    await fs.rm(tmpDir, { recursive: true })
  })

  test('formats unset-commander action', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'changelog-test-'))
    const filePath = path.join(tmpDir, 'Test.md')
    await fs.writeFile(filePath, '# Test\n')

    const change = makeChange({ action: 'unset-commander', cardName: 'Atraxa' })
    await appendChangelog(filePath, 'Test', [change])

    const content = await fs.readFile(path.join(tmpDir, 'Test.changes.md'), 'utf-8')
    expect(content).toContain('- Unset "Atraxa" as commander')

    await fs.rm(tmpDir, { recursive: true })
  })

  test('formats set-finish action', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'changelog-test-'))
    const filePath = path.join(tmpDir, 'Test.md')
    await fs.writeFile(filePath, '# Test\n')

    const change = makeChange({ action: 'set-finish', cardName: 'Sol Ring', finish: 'foil' })
    await appendChangelog(filePath, 'Test', [change])

    const content = await fs.readFile(path.join(tmpDir, 'Test.changes.md'), 'utf-8')
    expect(content).toContain('- Set "Sol Ring" finish to foil')

    await fs.rm(tmpDir, { recursive: true })
  })

  test('includes condition info for collection cards', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'changelog-test-'))
    const filePath = path.join(tmpDir, 'Test.md')
    await fs.writeFile(filePath, '# Test\n')

    const change = makeChange({
      cardName: 'Black Lotus',
      set: 'LEA',
      collectorNumber: '1',
      finish: 'nonfoil',
      condition: 'LP',
    })
    await appendChangelog(filePath, 'Test', [change])

    const content = await fs.readFile(path.join(tmpDir, 'Test.changes.md'), 'utf-8')
    expect(content).toContain('- Added "Black Lotus" (LEA:1) [LP]')

    await fs.rm(tmpDir, { recursive: true })
  })

  test('returns changelog path without writing when changes array is empty', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'changelog-test-'))
    const filePath = path.join(tmpDir, 'Test.md')
    await fs.writeFile(filePath, '# Test\n')

    const changelogPath = await appendChangelog(filePath, 'Test', [])

    expect(changelogPath).toBe(path.join(tmpDir, 'Test.changes.md'))
    // File should not have been created
    const exists = await Bun.file(changelogPath).exists()
    expect(exists).toBe(false)

    await fs.rm(tmpDir, { recursive: true })
  })

  describe('continueSession', () => {
    /** Count the `## ` blocks (one per changelog entry) in a changelog file. */
    function countBlocks(content: string): number {
      return content.split('\n').filter((line) => line.startsWith('## ')).length
    }

    test('merges into the last block and bumps its timestamp', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'changelog-test-'))
      const filePath = path.join(tmpDir, 'Test.md')
      const changelogPath = path.join(tmpDir, 'Test.changes.md')
      await fs.writeFile(filePath, '# Test\n')
      await fs.writeFile(
        changelogPath,
        '# Changelog for Test\n\n## 2026-01-01T00:00:00.000Z\n\n- Added "Lightning Bolt"\n',
      )

      await appendChangelog(filePath, 'Test', [makeChange({ cardName: 'Counterspell' })], {
        continueSession: true,
      })

      const content = await fs.readFile(changelogPath, 'utf-8')
      // Both changes live under a single block — no second `## ` header.
      expect(countBlocks(content)).toBe(1)
      expect(content).toContain('- Added "Lightning Bolt"')
      expect(content).toContain('- Added "Counterspell"')
      // The original timestamp was replaced with a fresh one.
      expect(content).not.toContain('2026-01-01T00:00:00.000Z')

      await fs.rm(tmpDir, { recursive: true })
    })

    test('preserves the order: existing lines first, then new ones', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'changelog-test-'))
      const filePath = path.join(tmpDir, 'Test.md')
      const changelogPath = path.join(tmpDir, 'Test.changes.md')
      await fs.writeFile(filePath, '# Test\n')
      await fs.writeFile(
        changelogPath,
        '# Changelog for Test\n\n## 2026-01-01T00:00:00.000Z\n\n- Added "Lightning Bolt"\n',
      )

      await appendChangelog(filePath, 'Test', [makeChange({ cardName: 'Counterspell' })], {
        continueSession: true,
      })

      const content = await fs.readFile(changelogPath, 'utf-8')
      expect(content.indexOf('Lightning Bolt')).toBeLessThan(content.indexOf('Counterspell'))

      await fs.rm(tmpDir, { recursive: true })
    })

    test('only merges into the most recent block, leaving earlier blocks intact', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'changelog-test-'))
      const filePath = path.join(tmpDir, 'Test.md')
      const changelogPath = path.join(tmpDir, 'Test.changes.md')
      await fs.writeFile(filePath, '# Test\n')
      await fs.writeFile(
        changelogPath,
        '# Changelog for Test\n\n## 2026-01-01T00:00:00.000Z\n\n- Added "Sol Ring"\n' +
          '\n## 2026-02-02T00:00:00.000Z\n\n- Added "Lightning Bolt"\n',
      )

      await appendChangelog(filePath, 'Test', [makeChange({ cardName: 'Counterspell' })], {
        continueSession: true,
      })

      const content = await fs.readFile(changelogPath, 'utf-8')
      // First block untouched; second block absorbed the new line and was retimed.
      expect(countBlocks(content)).toBe(2)
      expect(content).toContain('## 2026-01-01T00:00:00.000Z')
      expect(content).not.toContain('2026-02-02T00:00:00.000Z')
      expect(content).toContain('- Added "Sol Ring"')
      expect(content).toContain('- Added "Lightning Bolt"')
      expect(content).toContain('- Added "Counterspell"')

      await fs.rm(tmpDir, { recursive: true })
    })

    test('leaves an existing block untouched when changes is empty', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'changelog-test-'))
      const filePath = path.join(tmpDir, 'Test.md')
      const changelogPath = path.join(tmpDir, 'Test.changes.md')
      await fs.writeFile(filePath, '# Test\n')
      const original =
        '# Changelog for Test\n\n## 2026-01-01T00:00:00.000Z\n\n- Added "Lightning Bolt"\n'
      await fs.writeFile(changelogPath, original)

      await appendChangelog(filePath, 'Test', [], { continueSession: true })

      // Empty changes short-circuit before any read/write — the block and its
      // timestamp are left exactly as they were.
      const content = await fs.readFile(changelogPath, 'utf-8')
      expect(content).toBe(original)

      await fs.rm(tmpDir, { recursive: true })
    })

    test('starts a fresh block when the changelog does not exist yet', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'changelog-test-'))
      const filePath = path.join(tmpDir, 'Test.md')
      const changelogPath = path.join(tmpDir, 'Test.changes.md')
      await fs.writeFile(filePath, '# Test\n')

      await appendChangelog(filePath, 'Test', [makeChange()], { continueSession: true })

      const content = await fs.readFile(changelogPath, 'utf-8')
      expect(content).toContain('# Changelog for Test')
      expect(countBlocks(content)).toBe(1)

      await fs.rm(tmpDir, { recursive: true })
    })

    test('appends a new block when continueSession is false', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'changelog-test-'))
      const filePath = path.join(tmpDir, 'Test.md')
      const changelogPath = path.join(tmpDir, 'Test.changes.md')
      await fs.writeFile(filePath, '# Test\n')
      await fs.writeFile(
        changelogPath,
        '# Changelog for Test\n\n## 2026-01-01T00:00:00.000Z\n\n- Added "Lightning Bolt"\n',
      )

      await appendChangelog(filePath, 'Test', [makeChange({ cardName: 'Counterspell' })], {
        continueSession: false,
      })

      const content = await fs.readFile(changelogPath, 'utf-8')
      expect(countBlocks(content)).toBe(2)

      await fs.rm(tmpDir, { recursive: true })
    })
  })
})
