import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { handleExport, type ExportResponse } from '../../src/admin/api/export'
import { EXPORTS_DIR_NAME, writeExportFile } from '../../src/export/file'
import {
  bindWorkspace,
  seedCardCache,
  writeCollectionFile,
  writeDeckFile,
  type BoundWorkspace,
} from '../helpers/workspace'
import { callJson } from './helpers/request'
import { makePrintingIn } from '../test-utils'

/**
 * `POST /api/export` — the two output modes. Selection and rendering are covered
 * by the export engine's unit tests and the CLI suite; what this pins is the
 * route: the `mode` discriminator, and that `write: true` really lands a file
 * under the workspace's gitignored `exports/` directory without overwriting.
 */

let ws: BoundWorkspace

beforeEach(async () => {
  ws = await bindWorkspace({ config: false })
  await writeCollectionFile(ws.dir, 'binder', {
    title: 'Binder',
    entries: [
      { name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 1 },
      { name: 'Sol Ring', set: 'c21', collectorNumber: '240', cardId: 2 },
    ],
  })
})

afterEach(async () => {
  await ws.dispose()
})

type ExportCall = { status: number; body: ExportResponse }

function post(body: unknown): Promise<ExportCall> {
  return callJson<ExportResponse>(handleExport, 'POST', '/api/export', body)
}

describe('handleExport', () => {
  test('the scryfallId column is resolved through the cache lookup the route wires in', async () => {
    await seedCardCache(ws.dir, { 'Lightning Bolt': [makePrintingIn('lea', '161')] })
    const { status, body } = await post({
      lists: [{ type: 'collection', name: 'binder' }],
      columns: ['name', 'scryfallId'],
    })
    expect(status).toBe(200)
    if (!('content' in body)) throw new Error('expected content mode')
    expect(body.content).toContain('lea-161')
  })

  // The only surface where a text dialect's omitted-extras warning can be
  // observed by an API client: the route merges `rendered.warnings` into its one
  // `warnings` array. The line form and the drop rule are pinned in the engine's
  // unit tests — what this adds is that both halves survive the transport.
  test('a text dialect reaches the renderer and its omission warning reaches the client', async () => {
    await writeDeckFile(ws.dir, 'burn', {
      name: 'Burn',
      sections: [
        {
          name: 'Main',
          cards: [
            { quantity: 1, name: 'Fireblast', set: 'vis', collectorNumber: '78', finish: 'foil' },
          ],
        },
        {
          name: 'Maybeboard',
          cards: [{ quantity: 2, name: 'Price of Progress', set: 'exo', collectorNumber: '96' }],
        },
      ],
    })
    const { status, body } = await post({
      lists: [{ type: 'deck', name: 'burn' }],
      format: 'text',
      dialect: 'moxfield',
    })
    expect(status).toBe(200)
    if (!('content' in body)) throw new Error('expected content mode')
    expect(body.content).toBe('Deck\n1 Fireblast (VIS) *F* 78')
    expect(body.warnings).toHaveLength(1)
    expect(body.warnings[0]).toContain('Omitted cards a decklist has no board for: Maybeboard (2)')
  })

  test('content mode returns the rendered export inline', async () => {
    const { status, body } = await post({ lists: [{ type: 'collection', name: 'binder' }] })
    expect(status).toBe(200)
    expect(body).toMatchObject({ success: true, mode: 'content', format: 'csv', entryCount: 2 })
    if (!('content' in body)) throw new Error('expected content mode')
    expect(body.content).toContain('Lightning Bolt')
  })

  // The CLI lowercases `--format` before validating; the route now shares that
  // rule through `parseEnumField`, so the same spelling works on both surfaces.
  test('an uppercase format is accepted, as it is on the CLI', async () => {
    const { status, body } = await post({
      lists: [{ type: 'collection', name: 'binder' }],
      format: 'CSV',
    })
    expect(status).toBe(200)
    expect(body).toMatchObject({ success: true, format: 'csv' })
  })

  test('an uppercase filters.finish and set code are accepted and normalized', async () => {
    const { status, body } = await post({
      lists: [{ type: 'collection', name: 'binder' }],
      filters: { finish: 'NonFoil', set: 'LEA' },
    })
    expect(status).toBe(200)
    // Accepting the casing is only half of it: the normalized values must then
    // *match*, so the LEA card comes back and the C21 one does not.
    expect(body).toMatchObject({ entryCount: 1 })
  })

  test('a malformed set filter is a 400 rather than a filter matching nothing', async () => {
    const { status, body } = await post({
      lists: [{ type: 'collection', name: 'binder' }],
      filters: { set: '../etc' },
    })
    expect(status).toBe(400)
    expect(body).toMatchObject({ success: false })
  })

  test('write mode lands a file under exports/ and reports its relative path', async () => {
    const { body } = await post({
      lists: [{ type: 'collection', name: 'binder' }],
      write: true,
    })
    if (!('path' in body)) throw new Error(`expected file mode, got ${JSON.stringify(body)}`)

    expect(body.mode).toBe('file')
    expect(body.entryCount).toBe(2)
    // The relative path is the contract — an absolute one would be a path the
    // caller could walk out of the workspace with.
    expect(body.path).toStartWith(`${EXPORTS_DIR_NAME}/binder-`)
    expect(body.path).toEndWith('.csv')

    const written = await fs.readFile(path.join(ws.dir, body.path), 'utf-8')
    expect(written).toContain('Lightning Bolt')
    expect(written).toEndWith('\n')
    expect(Buffer.byteLength(written)).toBe(body.bytes)
  })

  test('a second identical write never overwrites the first', async () => {
    const first = await post({ lists: [{ type: 'collection', name: 'binder' }], write: true })
    const second = await post({ lists: [{ type: 'collection', name: 'binder' }], write: true })
    if (!('path' in first.body) || !('path' in second.body)) throw new Error('expected file mode')

    expect(second.body.path).not.toBe(first.body.path)
    expect(second.body.path).toContain('-2.csv')
    const dir = await fs.readdir(path.join(ws.dir, EXPORTS_DIR_NAME))
    expect(dir).toHaveLength(2)
  })

  test('a non-boolean write is a 400 and writes nothing', async () => {
    const { status } = await post({ write: 'yes' })
    expect(status).toBe(400)
    // The directory is only created by a successful write, so it must not exist.
    expect(await fs.exists(path.join(ws.dir, EXPORTS_DIR_NAME))).toBeFalse()
  })
})

/**
 * The file layer directly, for the race the route cannot stage: the name is
 * chosen from a directory snapshot, so a name that became taken *after* the
 * snapshot must not be overwritten.
 */
describe('writeExportFile', () => {
  test('a name taken since the snapshot is skipped, not overwritten', async () => {
    const dir = path.join(ws.dir, EXPORTS_DIR_NAME)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, 'cards-20260728.csv'), 'claimed by someone else\n')

    const written = await writeExportFile('name\nSol Ring', {
      lists: [],
      hasCardPicks: true,
      format: 'csv',
      now: new Date('2026-07-28T12:00:00Z'),
      // Deliberately stale: the collided name is only discoverable from the write.
      existing: new Set(),
    })

    expect(written.path).toBe(`${EXPORTS_DIR_NAME}/cards-20260728-2.csv`)
    expect(await fs.readFile(path.join(dir, 'cards-20260728.csv'), 'utf-8')).toBe(
      'claimed by someone else\n',
    )
    expect(await fs.readFile(written.absolutePath, 'utf-8')).toBe('name\nSol Ring\n')
  })
})
