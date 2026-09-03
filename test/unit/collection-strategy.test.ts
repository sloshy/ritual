import { describe, expect, test } from 'bun:test'
import prompts from 'prompts'
import { createCollectionStrategy } from '../../src/commands/session/collection-strategy'
import {
  newCollectionSession,
  type CollectionSession,
} from '../../src/commands/session/flat-list-session'
import { buildInitialSessionConfig, type SessionConfig } from '../../src/commands/session/config'
import type { CardSessionContext } from '../../src/commands/session/strategy'
import { currentSessionArt } from '../../src/commands/session/art'
import { makeScryfallCard, scratchListPath, stubTty } from '../test-utils'
import type { CardLanguage } from '../../src/card/card-language'

// The Set Custom Art prompts go through `ask`, which refuses to open without a
// terminal; these tests answer them with prompts.inject instead.
stubTty({ stdin: true })

function makeSessionConfig(): SessionConfig {
  return buildInitialSessionConfig({}, undefined)
}

/** A quiet session with a known front-matter state and a clean dirty flag. */
function makeSession(raw?: string, data?: Record<string, unknown>): CollectionSession {
  const session = newCollectionSession(scratchListPath('binder.md'), 'Binder')
  if (raw !== undefined) session.frontMatter = { raw, data: data ?? {} }
  session.dirty = false
  return session
}

function makeStrategy(session: CollectionSession) {
  return createCollectionStrategy(session, makeSessionConfig(), 'Binder', true)
}

describe('collection strategy — Edit List Labels', () => {
  test('the menu item shows the current default (or none)', () => {
    const bare = makeStrategy(makeSession())
    expect(bare.extraMenuItems?.()[0]?.title).toContain('Edit List Labels (default: none)')

    const labeled = makeStrategy(
      makeSession('---\nlabels: [sale, trade]\n---\n', { labels: ['sale', 'trade'] }),
    )
    expect(labeled.extraMenuItems?.()[0]?.title).toContain('(default: sale,trade)')
  })

  test('picking a default rebuilds the block in memory and dirties the session', async () => {
    const session = makeSession()
    const strategy = makeStrategy(session)
    prompts.inject(['sale,trade'])
    await strategy.handleSentinel?.({} as never, '__LIST_LABELS__')

    expect(session.frontMatter?.data).toEqual({ labels: ['sale', 'trade'] })
    expect(session.frontMatter?.raw).toContain('labels:')
    expect(session.frontMatter?.raw.endsWith('---\n')).toBeTrue()
    expect(session.dirty).toBeTrue()
  })

  test('clearing the default removes an otherwise-empty block, keeps other keys', async () => {
    const emptyAfter = makeSession('---\nlabels: [keep]\n---\n', { labels: ['keep'] })
    prompts.inject([''])
    await makeStrategy(emptyAfter).handleSentinel?.({} as never, '__LIST_LABELS__')
    expect(emptyAfter.frontMatter).toBeUndefined()
    expect(emptyAfter.dirty).toBeTrue()

    const withOwner = makeSession('---\nowner: me\nlabels: [keep]\n---\n', {
      owner: 'me',
      labels: ['keep'],
    })
    prompts.inject([''])
    await makeStrategy(withOwner).handleSentinel?.({} as never, '__LIST_LABELS__')
    expect(withOwner.frontMatter?.data).toEqual({ owner: 'me' })
    expect(withOwner.frontMatter?.raw).toContain('owner: me')
  })

  test('cancelling or re-picking the current state changes nothing', async () => {
    const session = makeSession('---\nlabels: [keep]\n---\n', { labels: ['keep'] })
    const before = session.frontMatter
    prompts.inject([new Error('cancelled')])
    await makeStrategy(session).handleSentinel?.({} as never, '__LIST_LABELS__')
    expect(session.frontMatter).toBe(before)
    expect(session.dirty).toBeFalse()

    prompts.inject(['keep'])
    await makeStrategy(session).handleSentinel?.({} as never, '__LIST_LABELS__')
    expect(session.frontMatter).toBe(before)
    expect(session.dirty).toBeFalse()
  })

  test('an unreadable block refuses the edit rather than clobbering it', async () => {
    const raw = '---\nlabels: [sale\n---\n'
    const session = makeSession(raw, {})
    // A queued answer proves the refusal: were the guard absent, the picker
    // would consume it and rebuild the block.
    prompts.inject(['keep'])
    await makeStrategy(session).handleSentinel?.({} as never, '__LIST_LABELS__')
    expect(session.frontMatter?.raw).toBe(raw)
    expect(session.dirty).toBeFalse()
    // Drain the queue: the answer must still be there (the picker never ran),
    // and a leftover would bleed into whichever test prompts next.
    const drained = (await prompts({ type: 'text', name: 'value', message: 'drain' })) as {
      value?: string
    }
    expect(drained.value).toBe('keep')
  })

  test('an invalid stored value reads as none but can still be cleared (repaired)', async () => {
    // `labels: sale` (a scalar) parses to an advisory; the picker shows
    // "No default" as current, and re-picking it must still rewrite the block —
    // that is how the TUI repairs the value.
    const session = makeSession('---\nlabels: sale\n---\n', { labels: 'sale' })
    prompts.inject([''])
    await makeStrategy(session).handleSentinel?.({} as never, '__LIST_LABELS__')
    expect(session.frontMatter).toBeUndefined()
    expect(session.dirty).toBeTrue()
  })

  test('the edited block survives the session serializer round-trip', async () => {
    const session = makeSession()
    prompts.inject(['keep'])
    await makeStrategy(session).handleSentinel?.({} as never, '__LIST_LABELS__')

    // What a session save writes: the serializer's output with the session's
    // front matter — the dumpFrontMatterBlock ↔ withFrontMatter seam.
    const content = session.serialize('Binder', session.entries, [], session.frontMatter)
    expect(content.startsWith('---\nlabels:\n  - keep\n---\n\n# Binder')).toBeTrue()
  })
})

