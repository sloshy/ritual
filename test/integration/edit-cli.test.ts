import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { runCli } from './helpers/cli'
import {
  createWorkspace,
  removeWorkspace,
  writeCollectionFile,
  writeDeckFile,
} from '../helpers/workspace'

let dir: string

beforeEach(async () => {
  dir = await createWorkspace()
  await writeDeckFile(dir, 'Staples', {
    name: 'Staples',
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

  test('a type prefix contradicting a type flag is a usage error naming both', async () => {
    // Distinct wiring from `card-target`'s: `edit` resolves its own argument
    // before the interactive gate, so it is reachable headlessly.
    const result = await runCli(['edit', 'deck:Staples', '--collection'], dir)
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain("'deck:Staples'")
    expect(result.stderr).toContain('--collection')
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

// The editor is a TUI: its entry is gated on prompting being possible. The
// gate runs after [listName] resolution (so the failures above keep their own
// errors) but before any cache work.
describe('ritual edit interactive gating (Integration)', () => {
  test('bare `edit` without a terminal exits 2 pointing at the one-shot commands', async () => {
    const result = await runCli(['edit'], dir, { RITUAL_NO_INPUT: '1' })
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('Input required')
    expect(result.stderr).toContain('add-card')
  })

  test('a valid [listName] still cannot open the TUI headlessly', async () => {
    const result = await runCli(['edit', '--deck', 'Staples'], dir, { RITUAL_NO_INPUT: '1' })
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('Input required')
  })
})
