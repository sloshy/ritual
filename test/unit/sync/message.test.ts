import { afterEach, describe, expect, test } from 'bun:test'
import type { ApiMessage } from '../../../src/api/result'
import type { MessageKey } from '../../../src/i18n/messages/en'
import { DEFAULT_LOCALE, resetI18nRuntime } from '../../../src/i18n/runtime'
import { dryRunReason } from '../../../src/sync/common'
import { unresolvedPlaceholders } from '../../../src/i18n/t'
import {
  errorParam,
  isRenderable,
  isSyncMessage,
  joinSyncMessages,
  reasonFields,
  reasonMessage,
  renderSyncMessage,
  renderSyncParam,
  syncDuration,
  syncElapsed,
  syncLanguage,
  syncList,
  syncMessage,
  SyncMessageError,
  syncRef,
  syncPrice,
  syncSize,
  syncText,
  toSyncMessage,
  type SyncMessage,
  type SyncMessageRef,
  type SyncParam,
} from '../../../src/sync/message'
import { localizedCommandError } from '../../../src/util/errors'
import { loadSyntheticLocale, withSyntheticLocale } from '../../helpers/sync-text'

/**
 * The sync message model: English for structured readers, plus a key and params
 * whose parts may nest — and render, nested parts included, in one locale.
 */

/** A key no catalog has — what a newer server's report could carry. */
const UNKNOWN_KEY = 'domain.sync.fromTheFuture' as MessageKey

afterEach(() => resetI18nRuntime())

