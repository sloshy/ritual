import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { execSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { ApiErrorResponse } from '../../src/api/http'
import { handleArtSave } from '../../src/admin/api/art'
import { handleImportCsv } from '../../src/admin/api/import-csv'
import { resolveFlatListFile } from '../../src/admin/api/list-file'
import {
  handleListCreate,
  handleListDelete,
  handleListRename,
  type ListLifecycleConfig,
} from '../../src/admin/api/list-lifecycle'
import { handleListSave } from '../../src/admin/api/list-save'
import { handleMetadataSave } from '../../src/admin/api/metadata'
import { createMoveFromChange } from '../../src/changes/change-event'
import { computeHash } from '../../src/changes/content-hash'
import { getDefaultRitualConfig } from '../../src/config/ritual-config'
import { DECK_FORMAT_KEYS } from '../../src/list/deck-format'
import { keyedMessage } from '../helpers/api-message'
import { saveList } from '../helpers/list-save'
import { expectLocaleInForce, pseudoCatalog, withSyntheticLocaleAsync } from '../helpers/sync-text'
import {
  bindWorkspace,
  initGitRepo,
  writeCollectionFile,
  writeDeckFile,
  type BoundWorkspace,
} from '../helpers/workspace'
import { callJson, type JsonCall } from './helpers/request'

/**
 * What the list-file engines refuse with reaches the admin API — and through
 * it MCP — as English plus its key, whatever the server's own UI language: a
 * create or rename that collides with a list under name folding, a name with
 * no usable file-name characters, a delete whose confirmation does not match,
 * a cover naming no card, a metadata, art or import body the grammar refuses,
 * an unreadable `.art.json`, a save the whole-file-rewrite gate refuses, and a
 * save whose cross-list move cannot reach its other list. The engines' wording
 * is pinned by their unit tests; this pins the wire, nested params included.
 *
 * Every call runs under the full pseudo-locale, which changes every catalog
 * message, so a refusal rendered in the server's language could not hide.
 */

let ws: BoundWorkspace

const COLLECTION_CFG: ListLifecycleConfig = {
  kind: 'collection',
  getDir: () => path.join(ws.dir, 'collections'),
  resolveFile: resolveFlatListFile,
}

/** Run `body` under the pseudo-locale, checking it is in force before and after. */
function underPseudo<T>(body: () => Promise<T>): Promise<T> {
  return withSyntheticLocaleAsync('en-XA', pseudoCatalog(), async (locale) => {
    expectLocaleInForce(locale)
    const result = await body()
    expectLocaleInForce(locale)
    return result
  })
}

/** Call `handler` under the pseudo-locale. */
function pseudoCall(
  handler: (req: Request) => Promise<Response>,
  method: 'POST' | 'PUT' | 'DELETE',
  url: string,
  body: unknown,
): Promise<JsonCall<ApiErrorResponse>> {
  return underPseudo(() => callJson<ApiErrorResponse>(handler, method, url, body))
}

/** A save route's answer under the pseudo-locale, read as the refusal envelope. */
async function pseudoSave(response: () => Promise<Response>): Promise<JsonCall<ApiErrorResponse>> {
  return underPseudo(async () => {
    const resp = await response()
    return { status: resp.status, body: (await resp.json()) as ApiErrorResponse }
  })
}

const tradeBinderPath = (): string => path.join(ws.dir, 'collections', 'Trade Binder.md')

beforeEach(async () => {
  ws = await bindWorkspace({ config: false })
  await writeCollectionFile(ws.dir, 'Trade Binder', {
    title: 'Trade Binder',
    entries: [{ name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 1 }],
  })
  await writeCollectionFile(ws.dir, 'Spares', { title: 'Spares', entries: [] })
  await writeDeckFile(ws.dir, 'burn', {
    name: 'Burn',
    frontMatter: { format: 'modern' },
    sections: [{ name: 'Main', cards: [{ quantity: 4, name: 'Lightning Bolt', cardId: 1 }] }],
  })
})

afterEach(async () => {
  await ws.dispose()
})

describe('list-engine refusals on the admin API (Integration)', () => {
  test('a create colliding under name folding is a keyed 409', async () => {
    const { status, body } = await pseudoCall(
      (req) => handleListCreate(req, COLLECTION_CFG),
      'POST',
      '/api/collection/create',
      { name: 'trade-binder' },
    )
    expect(status).toBe(409)
    expect(keyedMessage(body)).toBe(
      "A collection named 'Trade Binder' already exists (it matches 'trade-binder' under list-name folding).",
    )
    expect(body.messageKey).toBe('domain.list.lifecycle.existsFolded')
    expect(body.messageParams).toEqual({
      type: 'collection',
      name: 'Trade Binder',
      query: 'trade-binder',
    })
  })

  test('a create with no usable file-name characters is a keyed 400', async () => {
    const { status, body } = await pseudoCall(
      (req) => handleListCreate(req, COLLECTION_CFG),
      'POST',
      '/api/collection/create',
      { name: '???' },
    )
    expect(status).toBe(400)
    expect(keyedMessage(body)).toBe("'???' contains no characters usable in a file name.")
    expect(body.messageKey).toBe('domain.list.name.unusable')
    expect(body.messageParams).toEqual({ name: '???' })
  })

  test('a rename onto a name another list folds to is a keyed 409', async () => {
    const { status, body } = await pseudoCall(
      (req) => handleListRename(req, COLLECTION_CFG),
      'POST',
      '/api/collection/Spares/rename',
      { newName: 'TRADE BINDER' },
    )
    expect(status).toBe(409)
    expect(keyedMessage(body)).toBe(
      "A collection named 'Trade Binder' already exists (it matches 'TRADE BINDER' under list-name folding).",
    )
    expect(body.messageKey).toBe('domain.list.lifecycle.existsFolded')
    expect(await Bun.file(path.join(ws.dir, 'collections', 'Spares.md')).exists()).toBe(true)
  })

  test('a delete whose confirmation does not match is a keyed 400, and nothing moves', async () => {
    const { status, body } = await pseudoCall(
      (req) => handleListDelete(req, COLLECTION_CFG),
      'DELETE',
      '/api/collection/Trade%20Binder',
      { confirmName: 'trade binder' },
    )
    expect(status).toBe(400)
    expect(keyedMessage(body)).toBe("Confirmation name does not match. Expected 'Trade Binder'.")
    expect(body.messageKey).toBe('domain.list.lifecycle.confirmMismatch')
    expect(await Bun.file(tradeBinderPath()).exists()).toBe(true)
  })

  test('a cover naming no card of the list is a keyed 400', async () => {
    const { status, body } = await pseudoCall(
      handleMetadataSave,
      'PUT',
      '/api/metadata/collection/Trade%20Binder',
      { image: { card: 9 } },
    )
    expect(status).toBe(400)
    expect(keyedMessage(body)).toBe('image references card &9, which is not a card in this list.')
    // The id rides as the line's own token, never a formatted number.
    expect(body.messageParams).toEqual({ card: '9' })
  })

  test('a cover the grammar refuses carries its unknown keys as a nested list', async () => {
    const { status, body } = await pseudoCall(
      handleMetadataSave,
      'PUT',
      '/api/metadata/deck/burn',
      { image: { card: 1, colour: 'red', size: 2 } },
    )
    expect(status).toBe(400)
    expect(keyedMessage(body)).toBe('a list image has no such key: colour, size')
    expect(body.messageParams).toEqual({ keys: { list: ['colour', 'size'], join: 'unit' } })
  })

  test('an unknown deck format is a keyed 400 nesting the valid formats as a list', async () => {
    const { status, body } = await pseudoCall(
      handleMetadataSave,
      'PUT',
      '/api/metadata/deck/burn',
      {
        format: 'kitchen-table',
      },
    )
    expect(status).toBe(400)
    expect(keyedMessage(body)).toBe(
      `Invalid deck format 'kitchen-table'. Valid formats: ${DECK_FORMAT_KEYS.join(', ')}`,
    )
    expect(body.messageParams).toEqual({
      format: 'kitchen-table',
      formats: { list: DECK_FORMAT_KEYS, join: 'unit' },
    })
  })

  test('an art reference the grammar refuses is a keyed 400', async () => {
    const { status, body } = await pseudoCall(handleArtSave, 'PUT', '/api/art/deck/burn', {
      cardId: 1,
      art: { file: '../secrets.png' },
    })
    expect(status).toBe(400)
    expect(keyedMessage(body)).toBe('"../secrets.png" escapes the art directory')
    expect(body.messageKey).toBe('domain.list.art.escapes')
    expect(body.messageParams).toEqual({ file: '../secrets.png' })
  })

  test('an unreadable .art.json nests the parse problem under the sidecar’s path', async () => {
    const sidecar = path.join(ws.dir, 'decks', 'burn.art.json')
    await fs.writeFile(sidecar, '{ nope')
    const { status, body } = await pseudoCall(handleArtSave, 'PUT', '/api/art/deck/burn', {
      cardId: 1,
      art: { url: 'https://example.test/bolt.png' },
    })
    expect(status).toBe(400)
    expect(keyedMessage(body)).toStartWith(`${sidecar}: not valid JSON: `)
    expect(body.messageKey).toBe('domain.list.sidecar.problem')
    expect(body.messageParams).toEqual({
      file: sidecar,
      reason: {
        messageKey: 'domain.list.sidecar.invalidJson',
        messageParams: { error: expect.any(String) as string },
      },
    })
    // Refused rather than overwritten.
    expect(await fs.readFile(sidecar, 'utf-8')).toBe('{ nope')
  })

  test('an Import CSV into a colliding name nests the lifecycle refusal as its reason', async () => {
    const { status, body } = await pseudoCall(handleImportCsv, 'POST', '/api/import-csv', {
      listType: 'collection',
      name: 'trade-binder',
      content: 'Name,Set,Collector Number\nArcane Signet,fdn,266',
      columns: 'name=1,set=2,collector-number=3',
    })
    expect(status).toBe(400)
    expect(keyedMessage(body)).toBe(
      "A collection named 'Trade Binder' already exists (it matches 'trade-binder' under list-name folding). Use overwrite or append mode to change it.",
    )
    expect(body.messageKey).toBe('domain.import.nameTaken')
    expect(body.messageParams).toEqual({
      reason: {
        messageKey: 'domain.list.lifecycle.existsFolded',
        messageParams: { type: 'collection', name: 'Trade Binder', query: 'trade-binder' },
      },
    })
  })

  test('a save the rewrite gate refuses nests the fenced-block problem', async () => {
    const deckPath = path.join(ws.dir, 'decks', 'burn.md')
    const original = `${await fs.readFile(deckPath, 'utf-8')}\n\`\`\`\n1 Fake Card &99\n\`\`\`\n`
    await fs.writeFile(deckPath, original)
    const { status, body } = await pseudoCall(
      (req) => handleListSave(req, 'deck'),
      'POST',
      '/api/deck/burn/save',
      { changes: [], contentHash: computeHash(original) },
    )
    expect(status).toBe(400)
    expect(keyedMessage(body)).toBe(
      `${deckPath} holds content the parser cannot re-emit, and saving would delete it ` +
        '(releasing any &N ids it carries). Fix the file first — Fenced code block content ' +
        '(3 lines) — read as prose, but a whole-file rewrite would delete it',
    )
    expect(body.messageParams).toEqual({
      action: 'saving',
      file: deckPath,
      problems: {
        list: [{ messageKey: 'domain.list.fencedContent', messageParams: { count: 3 } }],
        join: 'clauses',
      },
    })
    expect(await fs.readFile(deckPath, 'utf-8')).toBe(original)
  })
})

describe('cross-list move refusals on the admin save (Integration)', () => {
  /** A save of the Trade Binder moving its Sol Ring to `to`. */
  function moveSolRing(to: { type: 'deck' | 'collection' | 'wanted'; name: string }) {
    return pseudoSave(() =>
      saveList('collection', 'Trade Binder', tradeBinderPath(), [
        createMoveFromChange('Sol Ring', { set: 'c21', collectorNumber: '263', cardId: 1, to }),
      ]),
    )
  }

  test('a destination that does not exist is English plus key, the list nested', async () => {
    const before = await fs.readFile(tradeBinderPath(), 'utf-8')
    const { status, body } = await moveSolRing({ type: 'deck', name: 'Nowhere' })
    expect(status).toBeGreaterThanOrEqual(400)
    expect(keyedMessage(body)).toBe(
      'Cannot move "Sol Ring": destination Deck \'Nowhere\' not found',
    )
    expect(body.messageKey).toBe('domain.list.move.destinationNotFound')
    expect(body.messageParams).toEqual({
      name: 'Sol Ring',
      list: {
        messageKey: 'domain.change.listRef',
        messageParams: { type: 'deck', name: 'Nowhere' },
      },
    })
    expect(await fs.readFile(tradeBinderPath(), 'utf-8')).toBe(before)
  })

  test('a destination the rewrite gate refuses nests the staging refusal', async () => {
    const fencedPath = await writeDeckFile(ws.dir, 'fenced', {
      name: 'Fenced',
      frontMatter: { format: 'modern' },
      cards: [{ quantity: 1, name: 'Shock', cardId: 1 }],
    })
    await fs.appendFile(fencedPath, '\n```\n1 Fake Card\n```\n')
    const { status, body } = await moveSolRing({ type: 'deck', name: 'Fenced' })
    expect(status).toBeGreaterThanOrEqual(400)
    expect(keyedMessage(body)).toStartWith(
      `Aborting move: ${fencedPath} holds content the parser cannot re-emit, and moving would delete it`,
    )
    expect(body.messageKey).toBe('domain.list.move.abortMove')
    expect(body.messageParams).toEqual({
      reason: {
        messageKey: 'domain.list.unreadableContent',
        messageParams: {
          action: 'moving',
          file: fencedPath,
          problems: {
            list: [{ messageKey: 'domain.list.fencedContent', messageParams: { count: 3 } }],
            join: 'clauses',
          },
        },
      },
    })
  })
})

describe('admin commit messages under a foreign UI language (Integration)', () => {
  test('the commits the admin writes into the workspace stay English', async () => {
    await ws.dispose()
    const base = getDefaultRitualConfig()
    ws = await bindWorkspace({
      config: {
        admin: { ...base.admin, gitEnabled: true, gitAutoCommit: true, gitAutoPush: false },
      },
    })
    await writeDeckFile(ws.dir, 'burn', {
      name: 'Burn',
      frontMatter: { format: 'modern' },
      cards: [{ quantity: 4, name: 'Lightning Bolt', cardId: 1 }],
    })
    initGitRepo(ws.dir)
    execSync('git add -A', { cwd: ws.dir })
    execSync('git commit -q -m baseline', { cwd: ws.dir })

    const created = await pseudoCall(
      (req) => handleListCreate(req, COLLECTION_CFG),
      'POST',
      '/api/collection/create',
      { name: 'Fresh Binder' },
    )
    expect(created.status).toBe(200)
    const art = await pseudoCall(handleArtSave, 'PUT', '/api/art/deck/burn', {
      cardId: 1,
      art: { url: 'https://example.test/bolt.png' },
    })
    expect(art.status).toBe(200)

    const log = execSync('git log --pretty=%s', { cwd: ws.dir, encoding: 'utf-8' })
    expect(log.trim().split('\n')).toEqual([
      'Update custom art for deck burn',
      'Create collection: Fresh Binder',
      'baseline',
    ])
  }, 60_000)
})
