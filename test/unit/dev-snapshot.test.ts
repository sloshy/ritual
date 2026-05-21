import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  diffSnapshots,
  snapshotTree,
  type TreeSnapshot,
  type WatchRoot,
} from '../../scripts/dev-snapshot'
import { shouldRestartForSource } from '../../scripts/dev-watch'

describe('diffSnapshots', () => {
  test('no differences for identical snapshots', () => {
    const a: TreeSnapshot = new Map([
      ['/x/a.ts', '1:10'],
      ['/x/b.ts', '2:20'],
    ])
    const b: TreeSnapshot = new Map([
      ['/x/a.ts', '1:10'],
      ['/x/b.ts', '2:20'],
    ])
    expect(diffSnapshots(a, b)).toEqual([])
  })

  test('reports a file whose token changed (mtime or size)', () => {
    const prev: TreeSnapshot = new Map([['/x/a.ts', '1:10']])
    const next: TreeSnapshot = new Map([['/x/a.ts', '5:10']])
    expect(diffSnapshots(prev, next)).toEqual(['/x/a.ts'])
  })

  test('reports added files', () => {
    const prev: TreeSnapshot = new Map([['/x/a.ts', '1:10']])
    const next: TreeSnapshot = new Map([
      ['/x/a.ts', '1:10'],
      ['/x/b.ts', '2:20'],
    ])
    expect(diffSnapshots(prev, next)).toEqual(['/x/b.ts'])
  })

  test('reports removed files', () => {
    const prev: TreeSnapshot = new Map([
      ['/x/a.ts', '1:10'],
      ['/x/b.ts', '2:20'],
    ])
    const next: TreeSnapshot = new Map([['/x/a.ts', '1:10']])
    expect(diffSnapshots(prev, next)).toEqual(['/x/b.ts'])
  })

  test('reports adds, removes, and modifications together', () => {
    const prev: TreeSnapshot = new Map([
      ['/x/a.ts', '1:10'],
      ['/x/b.ts', '2:20'],
    ])
    const next: TreeSnapshot = new Map([
      ['/x/a.ts', '9:10'], // modified
      ['/x/c.ts', '3:30'], // added
    ]) // b removed
    expect(diffSnapshots(prev, next).sort()).toEqual(['/x/a.ts', '/x/b.ts', '/x/c.ts'])
  })
})

describe('snapshotTree', () => {
  let dir: string
  let roots: WatchRoot[]

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'ritual-snapshot-'))
    roots = [{ dir, include: shouldRestartForSource }]
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test('includes only files matching the root predicate', () => {
    writeFileSync(path.join(dir, 'a.ts'), 'export const a = 1')
    writeFileSync(path.join(dir, 'notes.txt'), 'ignored')
    writeFileSync(path.join(dir, 'styles.compiled.css'), 'ignored')
    mkdirSync(path.join(dir, 'generated'))
    writeFileSync(path.join(dir, 'generated', 'gen.ts'), 'ignored')

    const snap = snapshotTree(roots)

    expect([...snap.keys()]).toEqual([path.join(dir, 'a.ts')])
  })

  test('walks nested directories', () => {
    mkdirSync(path.join(dir, 'site', 'icons'), { recursive: true })
    writeFileSync(path.join(dir, 'site', 'app.tsx'), 'x')
    writeFileSync(path.join(dir, 'site', 'icons', 'mana.svg'), '<svg/>')

    const snap = snapshotTree(roots)

    expect(new Set(snap.keys())).toEqual(
      new Set([path.join(dir, 'site', 'app.tsx'), path.join(dir, 'site', 'icons', 'mana.svg')]),
    )
  })

  test('two scans of an unchanged tree produce no diff', () => {
    // Guards against a token that varies between reads, which would make the
    // reconcile backstop restart in a loop even when nothing changed.
    writeFileSync(path.join(dir, 'a.ts'), 'export const a = 1')
    mkdirSync(path.join(dir, 'site'))
    writeFileSync(path.join(dir, 'site', 'b.tsx'), 'x')

    expect(diffSnapshots(snapshotTree(roots), snapshotTree(roots))).toEqual([])
  })

  test('a content edit produces a diff against the prior snapshot', () => {
    const file = path.join(dir, 'a.ts')
    writeFileSync(file, 'export const a = 1')
    const before = snapshotTree(roots)

    writeFileSync(file, 'export const a = 1 // edited, now longer')
    const after = snapshotTree(roots)

    expect(diffSnapshots(before, after)).toEqual([file])
  })

  test('a missing root is skipped rather than throwing', () => {
    const snap = snapshotTree([{ dir: path.join(dir, 'does-not-exist'), include: () => true }])
    expect(snap.size).toBe(0)
  })

  test('honors a second root with its own predicate', () => {
    // src/ and the data dirs are siblings in the real layout, so give each root
    // its own subtree here rather than nesting one inside the other.
    const srcDir = path.join(dir, 'src')
    const dataDir = path.join(dir, 'decks')
    mkdirSync(srcDir)
    mkdirSync(dataDir)
    writeFileSync(path.join(srcDir, 'a.ts'), 'kept by src predicate')
    writeFileSync(path.join(dataDir, 'deck.md'), '# deck')
    writeFileSync(path.join(dataDir, 'deck.ts'), 'ignored by md predicate')

    const snap = snapshotTree([
      { dir: srcDir, include: shouldRestartForSource },
      { dir: dataDir, include: (f) => f.endsWith('.md') },
    ])

    expect(new Set(snap.keys())).toEqual(
      new Set([path.join(srcDir, 'a.ts'), path.join(dataDir, 'deck.md')]),
    )
  })
})
