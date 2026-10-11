import { afterEach, describe, expect, test } from 'bun:test'
import type { ApiMessage } from '../../../src/api/result'
import type { MessageKey } from '../../../src/i18n/messages/en'
import { resetI18nRuntime } from '../../../src/i18n/runtime'
import { dryRunReason } from '../../../src/sync/common'
import {
  errorParam,
  isSyncMessage,
  joinSyncMessages,
  reasonFields,
  reasonMessage,
  renderSyncMessage,
  renderSyncParam,
  syncElapsed,
  syncLanguage,
  syncList,
  syncMessage,
  SyncMessageError,
  syncRef,
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

  test('the English half is the catalog English whatever the active locale', () => {
    const message = withSyntheticLocale('xx', { 'domain.sync.reasonNoChanges': 'xx-same' }, () =>
      syncMessage('domain.sync.reasonNoChanges'),
    )
    expect(message.message).toBe('no changes')
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
