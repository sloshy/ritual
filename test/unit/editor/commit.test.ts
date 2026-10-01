import { afterEach, describe, expect, test } from 'bun:test'
import type { ChangeEvent } from '../../../src/changes/change-event'
import type { SaveEffect } from '../../../src/changes/save-effects'
import { createApiCommit, type CommitContext } from '../../../src/editor/commit'
import type { EditorStatusActions } from '../../../src/editor/useEditorStatus'
import { stubFetch, type StubbedFetch } from '../../helpers/stub-fetch'

/** Status callbacks that do nothing: these cases are about the request and the result. */
const quietStatus: EditorStatusActions = {
  loadStart: () => {},
  loadSuccess: () => {},
  loadError: () => {},
  saveStart: () => {},
  saveSuccess: () => {},
  saveError: () => {},
  setError: () => {},
}

const solRing: ChangeEvent = {
  id: 'session-1',
  timestamp: 5,
  action: 'add',
  cardName: 'Sol Ring',
  cardId: 3,
}

function commitContext(overrides: Partial<CommitContext> = {}): CommitContext {
  return {
    slug: 'My Deck',
    changes: [solRing],
    contentHash: 'hash-before',
    continueSession: true,
    statusActions: quietStatus,
    ...overrides,
  }
}

describe('createApiCommit', () => {
  let stubbed: StubbedFetch | undefined
  afterEach(() => {
    stubbed?.restore()
    stubbed = undefined
  })

  /** Answer every save POST with `body`. */
  function stubSave(body: unknown): StubbedFetch {
    stubbed = stubFetch({ '/api/': () => Response.json(body) })
    return stubbed
  }

  test('posts only the wire-form changes, hash and session flag to the encoded save path', async () => {
    const fetched = stubSave({ success: true, contentHash: 'hash-after', effects: [] })

    await createApiCommit('deck')(commitContext())

    expect(fetched.sent).toHaveLength(1)
    expect(fetched.sent[0]?.method).toBe('POST')
    expect(fetched.sent[0]?.url).toBe('/api/deck/My%20Deck/save')
    expect(fetched.sent[0]?.body).toEqual({
      changes: [{ action: 'add', cardName: 'Sol Ring', cardId: 3 }],
      contentHash: 'hash-before',
      continueSession: true,
    })
  })

  test("maps a landed save's hash, effects and pruned categories onto the result", async () => {
    const effects: SaveEffect[] = [{ action: 'added', cardId: 7, name: 'Sol Ring', quantity: 1 }]
    stubSave({
      success: true,
      contentHash: 'hash-after',
      effects,
      prunedCategories: ['Ramp'],
      droppedNotes: [],
    })

    expect(await createApiCommit('collection')(commitContext())).toEqual({
      contentHash: 'hash-after',
      effects,
      prunedCategories: ['Ramp'],
    })
  })

  test('a response without a contentHash is no landed commit', async () => {
    stubSave({ success: false, message: 'Nothing was saved.' })

    expect(await createApiCommit('wanted')(commitContext())).toBeUndefined()
  })
})
