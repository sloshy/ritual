import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import path from 'node:path'
import { CardCommandError } from '../../src/errors'
import { resolveTarget } from '../../src/commands/card-target'
import { createWorkspace, removeWorkspace, writeDeckFile } from './helpers/workspace'

/**
 * Direct tests for `resolveTarget` (src/commands/card-target.ts): pure
 * resolution semantics — card-id lookup, the exact-vs-substring fuzzy tiers,
 * and the structured ambiguity error. Lives in test/integration/ because the
 * resolver reads list files from disk (loadEntryRefs); no CLI spawn is
 * involved. The CLI wiring for these paths is pinned once per command in the
 * note/remove-card/set-card suites.
 */

let dir: string
let deckPath: string

beforeEach(async () => {
  dir = await createWorkspace()
  deckPath = await writeDeckFile(dir, 'test', {
    frontMatter: { name: 'Test Deck' },
    cards: [
      // 'Bolt' is an exact match for the search 'Bolt' AND a substring of the
      // two Lightning Bolts — the fixture that separates the fuzzy tiers.
      { quantity: 1, name: 'Bolt', cardId: 1 },
      {
        quantity: 1,
        name: 'Lightning Bolt',
        set: 'lea',
        collectorNumber: '161',
        finish: 'foil',
        condition: 'LP',
        cardId: 2,
      },
      { quantity: 1, name: 'Lightning Bolt', set: '2xm', collectorNumber: '157', cardId: 3 },
      { quantity: 2, name: 'Sol Ring', cardId: 4 },
    ],
  })
})

afterEach(async () => {
  await removeWorkspace(dir)
})

/** Run `resolveTarget` expecting it to throw, and hand back the typed error. */
async function captureError(run: () => Promise<unknown>): Promise<CardCommandError> {
  try {
    await run()
  } catch (error) {
    expect(error).toBeInstanceOf(CardCommandError)
    return error as CardCommandError
  }
  throw new Error('Expected resolveTarget to throw a CardCommandError')
}

describe('resolveTarget (card-target)', () => {
  test('resolves by --card-id', async () => {
    const target = await resolveTarget('deck', deckPath, { cardId: 2, cardName: undefined })
    expect(target.name).toBe('Lightning Bolt')
    expect(target.set).toBe('lea')
    expect(target.cardId).toBe(2)
  })

  test('an unknown --card-id is not_found with exit code 3', async () => {
    const err = await captureError(() =>
      resolveTarget('deck', deckPath, { cardId: 99, cardName: undefined }),
    )
    expect(err.code).toBe('not_found')
    expect(err.exitCode).toBe(3)
    expect(err.message).toContain(`No card with id 99 found in ${path.basename(deckPath)}`)
  })

  test('an exact name match wins over substring matches', async () => {
    // 'Bolt' is a substring of both Lightning Bolts, but the exact tier
    // resolves it uniquely to the card literally named 'Bolt'.
    const target = await resolveTarget('deck', deckPath, { cardId: undefined, cardName: 'Bolt' })
    expect(target.name).toBe('Bolt')
    expect(target.cardId).toBe(1)
  })

  test('falls back to substring matching when nothing matches exactly', async () => {
    const target = await resolveTarget('deck', deckPath, { cardId: undefined, cardName: 'Sol' })
    expect(target.name).toBe('Sol Ring')
    expect(target.cardId).toBe(4)
  })

  test('zero name matches is not_found with exit code 3', async () => {
    const err = await captureError(() =>
      resolveTarget('deck', deckPath, { cardId: undefined, cardName: 'Black Lotus' }),
    )
    expect(err.code).toBe('not_found')
    expect(err.exitCode).toBe(3)
  })

  test('multiple matches is usage_error with exit code 2 and the full matches payload', async () => {
    const err = await captureError(() =>
      resolveTarget('deck', deckPath, { cardId: undefined, cardName: 'Lightning Bolt' }),
    )
    expect(err.code).toBe('usage_error')
    expect(err.exitCode).toBe(2)
    expect(err.message).toContain("Multiple cards match 'Lightning Bolt'")
    expect(err.message).toContain('Pick one with --card-id')
    expect(err.details).toEqual({
      matches: [
        {
          name: 'Lightning Bolt',
          cardId: 2,
          set: 'lea',
          collectorNumber: '161',
          finish: 'foil',
          condition: 'LP',
        },
        {
          name: 'Lightning Bolt',
          cardId: 3,
          set: '2xm',
          collectorNumber: '157',
          finish: undefined,
          condition: undefined,
        },
      ],
    })
  })
})
