import { describe, expect, test } from 'bun:test'
import type { AmbiguousRemoval } from '../../../src/collection-sync/describe'
import {
  elicitRemovalAssignments,
  readRemovalAssignments,
} from '../../../src/mcp/removal-elicitation'

/**
 * The form ↔ assignment mapping on its own, without a transport: what each
 * ambiguous removal is asked as, and what a retried request's answers become.
 * The round trip itself is pinned in test/integration/mcp-elicitation.test.ts.
 */

const BOLT: AmbiguousRemoval = {
  key: 'lea|161|nonfoil|NM|en',
  parts: { set: 'lea', collectorNumber: '161', finish: 'nonfoil', condition: 'NM' },
  name: 'Lightning Bolt',
  quantity: 2,
  lists: [
    { list: 'binder', copies: 1 },
    { list: 'longbox', copies: 2 },
  ],
}

const SOL_RING: AmbiguousRemoval = {
  key: 'c21|240|nonfoil|NM|en',
  parts: { set: 'c21', collectorNumber: '240', finish: 'nonfoil', condition: 'NM' },
  name: 'Sol Ring',
  quantity: 1,
  lists: [
    { list: 'binder', copies: 1 },
    { list: 'shoebox', copies: 1 },
  ],
}

/** The shape of one elicited form these tests read. */
type FormField = { type: string; maximum?: number }
type Form = {
  method: string
  params: { message: string; requestedSchema?: { properties: Record<string, FormField> } }
}

describe('elicitRemovalAssignments', () => {
  test('asks one form per removal, keyed by the removal, with one bounded field per list', () => {
    const result = elicitRemovalAssignments([BOLT, SOL_RING])
    const requests = result.inputRequests as Record<string, Form>

    expect(Object.keys(requests)).toEqual([`removal:${BOLT.key}`, `removal:${SOL_RING.key}`])
    const bolt = requests[`removal:${BOLT.key}`]!
    expect(bolt.method).toBe('elicitation/create')
    expect(bolt.params.message).toContain('2 × Lightning Bolt (LEA:161)')
    expect(bolt.params.message).toContain('add up to 2')
    // Each list is a field capped at what it holds, so a client cannot offer
    // more copies than exist.
    expect(bolt.params.requestedSchema?.properties).toEqual({
      binder: expect.objectContaining({ type: 'integer', maximum: 1 }),
      longbox: expect.objectContaining({ type: 'integer', maximum: 2 }),
    })
  })
})

describe('readRemovalAssignments', () => {
  const accept = (content: Record<string, unknown>): Record<string, unknown> => ({
    action: 'accept',
    content,
  })

  test('a request without removal answers is the first round', () => {
    expect(readRemovalAssignments(undefined)).toEqual({ kind: 'none' })
    expect(readRemovalAssignments({ other: accept({ x: 1 }) })).toEqual({ kind: 'none' })
  })

  test('turns every accepted form into an assignment, dropping the lists that keep their copies', () => {
    const result = readRemovalAssignments({
      [`removal:${BOLT.key}`]: accept({ binder: 0, longbox: 2 }),
      [`removal:${SOL_RING.key}`]: accept({ binder: 1, shoebox: 0 }),
    })
    expect(result).toEqual({
      kind: 'assignments',
      assignments: [
        { key: BOLT.key, choices: [{ list: 'longbox', copies: 2 }] },
        { key: SOL_RING.key, choices: [{ list: 'binder', copies: 1 }] },
      ],
    })
  })

  test.each([
    ['a declined form', { action: 'decline' }],
    ['a cancelled form', { action: 'cancel' }],
    ['an answer that is not integer counts', accept({ binder: 'one' })],
    ['a negative count', accept({ binder: -1 })],
    ['a form left entirely at zero', accept({ binder: 0, longbox: 0 })],
  ])('%s reads as declined', (_label, response) => {
    expect(
      readRemovalAssignments({
        [`removal:${BOLT.key}`]: response,
        [`removal:${SOL_RING.key}`]: accept({ binder: 1 }),
      }),
    ).toEqual({ kind: 'declined' })
  })
})
