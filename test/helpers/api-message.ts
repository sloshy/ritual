/**
 * Asserting on the refusals a request parser returns (`T | ApiMessage`,
 * `src/api/result.ts`): the English a client reads, and the promise that it is
 * exactly what the key and params re-render to.
 */

import { isApiMessage } from '../../src/api/result'
import { DEFAULT_LOCALE } from '../../src/i18n/runtime'
import { isMessageKey, type MessageTriple } from '../../src/i18n/t'
import { renderSyncParam, type SyncMessageParams } from '../../src/sync/message'

/**
 * A parser's refusal as its English `message`, or the parsed value itself when
 * the parser accepted the input — so `expect(refusal(parse(x))).toBe('…')` fails
 * with the value it got rather than with an opaque shape mismatch.
 */
export function refusal(parsed: unknown): unknown {
  return isApiMessage(parsed) ? parsed.message : parsed
}

/**
 * The refusal's English, after asserting it is keyed and that its `message` is
 * what its key and params render to in English — the agreement a client's
 * re-render in the reader's language depends on.
 */
export function keyedRefusal(parsed: unknown): string {
  if (!isApiMessage(parsed)) throw new Error(`expected a refusal, got ${JSON.stringify(parsed)}`)
  return keyedMessage(parsed)
}

/**
 * A message triple's English, after asserting it is keyed and that `message` is
 * exactly what its key and (possibly nested) params render to in English.
 *
 * Rendered through `renderSyncParam`, which has **no** English fallback: a key
 * anywhere in the tree the catalog does not know renders raw and fails the
 * comparison, where `renderSyncMessage` would quietly hand `message` back.
 */
export function keyedMessage(triple: MessageTriple<SyncMessageParams>): string {
  if (!isMessageKey(triple.messageKey)) {
    throw new Error(`expected a message with a known key, got ${JSON.stringify(triple)}`)
  }
  const rendered = renderSyncParam(
    triple.messageParams === undefined
      ? { messageKey: triple.messageKey }
      : { messageKey: triple.messageKey, messageParams: triple.messageParams },
    DEFAULT_LOCALE,
  )
  if (rendered !== triple.message) {
    throw new Error(`message "${triple.message}" disagrees with its key: "${rendered}"`)
  }
  return triple.message
}