describe('rendering in the reader’s locale', () => {
  test('a nested message renders inside its parent, in the same locale', () => {
    const line = syncMessage('domain.sync.changesLine', {
      summary: syncRef('domain.sync.collectionCounts', { added: 1, removed: 2 }),
    })
    expect(line.message).toBe('Changes: +1 added, -2 removed')
    const rendered = withSyntheticLocale(
      'xx',
      {
        'domain.sync.changesLine': 'XX-CHANGES {summary}',
        'domain.sync.collectionCounts': 'xx-plus {added} xx-minus {removed}',
      },
      () => renderSyncMessage(line),
    )
    expect(rendered).toBe('XX-CHANGES xx-plus 1 xx-minus 2')
    expect(rendered).not.toContain('added')
  })

  test('several reasons join through the locale’s own clause pattern', () => {
    const joined = joinSyncMessages([
      syncMessage('domain.sync.reasonNoChanges'),
      syncMessage('domain.sync.reasonCancelled'),
    ])
    expect(joined.message).toBe('no changes; cancelled before it started')
    const rendered = withSyntheticLocale(
      'xx',
      {
        'domain.sync.clauseJoin': '{first} // {second}',
        'domain.sync.reasonNoChanges': 'xx-same',
        'domain.sync.reasonCancelled': 'xx-stopped',
      },
      () => renderSyncMessage(joined),
    )
    expect(rendered).toBe('xx-same // xx-stopped')
    expect(rendered).not.toContain(';')
  })

  test('past five reasons the rest are counted, not spelled out', () => {
    const reasons = Array.from({ length: 8 }, (_, i) =>
      syncMessage('domain.sync.notDeckOwner', { deckId: String(i + 1) }),
    )
    const [first, ...rest] = reasons
    const joined = joinSyncMessages([first!, ...rest])

    expect(joined.message).toBe(
      'you do not own Archidekt deck 1; you do not own Archidekt deck 2; you do not own Archidekt deck 3; you do not own Archidekt deck 4; you do not own Archidekt deck 5; 3 more',
    )
    expect(joined.messageParams?.reasons as unknown).toEqual({
      list: [
        ...reasons.slice(0, 5).map((reason) => ({
          messageKey: reason.messageKey,
          messageParams: reason.messageParams,
        })),
        { messageKey: 'domain.sync.moreReasons', messageParams: { count: 3 } },
      ],
      join: 'clauses',
    })
  })

  test('a conjunction list, a duration and a language follow the locale', () => {
    const message = syncMessage('domain.sync.ambiguousRemoval', {
      quantity: 2,
      card: 'Sol Ring',
      lists: syncList(
        [
          syncRef('domain.sync.ambiguousListShare', { list: 'A', copies: 1 }),
          syncRef('domain.sync.ambiguousListShare', { list: 'B', copies: 1 }),
          syncRef('domain.sync.ambiguousListShare', { list: 'C', copies: 2 }),
        ],
        'and',
      ),
    })
    const de = loadSyntheticLocale('de', {
      'domain.sync.ambiguousRemoval': 'Nicht entfernt: {quantity} × {card} — in {lists}.',
      'domain.sync.ambiguousListShare': '„{list}“ ({copies})',
    })
    const rendered = renderSyncMessage(message, de)
    expect(rendered).toBe('Nicht entfernt: 2 × Sol Ring — in „A“ (1), „B“ (1) und „C“ (2).')
    expect(rendered).not.toContain(' and ')

    const wait = syncMessage('domain.sync.rateLimitWait', {
      wait: syncElapsed(4200),
      retry: 1,
      maxRetries: 5,
    })
    expect(wait.message).toContain('waiting 4.2 seconds before')
    expect(renderSyncMessage(wait, de)).toContain('4,2 Sekunden')

    const language = syncMessage('domain.sync.languageUnmappable', {
      languageName: syncLanguage('ja'),
      language: 'ja',
      card: 'Sol Ring',
    })
    expect(language.message).toContain('cannot represent Japanese [ja]')
    expect(renderSyncMessage(language, de)).toContain('Japanisch [ja]')
  })

  test('an age or time-out param renders in the locale reading it, not the active one', () => {
    // Built while real German is the UI language: `Intl` resolves `de` for real,
    // so a duration rendered in the active locale would put German in the English half.
    const timedOut = withSyntheticLocale('de', {}, (de) => {
      const message = syncMessage('domain.cache.lockTimedOut', {
        timeout: syncDuration(5 * 60_000),
        holder: syncRef('domain.cache.lockHolderUnknown'),
      })
      return { message, de }
    })
    expect(timedOut.message.message).toContain('Timed out after 5 minutes waiting')
    expect(timedOut.message.message).not.toContain('Minuten')
    expect(renderSyncMessage(timedOut.message, timedOut.de)).toContain('5 Minuten')
  })

  test('a size renders as its mebibyte figure, in the locale reading it', () => {
    // A pair of sizes sharing one unit, as the cache refresh's progress line has it.
    const line = withSyntheticLocale('de', {}, (de) => {
      const message = syncMessage('domain.cache.refresh.processing', {
        percentage: 50,
        received: syncSize(38_010_880),
        total: syncSize(76_021_760),
      })
      return { message, de }
    })
    expect(line.message.message).toBe('Processing: 50% (36.25/72.50 MiB)')
    expect(renderSyncMessage(line.message, line.de)).toBe('Processing: 50% (36,25/72,50 MiB)')
  })

  test.each([
    [0, '0.00'],
    [1, '0.00'],
    [5_242, '0.00'],
    // Exact ties (0.125, 0.375 MiB) round up, as `toFixed` does.
    [131_072, '0.13'],
    [393_216, '0.38'],
    [1_048_576, '1.00'],
    [1_053_818, '1.00'],
    [10_485_761, '10.00'],
    // Past 1000 MiB the figure stays ungrouped, never `1,536.00`.
    [1_610_612_736, '1536.00'],
    [5_000_000_000, '4768.37'],
  ])(
    'the English figure of %i bytes is %s, the one the console always printed',
    (bytes, figure) => {
      // `toFixed(2)` is what the line used to interpolate.
      expect((bytes / 1024 / 1024).toFixed(2)).toBe(figure)
      expect(renderSyncParam(syncSize(bytes), DEFAULT_LOCALE)).toBe(figure)
    },
  )

  test("a price param is a price in the enclosing message's locale", () => {
    const message = syncMessage('site.group.price.atLeast', { low: syncPrice(100, 'eur') })
    expect(message.message).toBe('€100.00+')
    withSyntheticLocale('de', {}, (de) => {
      expect(renderSyncMessage(message, de)).toBe('100,00\u00a0€+')
      expect(renderSyncParam(syncPrice(1.5, 'tix'), de)).toBe('1,50 tix')
    })
  })

  test('a price in a currency this surface does not know falls back to the English sent', () => {
    const received = {
      message: '¥100+',
      messageKey: 'site.group.price.atLeast',
      messageParams: { low: { amount: 100, currency: 'jpy' } },
    } as unknown as SyncMessage
    expect(
      isRenderable({ messageKey: received.messageKey!, messageParams: received.messageParams }),
    ).toBe(false)
    expect(renderSyncMessage(received)).toBe('¥100+')
  })

  test('the English half is the catalog English whatever the active locale', () => {
    const message = withSyntheticLocale('xx', { 'domain.sync.reasonNoChanges': 'xx-same' }, () =>
      syncMessage('domain.sync.reasonNoChanges'),
    )
    expect(message.message).toBe('no changes')
  })
})

