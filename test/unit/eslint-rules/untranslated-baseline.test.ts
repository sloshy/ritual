import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  BASELINE_FILE,
  SKIP_CHECK_ENV,
  loadUntranslatedBaseline,
  parseBaseline,
  baselineGrowth,
  parseRenames,
  pruneBaseline,
  splitBaseline,
  type Baseline,
} from '../../../eslint-rules/untranslated-baseline.js'

describe('parseBaseline', () => {
  test('accepts files mapped to positive counts', () => {
    expect(parseBaseline('{"src/a.ts":{"Deck saved.":2}}')).toEqual({
      'src/a.ts': { 'Deck saved.': 2 },
    })
  })

  test.each([
    ['not JSON', '{', /not valid JSON/],
    ['a non-object top level', '[]', /top level/],
    ['a file mapped to a non-object', '{"src/a.ts":1}', /"src\/a\.ts" must map/],
    ['a zero count', '{"src/a.ts":{"x y":0}}', /positive integer/],
    ['a fractional count', '{"src/a.ts":{"x y":1.5}}', /positive integer/],
  ])('rejects %s', (_label, raw, message) => {
    const result = parseBaseline(raw)
    expect(typeof result).toBe('string')
    expect(result as string).toMatch(message)
  })
})

describe('splitBaseline', () => {
  test('separates files the rule can lint from orphans', () => {
    const baseline = { 'src/a.ts': { a: 1 }, 'src/gone.ts': { b: 1 } }
    expect(splitBaseline(baseline, (file) => file === 'src/a.ts')).toEqual({
      kept: { 'src/a.ts': { a: 1 } },
      orphans: { 'src/gone.ts': { b: 1 } },
    })
  })
})

describe('pruneBaseline', () => {
  const previous: Baseline = { 'src/a.ts': { 'Deck saved.': 2, 'List gone.': 1 } }

  test('clamps entries to what the scan still finds and counts the removals', () => {
    const result = pruneBaseline(previous, { 'src/a.ts': { 'Deck saved.': 1 } }, { admit: false })
    expect(result.baseline).toEqual({ 'src/a.ts': { 'Deck saved.': 1 } })
    expect(result.removed).toBe(2)
    expect(result.unadmitted).toEqual([])
  })

  test('refuses new debt without the admit flag, and keeps the covered part', () => {
    const current = {
      'src/a.ts': { 'Deck saved.': 3, 'List gone.': 1 },
      'src/b.ts': { 'New text.': 1 },
    }
    const result = pruneBaseline(previous, current, { admit: false })
    expect(result.baseline).toEqual(previous)
    expect(result.unadmitted).toEqual(['src/a.ts: Deck saved.', 'src/b.ts: New text.'])
  })

  test('admits new debt only with the admit flag', () => {
    const current = { 'src/b.ts': { 'New text.': 1 } }
    const result = pruneBaseline({}, current, { admit: true })
    expect(result.baseline).toEqual(current)
    expect(result.unadmitted).toEqual([])
  })

  test('drops an orphaned file whose text appears nowhere and counts it removed', () => {
    const result = pruneBaseline(
      {},
      {},
      { admit: false, orphans: { 'src/gone.ts': { 'Old text.': 2 } } },
    )
    expect(result.baseline).toEqual({})
    expect(result.removed).toBe(2)
    expect(result.carried).toEqual([])
  })

  const moved = { 'Deck saved.': 2, 'List gone.': 1 }

  test('carries an orphan’s entries to the path git reports as its rename target', () => {
    const result = pruneBaseline(
      {},
      { 'src/renamed.ts': moved },
      {
        admit: false,
        orphans: { 'src/a.ts': moved },
        renames: { 'src/a.ts': 'src/renamed.ts' },
      },
    )
    expect(result.baseline).toEqual({ 'src/renamed.ts': moved })
    expect(result.carried).toEqual(['src/a.ts → src/renamed.ts'])
    expect(result.unadmitted).toEqual([])
    expect(result.removed).toBe(0)
  })

  test('never carries to an unrelated file, even one holding exactly that text', () => {
    const result = pruneBaseline(
      {},
      { 'src/unrelated.ts': moved },
      {
        admit: false,
        orphans: { 'src/a.ts': moved },
      },
    )
    expect(result.carried).toEqual([])
    expect(result.baseline).toEqual({})
    expect(result.unadmitted).toEqual([
      'src/unrelated.ts: Deck saved.',
      'src/unrelated.ts: List gone.',
    ])
    expect(result.removed).toBe(3)
  })

  test('never carries onto a file the baseline already covers', () => {
    const result = pruneBaseline(
      { 'src/b.ts': { 'Other.': 1 } },
      { 'src/b.ts': { ...moved, 'Other.': 1 } },
      {
        admit: false,
        orphans: { 'src/a.ts': moved },
        renames: { 'src/a.ts': 'src/b.ts' },
      },
    )
    expect(result.carried).toEqual([])
    expect(result.baseline).toEqual({ 'src/b.ts': { 'Other.': 1 } })
  })

  test('sorts files and texts and omits files left with no entries', () => {
    const current = { 'src/z.ts': { b: 1, a: 1 }, 'src/m.ts': {} }
    const result = pruneBaseline({}, current, { admit: true })
    expect(JSON.stringify(result.baseline)).toBe('{"src/z.ts":{"a":1,"b":1}}')
  })
})