/** A fresh session context; the strategies mutate it in place. */
function makeCtx(): CardSessionContext {
  return {
    sessionChanges: [],
    lastChangeIndex: null,
    lastAdded: null,
    lastAddedCount: 0,
    hasSavedChangelog: false,
  }
}

describe('collection strategy — the session card language', () => {
  const printing = makeScryfallCard({ name: 'Sol Ring', set: 'c21', collector_number: '263' })

  /** A session config with the option prompts pinned, so an add asks nothing. */
  function quietConfig(language: CardLanguage): SessionConfig {
    const config = buildInitialSessionConfig({ finish: 'nonfoil', condition: 'NM' }, undefined)
    config.language = language
    return config
  }

  async function addUnder(language: CardLanguage): Promise<CollectionSession> {
    const session = makeSession()
    const strategy = createCollectionStrategy(session, quietConfig(language), 'Binder', true)
    await strategy.handleCard(makeCtx(), {
      cardName: 'Sol Ring',
      preselected: printing,
      forcePrompts: false,
      intent: 'add',
    })
    return session
  }

  test('a card added under a non-English session language carries that language', async () => {
    // The wiring the `🌐 Card Language` menu row exists for: the session value
    // reaches `resolveAddedLanguage`, not just the configured default.
    const session = await addUnder('ja')
    expect(session.entries[0]?.language).toBe('ja')
  })

  test('an English session language writes a bare line — no token means en', async () => {
    const session = await addUnder('en')
    // The in-memory entry keeps the resolved 'en' (see Change Language below);
    // what matters is that the serialized line carries no token.
    const written = session.serialize('Binder', session.entries, [], session.frontMatter)
    expect(written).toContain('- Sol Ring (C21:263) &1')
    expect(written).not.toContain('[en]')
  })
})

describe('collection strategy — Change Language', () => {
  function sessionWithEntry(language?: CardLanguage): CollectionSession {
    const session = makeSession()
    session.entries = [
      {
        name: 'Sol Ring',
        set: 'c21',
        collectorNumber: '240',
        finish: 'nonfoil',
        condition: 'NM',
        language,
        price: 0,
        fileOrder: 0,
        section: 'Main',
        cardId: 1,
      },
    ]
    return session
  }

  test('the edit menu applies a set-language change, undoable back to the original', async () => {
    const session = sessionWithEntry()
    const strategy = makeStrategy(session)
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
    expect(strategy.lastEditUndoLabel()).toBe('language on Sol Ring')

    await strategy.undoLastEdit(ctx)
    // The inverse is set-language en, and the collection entry model keeps the
    // resolved value: `CollectionCardEntry.language` documents 'en' as
    // equivalent to absent and safe to re-serialize (the line stays bare).
    expect(session.entries[0]!.language).toBe('en')
    expect(ctx.sessionChanges).toHaveLength(0)
    expect(strategy.lastEditUndoLabel()).toBeNull()
  })

  test('re-picking the current language is a no-op', async () => {
    const session = sessionWithEntry('ja')
    const strategy = makeStrategy(session)
    const ctx = makeCtx()

    prompts.inject(['language', 'ja'])
    await strategy.editEntry(ctx, 1)

    expect(session.entries[0]!.language).toBe('ja')
    expect(ctx.sessionChanges).toHaveLength(0)
    expect(strategy.lastEditUndoLabel()).toBeNull()
  })

  test('changing a [ja] entry back to English clears the token from the rendered line', async () => {
    const session = sessionWithEntry('ja')
    const strategy = makeStrategy(session)
    const ctx = makeCtx()

    prompts.inject(['language', 'en'])
    await strategy.editEntry(ctx, 1)

    expect(ctx.sessionChanges[0]).toMatchObject({ action: 'set-language', language: 'en' })
    const line = session.serialize('Binder', session.entries, ['Main'], undefined)
    expect(line).toContain('- Sol Ring (C21:240) &1')
    expect(line).not.toContain('[ja]')
  })
})

