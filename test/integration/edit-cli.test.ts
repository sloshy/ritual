import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { runCli } from './helpers/cli'
import {
  createWorkspace,
  removeWorkspace,
  writeCollectionFile,
  writeDeckFile,
} from './helpers/workspace'

let dir: string

beforeEach(async () => {
  dir = await createWorkspace()
  await writeDeckFile(dir, 'Staples', {
    frontMatter: { name: 'Staples' },
    cards: [{ quantity: 1, name: 'Sol Ring', cardId: 1 }],
  })
  await writeCollectionFile(dir, 'Staples', {
    entries: [{ name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 1 }],
  })
})

afterEach(async () => {
  await removeWorkspace(dir)
})

// The [listName] resolution failures exit before any interactive prompt runs,
// so they are testable without a TTY; the direct-open success path is TUI-only
// and covered at the unit layer (parseDirectListArgument).
describe('ritual edit [listName] resolution (Integration)', () => {
  test('ambiguous list name exits 2', async () => {
    const result = await runCli(['edit', 'Staples'], dir)
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('--deck, --collection, or --wanted')
  })

  test('unknown list name exits 3', async () => {
    const result = await runCli(['edit', 'No Such List'], dir)
    expect(result.exitCode).toBe(3)
    expect(result.stderr).toContain("No deck, collection, or wanted list named 'No Such List'")
  })

  test('conflicting type flags exit 2', async () => {
    const result = await runCli(['edit', 'Staples', '--deck', '--wanted'], dir)
    expect(result.exitCode).toBe(2)
  })

  test('conflicting type flags without a list name also exit 2', async () => {
    const result = await runCli(['edit', '--deck', '--collection'], dir)
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('Specify only one of --deck, --collection, or --wanted.')
  })
})