describe('a placeholder its params do not fill', () => {
  // As an older server would send it, before `received` was renamed: the
  // template needs a param the message does not carry.
  const stale = {
    message: 'Processing: 50% (36.25/72.50 MiB)',
    messageKey: 'domain.cache.refresh.processing',
    messageParams: { percentage: 50, receivedBytes: syncSize(38_010_880), total: syncSize(1) },
  } as const satisfies SyncMessage

  test('falls the whole message back to the English it carries', () => {
    withSyntheticLocale('de', {}, (de) => {
      expect(renderSyncMessage(stale, de)).toBe(stale.message)
    })
  })

  test('is a strict failure nested too, never a raw token mid-sentence', () => {
    const outer: SyncMessage = {
      message: `Card cache download failed: ${stale.message}`,
      messageKey: 'domain.cache.downloadFailed',
      messageParams: {
        error: { messageKey: stale.messageKey, messageParams: stale.messageParams },
      },
    }
    withSyntheticLocale('xx', { 'domain.cache.downloadFailed': 'KAPUTT: {error}' }, (xx) => {
      expect(renderSyncMessage(outer, xx)).toBe(outer.message)
    })
  })

  test('leaves a bare reference rendering as `t()` does, token visible', () => {
    // No English to fall back on: the non-strict path degrades as it always
    // has. Only outside strict mode, which makes the same gap throw.
    const strict = process.env.RITUAL_I18N_STRICT
    delete process.env.RITUAL_I18N_STRICT
    try {
      expect(
        renderSyncParam(
          { messageKey: stale.messageKey, messageParams: stale.messageParams },
          DEFAULT_LOCALE,
        ),
      ).toBe('Processing: 50% ({received}/0.00 MiB)')
    } finally {
      if (strict !== undefined) process.env.RITUAL_I18N_STRICT = strict
    }
  })
})

describe('a selector naming no branch', () => {
  // A newer process's selector value: `cli.cacheLock.missingField` has a branch
  // per field and no `other`, so `t()` would render the bare key.
  const future = {
    message: 'Invalid cache lock: missing string owner',
    messageKey: 'cli.cacheLock.missingField',
    messageParams: { field: 'owner' },
  } as const satisfies SyncMessage

  test('is reported as the selector going unresolved', () => {
    expect(unresolvedPlaceholders(DEFAULT_LOCALE, future.messageKey, { field: 'owner' })).toEqual([
      'field',
    ])
    expect(unresolvedPlaceholders(DEFAULT_LOCALE, future.messageKey, { field: 'pid' })).toEqual([])
  })

  test('falls the whole message back to the English it carries', () => {
    withSyntheticLocale('de', {}, (de) => {
      expect(renderSyncMessage(future, de)).toBe(future.message)
    })
    expect(
      isRenderable({ messageKey: future.messageKey, messageParams: future.messageParams }),
    ).toBe(false)
  })
})

describe('a selector value that names a prototype member', () => {
  // A hostile or broken sender: the select has no such branch, and must not
  // read the inherited function as one.
  for (const field of ['constructor', 'toString', '__proto__', 'hasOwnProperty', '$select']) {
    test(`'${field}' is unresolved and falls back to the English`, () => {
      const sent = {
        message: `Invalid cache lock: missing ${field}`,
        messageKey: 'cli.cacheLock.missingField',
        messageParams: { field },
      } as const satisfies SyncMessage
      expect(unresolvedPlaceholders(DEFAULT_LOCALE, sent.messageKey, { field })).toEqual(['field'])
      expect(isRenderable({ messageKey: sent.messageKey, messageParams: sent.messageParams })).toBe(
        false,
      )
      expect(renderSyncMessage(sent)).toBe(sent.message)
    })
  }
})