describe('baselineGrowth', () => {
  const head = { 'src/a.ts': { 'Deck saved.': 2 } }

  test('passes a baseline that only shrank', () => {
    expect(baselineGrowth(head, { 'src/a.ts': { 'Deck saved.': 1 } }, {})).toEqual([])
  })

  test('reports a raised count and a new entry', () => {
    const next = { 'src/a.ts': { 'Deck saved.': 3 }, 'src/b.ts': { 'New text.': 1 } }
    expect(baselineGrowth(head, next, {})).toEqual([
      'src/a.ts: Deck saved. (2 → 3)',
      'src/b.ts: New text. (0 → 1)',
    ])
  })

  test('follows a rename, and does not let a rename grow the entries', () => {
    const renames = { 'src/a.ts': 'src/moved.ts' }
    expect(baselineGrowth(head, { 'src/moved.ts': { 'Deck saved.': 2 } }, renames)).toEqual([])
    expect(baselineGrowth(head, { 'src/moved.ts': { 'Deck saved.': 3 } }, renames)).toEqual([
      'src/moved.ts: Deck saved. (2 → 3)',
    ])
  })

  test('treats a missing HEAD baseline as empty', () => {
    expect(baselineGrowth({}, head, {})).toEqual(['src/a.ts: Deck saved. (0 → 2)'])
  })
})

describe('parseRenames', () => {
  test('reads renames out of git name-status output and ignores the rest', () => {
    const output = ['M\tsrc/a.ts', 'R097\tsrc/old.ts\tsrc/new.ts', 'D\tsrc/gone.ts', ''].join('\n')
    expect(parseRenames(output)).toEqual({ 'src/old.ts': 'src/new.ts' })
  })
})

describe('loadUntranslatedBaseline', () => {
  const roots: string[] = []

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
    delete process.env[SKIP_CHECK_ENV]
  })

  /** A throwaway repo root holding `baseline` and the files in `existing`. */
  function makeRoot(baseline: object, existing: string[]): string {
    const root = mkdtempSync(path.join(tmpdir(), 'ritual-baseline-'))
    roots.push(root)
    mkdirSync(path.join(root, 'eslint-rules'))
    writeFileSync(path.join(root, BASELINE_FILE), JSON.stringify(baseline))
    for (const file of existing) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
      writeFileSync(path.join(root, file), '')
    }
    return root
  }

  test('returns the baseline when every file it names is lintable', () => {
    const baseline = { 'src/a.ts': { 'Deck saved.': 1 } }
    expect(loadUntranslatedBaseline(makeRoot(baseline, ['src/a.ts']))).toEqual(baseline)
  })

  test('fails naming only the deleted file, which the rule can never see', () => {
    const root = makeRoot({ 'src/a.ts': { x: 1 }, 'src/gone.ts': { y: 1 } }, ['src/a.ts'])
    expect(() => loadUntranslatedBaseline(root)).toThrow(/no longer see: src\/gone\.ts\. /)
  })

  test('fails on a file outside the rule’s scope', () => {
    const root = makeRoot({ 'src/mcp/tools/read-tools.ts': { x: 1 } }, [
      'src/mcp/tools/read-tools.ts',
    ])
    expect(() => loadUntranslatedBaseline(root)).toThrow(/src\/mcp\/tools\/read-tools\.ts/)
  })

  test('fails on a malformed file', () => {
    const root = makeRoot({ 'src/a.ts': { x: 0 } }, ['src/a.ts'])
    expect(() => loadUntranslatedBaseline(root)).toThrow(/malformed/)
  })

  // The prune script sets the opt-out, so a deleted file cannot lock it out of
  // the lint config it needs to repair the baseline.
  test('skips the check while the prune script runs', () => {
    process.env[SKIP_CHECK_ENV] = '1'
    expect(loadUntranslatedBaseline(makeRoot({ 'src/gone.ts': { y: 1 } }, []))).toEqual({})
  })
})
