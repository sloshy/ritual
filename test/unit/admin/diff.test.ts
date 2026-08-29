import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { bindWorkspace, type BoundWorkspace } from '../../helpers/workspace'
import { handleDiff, type DiffResponseBody } from '../../../src/admin/api/diff'
import type { ApiErrorResponse } from '../../../src/api/http'

/**
 * Handler tests for `GET /api/diff`. Diff semantics (identity modes, finish
 * folding, ordering) are pinned by the engine tests in
 * test/unit/list-diff.test.ts; these cover the route's own concerns: query
 * validation, list resolution, and the success body shape.
 */

const BURN_MD = [
  '# Burn',
  '',
  '## Main',
  '',
  '2 Lightning Bolt (LEA:161) &1',
  '1 Fireblast (VIS:78) [foil] &2',
  '',
].join('\n')

const BINDER_MD = [
  '# Binder',
  '',
  '- Lightning Bolt (LEA:161) &1',
  '- Sol Ring (C21:263) &2',
  '',
].join('\n')

let ws: BoundWorkspace

beforeEach(async () => {
  ws = await bindWorkspace()
  await fs.writeFile(path.join(ws.dir, 'decks', 'burn.md'), BURN_MD)
  await fs.writeFile(path.join(ws.dir, 'collections', 'binder.md'), BINDER_MD)
})

afterEach(async () => {
  await ws.dispose()
})

function diffRequest(query: string): Request {
  return new Request(`http://localhost/api/diff${query}`)
}

describe('GET /api/diff', () => {
  test('returns 400 when a or b is missing', async () => {
    for (const query of ['', '?a=burn', '?b=binder']) {
      const resp = await handleDiff(diffRequest(query))
      expect({ query, status: resp.status }).toEqual({ query, status: 400 })
      const body = (await resp.json()) as ApiErrorResponse
      expect(body.success).toBe(false)
    }
  })

  test('returns 400 for an invalid by mode', async () => {
    const resp = await handleDiff(diffRequest('?a=burn&b=binder&by=set'))
    expect(resp.status).toBe(400)
    const body = (await resp.json()) as ApiErrorResponse
    expect(body.message).toBe("Invalid by 'set'. Use one of: name, printing.")
  })

  test('returns 400 for an unresolvable list name', async () => {
    const resp = await handleDiff(diffRequest('?a=burn&b=nope'))
    expect(resp.status).toBe(400)
    const body = (await resp.json()) as ApiErrorResponse
    expect(body.success).toBe(false)
    expect(body.message).toContain('nope')
  })

  test('honours the type: prefix on a side', async () => {
    const resp = await handleDiff(diffRequest('?a=deck:burn&b=collection:binder'))
    expect(resp.status).toBe(200)
    const body = (await resp.json()) as DiffResponseBody
    expect(body.a.listType).toBe('deck')
    expect(body.b.listType).toBe('collection')
  })

  test('diffs two lists by name with the full success body', async () => {
    const resp = await handleDiff(diffRequest('?a=burn&b=binder'))
    expect(resp.status).toBe(200)
    const body = (await resp.json()) as DiffResponseBody
    expect(body.success).toBe(true)
    expect(body.a).toEqual({ listType: 'deck', slug: 'burn', name: 'Burn' })
    expect(body.b).toEqual({ listType: 'collection', slug: 'binder', name: 'Binder' })
    expect(body.by).toBe('name')
    expect(body.matches.map((m) => m.name)).toEqual(['Lightning Bolt'])
    expect(body.matches[0]?.a.quantity).toBe(2)
    expect(body.matches[0]?.b.quantity).toBe(1)
    expect(body.onlyInA.map((o) => o.name)).toEqual(['Fireblast'])
    expect(body.onlyInB.map((o) => o.name)).toEqual(['Sol Ring'])
    expect(body.warnings).toEqual([])
  })

  test('by=printing switches the identity mode', async () => {
    const resp = await handleDiff(diffRequest('?a=burn&b=binder&by=printing'))
    expect(resp.status).toBe(200)
    const body = (await resp.json()) as DiffResponseBody
    expect(body.by).toBe('printing')
    // The shared LEA:161 printing still matches under printing identity.
    expect(body.matches.map((m) => m.name)).toEqual(['Lightning Bolt'])
  })
})