describe('a plural count that is not a number', () => {
  // What a newer (or hostile) process could send: `t()` would pick the `other`
  // form and print "lots peers", or throw in strict mode.
  const sent = {
    message: 'Completed cards.jsonl (lots peers).',
    messageKey: 'cli.cacheFeed.completed',
    messageParams: { file: 'cards.jsonl', count: 'lots' },
  } as const satisfies SyncMessage

  test('is reported as the count going unresolved', () => {
    for (const count of ['lots', Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(unresolvedPlaceholders(DEFAULT_LOCALE, sent.messageKey, { file: 'f', count })).toEqual(
        ['count'],
      )
    }
    expect(unresolvedPlaceholders(DEFAULT_LOCALE, sent.messageKey, { file: 'f' })).toEqual([
      'count',
    ])
    expect(
      unresolvedPlaceholders(DEFAULT_LOCALE, sent.messageKey, { file: 'f', count: 2 }),
    ).toEqual([])
  })

  test('falls the whole message back to the English it carries', () => {
    withSyntheticLocale('de', {}, (de) => {
      expect(renderSyncMessage(sent, de)).toBe(sent.message)
    })
    expect(isRenderable({ messageKey: sent.messageKey, messageParams: sent.messageParams })).toBe(
      false,
    )
  })
})

describe('a key this bundle does not know', () => {
  test('a whole message falls back to the English it carries', () => {
    const message: SyncMessage = { message: 'From the future.', messageKey: UNKNOWN_KEY }
    expect(renderSyncMessage(message)).toBe('From the future.')
  })

  test('an unknown key nested anywhere falls the whole message back, never half-translated', () => {
    const message: SyncMessage = {
      ...syncMessage('domain.sync.changesLine', { summary: 'x' }),
      message: 'Changes: from the future',
      messageParams: { summary: { messageKey: UNKNOWN_KEY } },
    }
    const rendered = withSyntheticLocale(
      'xx',
      { 'domain.sync.changesLine': 'XX-CHANGES {summary}' },
      () => renderSyncMessage(message),
    )
    expect(rendered).toBe('Changes: from the future')
  })
})

describe('reasons on a result', () => {
  const cases: [label: string, message: SyncMessage, rendered: string][] = [
    ['a keyed reason renders from its key', syncMessage('domain.sync.reasonNoChanges'), 'xx-same'],
    ['a reason with no key renders as its English', syncText('disk is full'), 'disk is full'],
    [
      'a keyed reason keeps its params through the round trip',
      syncMessage('domain.sync.notDeckOwner', { deckId: '1' }),
      'xx-not-yours 1',
    ],
  ]
  for (const [label, message, rendered] of cases) {
    test(label, () => {
      const fields = reasonFields(message)
      expect(fields.reason).toBe(message.message)
      const back = reasonMessage(fields)
      expect(back).toEqual(message)
      expect(
        withSyntheticLocale(
          'xx',
          {
            'domain.sync.reasonNoChanges': 'xx-same',
            'domain.sync.notDeckOwner': 'xx-not-yours {deckId}',
          },
          () => renderSyncMessage(back!),
        ),
      ).toBe(rendered)
    })
  }

  test('a result with no reason has none to render', () => {
    expect(reasonMessage({})).toBeUndefined()
  })

  test('a dry run’s reason is the summary behind the prefix', () => {
    expect(dryRunReason('x').message).toBe('dry-run: x')
  })
})

describe('a param of a shape this bundle does not know', () => {
  // A newer server's param kind, as it would arrive off the wire.
  const unknownShape = { percentage: 50 } as unknown as SyncParam
  const message: SyncMessage = {
    ...syncMessage('domain.sync.changesLine', { summary: 'x' }),
    message: 'Changes: something new',
    messageParams: { summary: unknownShape },
  }

  test('sends a whole message back to its English', () => {
    expect(renderSyncMessage(message)).toBe('Changes: something new')
  })

  test('renders as nothing on its own, where there is no English to fall back on', () => {
    expect(renderSyncParam(unknownShape)).toBe('')
    expect(renderSyncParam({ elapsedMs: 'soon' } as unknown as SyncParam)).toBe('')
  })
})

describe('building messages', () => {
  test('one reason joins to itself', () => {
    const only = syncMessage('domain.sync.reasonNoChanges')
    expect(joinSyncMessages([only])).toBe(only)
  })

  test('the English is built field by field, so nothing on the ref can replace it', () => {
    const ref = { messageKey: 'domain.sync.reasonNoChanges', message: 'spoofed' } as SyncMessageRef
    expect(toSyncMessage(ref)).toEqual({
      message: 'no changes',
      messageKey: 'domain.sync.reasonNoChanges',
    })
  })

  test('a caught error keeps its message unrendered when it carries one', () => {
    const listGone = syncMessage('domain.sync.listGone', { list: 'binder' })
    expect(errorParam(new SyncMessageError(listGone))).toEqual({
      messageKey: 'domain.sync.listGone',
      messageParams: { list: 'binder' },
    })
    const command = localizedCommandError('runtime_error', 1, 'domain.sync.listGone', {
      list: 'binder',
    })
    expect(errorParam(command)).toEqual({
      messageKey: 'domain.sync.listGone',
      messageParams: { list: 'binder' },
    })
    expect(errorParam(new Error('disk is full'))).toBe('disk is full')
    expect(errorParam('plain')).toBe('plain')
  })

  test('isSyncMessage tells a message from a result', () => {
    expect(isSyncMessage(syncText('no'))).toBe(true)
    expect(isSyncMessage({ kind: 'upload' })).toBe(false)
    expect(isSyncMessage({ name: 'binder', writtenFiles: [] })).toBe(false)
    expect(isSyncMessage(['binder'])).toBe(false)
  })

  test('isSyncMessage refuses, at compile time, a result that carries its own `message`', () => {
    const impostor = { message: 'x', code: 1 } as { message: string; code: number } | SyncMessage
    // @ts-expect-error — a success type with a `message` would read as a refusal
    expect(isSyncMessage(impostor)).toBe(true)
  })
})

describe('typed params', () => {
  test('a plural count and a select branch are checked against the catalog', () => {
    // Compiles: a number for `count`, a real branch for the selector.
    expect(syncRef('domain.count.cards', { count: 2 })).toEqual({
      messageKey: 'domain.count.cards',
      messageParams: { count: 2 },
    })
    expect(syncRef('domain.sync.planCardMissing', { action: 'remove', card: 'Sol Ring' })).toEqual({
      messageKey: 'domain.sync.planCardMissing',
      messageParams: { action: 'remove', card: 'Sol Ring' },
    })
    expect(syncRef('domain.sync.reasonNoChanges')).toEqual({
      messageKey: 'domain.sync.reasonNoChanges',
    })
    // @ts-expect-error — a plural's count must be a number, not a nested message.
    syncRef('domain.count.cards', { count: syncRef('domain.count.cards', { count: 1 }) })
    // @ts-expect-error — not a branch of the select.
    syncRef('domain.sync.planCardMissing', { action: 'bogus', card: 'Sol Ring' })
    // @ts-expect-error — a missing placeholder.
    syncRef('domain.sync.planCardMissing', { action: 'remove' })
    // @ts-expect-error — a key with placeholders called without its params.
    syncRef('domain.sync.planCardMissing')
    // @ts-expect-error — a params-free key given params.
    syncRef('domain.sync.reasonNoChanges', { extra: 1 })
  })

  test('a sync message with nested params is not an ApiMessage', () => {
    const nested = syncMessage('domain.sync.changesLine', {
      summary: syncRef('domain.sync.collectionCounts', { added: 1, removed: 0 }),
    })
    // @ts-expect-error — nested params would reach renderApiMessage as `[object Object]`.
    const api: ApiMessage = nested
    // What the assignment would have smuggled through: a param that is no flat value.
    expect(typeof api.messageParams?.summary).toBe('object')
  })
})
