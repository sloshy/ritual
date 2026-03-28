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
  } as ChangeEvent
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
    expect(content).toContain('- Added Sol Ring')

    await fs.rm(tmpDir, { recursive: true })
  })

  test('appends to existing changelog', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'changelog-test-'))
    const filePath = path.join(tmpDir, 'Test.md')
    const changelogPath = path.join(tmpDir, 'Test.changes.md')
    await fs.writeFile(filePath, '# Test\n')
    await fs.writeFile(
      changelogPath,
      '# Changelog for Test\n\n## 2026-01-01T00:00:00Z\n\n- Added Lightning Bolt\n',
    )

    const change = makeChange({ cardName: 'Counterspell' })
    await appendChangelog(filePath, 'Test', [change])

    const content = await fs.readFile(changelogPath, 'utf-8')
    expect(content).toContain('- Added Lightning Bolt')
    expect(content).toContain('- Added Counterspell')

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
    expect(content).toContain('- Added Demonic Tutor (UMA:93) [foil]')

    await fs.rm(tmpDir, { recursive: true })
  })

  test('formats remove action', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'changelog-test-'))
    const filePath = path.join(tmpDir, 'Test.md')
    await fs.writeFile(filePath, '# Test\n')

    const change = makeChange({ action: 'remove', cardName: 'Misty Rainforest' })
    await appendChangelog(filePath, 'Test', [change])

    const content = await fs.readFile(path.join(tmpDir, 'Test.changes.md'), 'utf-8')
    expect(content).toContain('- Removed Misty Rainforest')

    await fs.rm(tmpDir, { recursive: true })
  })

  test('formats set-commander action', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'changelog-test-'))
    const filePath = path.join(tmpDir, 'Test.md')
    await fs.writeFile(filePath, '# Test\n')

    const change = makeChange({ action: 'set-commander', cardName: 'Atraxa' })
    await appendChangelog(filePath, 'Test', [change])

    const content = await fs.readFile(path.join(tmpDir, 'Test.changes.md'), 'utf-8')
    expect(content).toContain('- Set Atraxa as commander')

    await fs.rm(tmpDir, { recursive: true })
  })

  test('formats unset-commander action', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'changelog-test-'))
    const filePath = path.join(tmpDir, 'Test.md')
    await fs.writeFile(filePath, '# Test\n')

    const change = makeChange({ action: 'unset-commander', cardName: 'Atraxa' })
    await appendChangelog(filePath, 'Test', [change])

    const content = await fs.readFile(path.join(tmpDir, 'Test.changes.md'), 'utf-8')
    expect(content).toContain('- Unset Atraxa as commander')

    await fs.rm(tmpDir, { recursive: true })
  })

  test('formats set-finish action', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'changelog-test-'))
    const filePath = path.join(tmpDir, 'Test.md')
    await fs.writeFile(filePath, '# Test\n')

    const change = makeChange({ action: 'set-finish', cardName: 'Sol Ring', finish: 'foil' })
    await appendChangelog(filePath, 'Test', [change])

    const content = await fs.readFile(path.join(tmpDir, 'Test.changes.md'), 'utf-8')
    expect(content).toContain('- Set Sol Ring finish to foil')

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
    expect(content).toContain('- Added Black Lotus (LEA:1) [LP]')

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
})
