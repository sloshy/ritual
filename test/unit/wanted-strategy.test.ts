import { describe, expect, test } from 'bun:test'
import prompts from 'prompts'
import { createWantedStrategy } from '../../src/commands/wanted-strategy'
import { newWantedSession, type WantedSession } from '../../src/commands/flat-list-session'
import { buildInitialSessionConfig, type CardSessionContext } from '../../src/commands/card-session'
import type { WantedListSessionConfig } from '../../src/commands/wanted-helpers'
import type { CardLanguage } from '../../src/card/card-language'
import { scratchListPath, stubTty } from '../test-utils'

// The Set Custom Art prompts go through `ask`, which refuses to open without a
// terminal; these tests answer them with prompts.inject instead.
stubTty({ stdin: true })

function makeSessionConfig(): WantedListSessionConfig {
  return buildInitialSessionConfig({}, undefined)
}

function makeCtx(): CardSessionContext {
  return {
    sessionChanges: [],
    lastChangeIndex: null,
    lastAdded: null,
    lastAddedCount: 0,
    hasSavedChangelog: false,
  }
}

/** A session holding one entry — name-only by default, to pin that language edits do not need a printing. */
function sessionWithEntry(
  overrides: { language?: CardLanguage; set?: string } = {},
): WantedSession {
  const session = newWantedSession(scratchListPath('needs.md'), 'Needs')
  session.entries = [
    {
      name: 'Demonic Tutor',
      set: overrides.set,
      collectorNumber: overrides.set ? '90' : undefined,
      language: overrides.language,
      price: 0,
      fileOrder: 0,
      section: 'Main',
      state: overrides.set ? 'printing' : 'name-only',
      cardId: 1,
    },
  ]
  session.dirty = false
  return session
}

describe('wanted strategy — Change Language', () => {
  test('a name-only entry takes a language token, undoable back to bare', async () => {
    const session = sessionWithEntry()
    const strategy = createWantedStrategy(session, makeSessionConfig(), 'Needs', true)
    const ctx = makeCtx()

    prompts.inject(['language', 'ja'])
    await strategy.editEntry(ctx, 1)

    expect(session.entries[0]!.language).toBe('ja')
    expect(ctx.sessionChanges).toHaveLength(1)
    expect(ctx.sessionChanges[0]).toMatchObject({
      action: 'set-language',
      language: 'ja',
      cardId: 1,
    })
    const written = session.serialize('Needs', session.entries, ['Main'], undefined)
    expect(written).toContain('- Demonic Tutor [ja] &1')

    await strategy.undoLastEdit(ctx)
    // The wanted engine clears an explicit en back off the entry.
    expect(session.entries[0]!.language).toBeUndefined()
    expect(ctx.sessionChanges).toHaveLength(0)
  })

  test('setting en on a [ja] printed entry clears the token', async () => {
    const session = sessionWithEntry({ language: 'ja', set: 'sta' })
    const strategy = createWantedStrategy(session, makeSessionConfig(), 'Needs', true)
    const ctx = makeCtx()

    prompts.inject(['language', 'en'])
    await strategy.editEntry(ctx, 1)

    expect(session.entries[0]!.language).toBeUndefined()
    const written = session.serialize('Needs', session.entries, ['Main'], undefined)
    expect(written).toContain('- Demonic Tutor (STA:90) &1')
    expect(written).not.toContain('[ja]')
  })
})

describe('wanted strategy — Set Custom Art', () => {
  test('a wanted entry takes custom art too, staged for the save', async () => {
    const session = sessionWithEntry()
    const strategy = createWantedStrategy(session, makeSessionConfig(), 'Needs', true)
    const ctx = makeCtx()

    prompts.inject(['art', 'url', 'https://example.com/tutor.png'])
    await strategy.editEntry(ctx, 1)

    expect(session.art.edited.get(1)).toEqual({ url: 'https://example.com/tutor.png' })
    expect(ctx.sessionChanges).toHaveLength(0)
    expect(strategy.hasUnsavedChanges()).toBeTrue()
    expect(strategy.lastEditUndoLabel()).toBe('custom art on Demonic Tutor')
  })
})