describe('collection strategy — Edit Tags', () => {
  test('the edit menu tags the entry and the rendered line shows the tokens', async () => {
    const session = makeSession()
    session.entries = [
      {
        name: 'Sol Ring',
        set: 'c21',
        collectorNumber: '240',
        finish: 'nonfoil',
        condition: 'NM',
        price: 0,
        fileOrder: 0,
        section: 'Main',
        cardId: 1,
      },
    ]
    const strategy = makeStrategy(session)
    const ctx = makeCtx()

    prompts.inject(['tags', 'ramp'])
    await strategy.editEntry(ctx, 1)

    expect(session.entries[0]!.tags).toEqual(['ramp'])
    expect(ctx.sessionChanges).toHaveLength(1)
    expect(ctx.sessionChanges[0]).toMatchObject({ action: 'add-tag', tag: 'ramp', cardId: 1 })
    expect(strategy.lastEditUndoLabel()).toBe('tags on Sol Ring')
    expect(strategy.listEntries()[0]!.label).toBe('- Sol Ring (C21:240) #ramp &1')
  })
})

describe('collection strategy — Set Custom Art', () => {
  function makeCtx(): CardSessionContext {
    return {
      sessionChanges: [],
      lastChangeIndex: null,
      lastAdded: null,
      lastAddedCount: 0,
      hasSavedChangelog: false,
    }
  }

  /** A session holding one entry, with its `.art.json` absent (nothing to read). */
  function sessionWithEntry(): CollectionSession {
    const session = makeSession()
    session.entries = [
      {
        name: 'Sol Ring',
        set: 'c21',
        collectorNumber: '240',
        finish: 'nonfoil',
        condition: 'NM',
        price: 0,
        fileOrder: 0,
        section: 'Main',
        cardId: 1,
      },
    ]
    session.dirty = false
    return session
  }

  test('a URL is staged for the save, not written, and is undoable', async () => {
    const session = sessionWithEntry()
    const strategy = makeStrategy(session)
    const ctx = makeCtx()

    prompts.inject(['art', 'url', 'https://example.com/sol.png'])
    await strategy.editEntry(ctx, 1)

    expect(session.art.edited.get(1)).toEqual({ url: 'https://example.com/sol.png' })
    // Art carries no change event — only the dirty flag gives the save its cue.
    expect(ctx.sessionChanges).toHaveLength(0)
    expect(strategy.hasUnsavedChanges()).toBeTrue()
    expect(strategy.lastEditUndoLabel()).toBe('custom art on Sol Ring')

    await strategy.undoLastEdit(ctx)
    expect(await currentSessionArt(session.filePath, session.art, 1)).toEqual({
      ok: true,
      ref: null,
    })
    expect(strategy.lastEditUndoLabel()).toBeNull()
  })

  test('clearing art the session set restores the card to no art', async () => {
    const session = sessionWithEntry()
    const strategy = makeStrategy(session)
    const ctx = makeCtx()

    prompts.inject(['art', 'url', 'https://example.com/sol.png'])
    await strategy.editEntry(ctx, 1)
    prompts.inject(['art', 'clear'])
    await strategy.editEntry(ctx, 1)

    expect(session.art.edited.get(1)).toBeNull()
    expect(strategy.lastEditUndoLabel()).toBe('custom art on Sol Ring')
  })

  test('a refused URL and a cancelled prompt both leave the session alone', async () => {
    const session = sessionWithEntry()
    const strategy = makeStrategy(session)
    const ctx = makeCtx()

    prompts.inject(['art', 'url', 'ftp://example.com/sol.png'])
    await strategy.editEntry(ctx, 1)
    expect(session.art.edited.size).toBe(0)
    expect(strategy.hasUnsavedChanges()).toBeFalse()

    prompts.inject(['art', new Error('cancelled')])
    await strategy.editEntry(ctx, 1)
    expect(session.art.edited.size).toBe(0)
    expect(strategy.hasUnsavedChanges()).toBeFalse()
    expect(strategy.lastEditUndoLabel()).toBeNull()
  })
})
