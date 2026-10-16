import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { createAddChange } from '../../src/changes/change-event'
import { toWireChange } from '../../src/changes/wire-changes'
import { handleDeckLoad } from '../../src/admin/api/deck-load'
import type { ListSummaryLoadResult } from '../../src/admin/api/load-results'
import type { ApiErrorResponse } from '../../src/api/http'
import { DeckRewriteHoldError, loadDeck } from '../../src/list/deck-io'
import { bindWorkspace, snapshotTree, type BoundWorkspace } from '../helpers/workspace'
import { saveList } from '../helpers/list-save'
import { callJson } from './helpers/request'
import { runCli } from './helpers/cli'

/**
 * A deck line an older writer left for 1,000+ copies (`- 1234 Sol Ring &4`)
 * loads as one copy of "1234 Sol Ring" and is reported, but no whole-file
 * rewrite may re-emit it as `- 1 1234 Sol Ring` — after which it could never be
 * told from a real card name. The grammar's advisory and its routing to the
 * rewrite gates are pinned in the unit suites; this covers the load and save
 * surfaces: the admin load and save routes, the CLI editor's loader, and
 * `cleanup`.
 */

const SUSPECT_LINE = '- 1234 Sol Ring &4'
// A declared format, so `cleanup` has nothing to ask and would otherwise
// rewrite the file in canonical form.
const DECK = [
  '---',
  'format: modern',
  '---',
  '',
  '# Lands',
  '',
  '## Main',
  '- 2 Island (LEA:288) &1',
  SUSPECT_LINE,
  '',
].join('\n')
const ADVISORY =
  'Read as one copy of "1234 Sol Ring". If the line means 1234 copies, write it as 1234x Sol Ring;' +
  ' if "1234 Sol Ring" really is the card\'s name, write it as - 1 1234 Sol Ring.'

let ws: BoundWorkspace
let deckPath: string

beforeEach(async () => {
  ws = await bindWorkspace({ config: false })
  deckPath = path.join(ws.dir, 'decks', 'lands.md')
  await fs.mkdir(path.dirname(deckPath), { recursive: true })
  await fs.writeFile(deckPath, DECK)
})

afterEach(async () => {
  await ws.dispose()
})

describe('a deck line that may hold 1,000+ unmarked copies (Integration)', () => {
  test('the admin load reports it with the lines a save would lose', async () => {
    const { status, body } = await callJson<ListSummaryLoadResult>(
      handleDeckLoad,
      'GET',
      '/api/deck/lands?view=summary',
    )
    expect(status).toBe(200)
    const warnings = body.warnings.map((warning) => warning.message)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain(ADVISORY)
  })

  test('an admin save of a different card refuses and leaves the file byte-identical', async () => {
    const before = await snapshotTree(ws.dir)
    const resp = await saveList('deck', 'lands', deckPath, [
      toWireChange(createAddChange('Mountain', { section: 'Main' })),
    ])
    expect(resp.status).toBe(400)
    const body = (await resp.json()) as ApiErrorResponse
    expect(body.messageKey).toBe('domain.list.rewriteHold')
    expect(body.message).toContain('saving would rewrite with a different meaning')
    expect(body.message).toContain(ADVISORY)
    expect(await snapshotTree(ws.dir)).toEqual(before)
  })

  test('the CLI editor refuses to open the deck', async () => {
    let caught: unknown
    try {
      await loadDeck(deckPath)
    } catch (error) {
      caught = error
    }
    if (!(caught instanceof DeckRewriteHoldError)) throw new Error('expected the hold refusal')
    expect(caught.name).toBe('DeckRewriteHoldError')
    expect(caught.syncMessage.messageKey).toBe('domain.list.rewriteHold')
    expect(caught.syncMessage.messageParams).toMatchObject({ action: 'opening' })
    expect(caught.message).toContain(ADVISORY)
  })

  test('cleanup reports the line and does not rewrite the file', async () => {
    const result = await runCli(['cleanup', '--no-input'], ws.dir)
    // A rewrite held back is a failed cleanup, exactly as for an unreadable line.
    expect(result.exitCode).toBe(1)
    const output = `${result.stdout}${result.stderr}`
    // Named once: with the lines that block the rewrite, not again as an advisory.
    expect(output.split(ADVISORY)).toHaveLength(2)
    // The rename to the canonical file name is safe and may still happen; the
    // content rewrite is held back, so the line stays exactly as written.
    const after = await fs.readdir(path.join(ws.dir, 'decks'))
    const file = after.find((name) => name.endsWith('.md'))
    expect(file).toBeDefined()
    expect(await fs.readFile(path.join(ws.dir, 'decks', file!), 'utf-8')).toContain(
      `\n${SUSPECT_LINE}\n`,
    )
  })
})
