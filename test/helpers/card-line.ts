/**
 * The keyed tree a card-line diagnostic reaches the wire as, for the one
 * diagnostic the wire tests share: a misspelled language token (`[jp]`),
 * refused with a `did you mean [ja]?` hint.
 */

import type { SyncMessageRef } from '../../src/sync/message'

/** `Unrecognized token [jp].` with its `did you mean [ja]?` hint nested beside it. */
export function jpDiagnostic(): SyncMessageRef {
  return {
    messageKey: 'domain.card.line.withHint',
    messageParams: {
      text: { messageKey: 'domain.card.line.unknownToken', messageParams: { token: '[jp]' } },
      hint: { messageKey: 'domain.card.line.hint.didYouMean', messageParams: { language: 'ja' } },
    },
  }
}

/** {@link jpDiagnostic} located at a pasted text's 1-based `line` (`line N: …`). */
export function jpDiagnosticAt(line: number): SyncMessageRef {
  return { messageKey: 'domain.card.line.atLine', messageParams: { line, text: jpDiagnostic() } }
}

/** The English of {@link jpDiagnosticAt}. */
export function jpDiagnosticEnglish(line: number): string {
  return `line ${line}: Unrecognized token [jp]. (did you mean [ja]?)`
}
