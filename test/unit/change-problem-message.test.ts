import { describe, expect, test } from 'bun:test'
import {
  CHANGE_PROBLEM_CODES,
  documentProblem,
  locatedProblem,
  type ChangeProblem,
  type ChangeProblemCode,
  type ChangeProblemSite,
  type UnknownValueField,
} from '../../src/changes/change-problem'
import {
  changeProblemMessage,
  changeProblemRef,
  renderChangeProblem,
} from '../../src/changes/change-problem-message'
import { handleImportChanges } from '../../src/admin/api/import-changes'
import { handleListSave } from '../../src/admin/api/list-save'
import { handleHistorySave } from '../../src/admin/api/history'
import { en } from '../../src/i18n/messages/en'
import { compareData } from '../../src/i18n/collate'
import { DEFAULT_LOCALE } from '../../src/i18n/runtime'
import type { LocaleCatalog } from '../../src/i18n/types'
import { readSyncMessage, renderSyncMessage, type SyncMessage } from '../../src/sync/message'
import { keyedMessage } from '../helpers/api-message'
import { MALFORMED_MOVE_BUNDLE, MALFORMED_MOVE_ENGLISH, MOVE_1 } from '../helpers/change-problem'
import {
  expectLocaleInForce,
  pseudoCatalog,
  withSyntheticLocale,
  withSyntheticLocaleAsync,
} from '../helpers/sync-text'
import { decodeChangeEvent } from '../../src/changes/change-event-decode'

/**
 * The persistence fence's refusals are structured codes; this module is where
 * they become words. Pinned here: every code has a key and renders completely,
 * the English is the bytes the validators used to write, and a reader in
 * another language gets the whole sentence — the record it is about included —
 * in that language while the API keeps English plus the key. The last block
 * pins the wiring: each admin route that decodes change JSON (import-changes,
 * a list save, a history rewrite) answers its refusal through this module,
 * keyed and English, with the server process in another language.
 */

const BUNDLE_CHANGE: ChangeProblemSite = { subject: { kind: 'bundle-change', list: 2, change: 3 } }

/** A problem and the English it renders to. */
type Sample = [problem: ChangeProblem, english: string]

const TAGS_DETAIL = '"tags" must be an array of tags.'

/** The tag rule's own refusal as the decoder nests it: keyed, unrendered. */
const TAGS_DETAIL_REF = {
  messageKey: 'domain.card.tag.notArray',
  messageParams: { field: '"tags"' },
} as const

/**
 * One problem per code, with its full English — a missing row is a compile
 * error, so no code goes unrendered or unpinned. Every string is the bytes the
 * validator wrote before its refusals became codes, but for `field-rejected`'s
 * colon (a deliberate grammar fix).
 */
const SAMPLES: Record<ChangeProblemCode, Sample> = {
  'json-invalid': [documentProblem('json-invalid'), 'Not valid JSON.'],
  'json-not-object': [documentProblem('json-not-object'), 'Expected a JSON object.'],
  'bundle-format-missing': [
    documentProblem('bundle-format-missing', { format: 'ritual-change-bundle' }),
    'Not a ritual change bundle (missing "format": "ritual-change-bundle").',
  ],
  'bundle-version-unsupported': [
    documentProblem('bundle-version-unsupported', { version: '2' }),
    'Unsupported change-bundle version: 2.',
  ],
  'bundle-field-invalid': [
    documentProblem('bundle-field-invalid', { field: 'exportedAt' }),
    'Missing or invalid "exportedAt".',
  ],
  'bundle-array-invalid': [
    documentProblem('bundle-array-invalid', { field: 'moves' }),
    'Missing or invalid "moves" array.',
  ],
  'bundle-line-break': [
    documentProblem('bundle-line-break', { path: 'moves[0].cardName' }),
    'A line break in "moves[0].cardName".',
  ],
  'bundle-list-not-object': [
    documentProblem('bundle-list-not-object', { list: 2 }),
    'List #2 is not an object.',
  ],
  'bundle-list-kind-invalid': [
    documentProblem('bundle-list-kind-invalid', { list: 2, kind: 'binder' }),
    'List #2: Invalid list kind: binder (expected deck, collection, or wanted).',
  ],
  'bundle-list-field-invalid': [
    documentProblem('bundle-list-field-invalid', { list: 2, field: 'slug' }),
    'List #2: Missing or invalid "slug".',
  ],
  'bundle-list-array-invalid': [
    documentProblem('bundle-list-array-invalid', { list: 2, field: 'changes' }),
    'List #2: Missing or invalid "changes" array.',
  ],
  'bundle-list-field-malformed': [
    documentProblem('bundle-list-field-malformed', { list: 2, field: 'baseContentHash' }),
    'List #2: Invalid "baseContentHash".',
  ],
  'save-changes-not-array': [
    documentProblem('save-changes-not-array'),
    '"changes" must be an array.',
  ],
  'save-too-many': [
    documentProblem('save-too-many', { count: 2000, received: 2001 }),
    'A save may carry at most 2000 changes (got 2001). Save in smaller batches.',
  ],
  'not-object': [
    locatedProblem('not-object', { ...MOVE_1, part: 'from' }),
    'Move #1 "from" is not an object.',
  ],
  'action-unknown': [
    locatedProblem('action-unknown', BUNDLE_CHANGE, { action: 'frob' }),
    'List #2: Change #3 has an unknown action: frob.',
  ],
  'field-missing': [
    locatedProblem('field-missing', MOVE_1, { field: 'id' }),
    'Move #1 is missing its "id".',
  ],
  'field-invalid': [
    locatedProblem('field-invalid', BUNDLE_CHANGE, { field: 'set' }),
    'List #2: Change #3 has an invalid "set".',
  ],
  'line-break': [
    locatedProblem('line-break', BUNDLE_CHANGE, { path: 'change.cardName' }),
    'List #2: Change #3 has a line break in "change.cardName".',
  ],
  'action-field-missing': [
    locatedProblem('action-field-missing', BUNDLE_CHANGE, { action: 'add-tag', field: 'tag' }),
    'List #2: Change #3 (add-tag) is missing its "tag".',
  ],
  'category-card-id': [
    locatedProblem('category-card-id', BUNDLE_CHANGE, { action: 'set-categories' }),
    'List #2: Change #3 (set-categories) is keyed by card name and must not carry a "cardId".',
  ],
  'list-action-card-name': [
    locatedProblem('list-action-card-name', BUNDLE_CHANGE, { action: 'rename-category' }),
    'List #2: Change #3 (rename-category) targets the list, not a card, and must not carry a "cardName".',
  ],
  'printing-half': [
    locatedProblem('printing-half', MOVE_1),
    'Move #1 names half a printing; "set" and "collectorNumber" must both be present or both absent.',
  ],
  'value-unknown': [
    locatedProblem(
      'value-unknown',
      { subject: { kind: 'save-change', index: 0 } },
      { field: 'language', value: '"xx"' },
    ),
    'changes[0] has an unknown language: "xx".',
  ],
  'list-type-invalid': [
    locatedProblem('list-type-invalid', { ...BUNDLE_CHANGE, part: 'to' }, { value: 'binder' }),
    'List #2: Change #3 "to" has an invalid list type: binder (expected deck, collection, or wanted).',
  ],
  'list-kind-invalid': [
    locatedProblem('list-kind-invalid', { ...MOVE_1, part: 'to' }, { value: 'binder' }),
    'Move #1 "to" has an invalid list kind: binder (expected deck, collection, or wanted).',
  ],
  'replacement-condition': [
    locatedProblem('replacement-condition', { ...MOVE_1, part: 'replacement' }),
    'Move #1 "replacement" must not name a "condition" (a replacement carries no grade).',
  ],
  'replacement-printing-missing': [
    locatedProblem('replacement-printing-missing', { ...MOVE_1, part: 'replacement' }),
    'Move #1 "replacement" must name a printing ("set" and "collectorNumber").',
  ],
  'replacement-unpinned': [
    locatedProblem('replacement-unpinned', BUNDLE_CHANGE),
    'List #2: Change #3 carries a "replacement" but pins no line ("replacesCardId").',
  ],
  'move-in-changes': [
    locatedProblem('move-in-changes', BUNDLE_CHANGE, { action: 'move-from' }),
    'List #2: Change #3 is a move-from; moves belong in the top-level "moves" array.',
  ],
  'move-same-list': [
    locatedProblem('move-same-list', MOVE_1),
    'Move #1 names the same list as source and destination.',
  ],
  'move-pin-without-target': [
    locatedProblem('move-pin-without-target', MOVE_1),
    'Move #1 has a "pinsCardId" but no "toCardId"; a pinning move must name the line the copy lands on.',
  ],
  'move-replacement-unpinned': [
    locatedProblem('move-replacement-unpinned', MOVE_1),
    'Move #1 has a "replacement" but no "pinsCardId"; only a pinning move carries one.',
  ],
  'field-rejected': [
    locatedProblem('field-rejected', MOVE_1, { detail: TAGS_DETAIL_REF }),
    `Move #1: ${TAGS_DETAIL}`,
  ],
}

/** A code's sample problem. */
const sample = (code: ChangeProblemCode): ChangeProblem => SAMPLES[code][0]

describe('change problem wording', () => {
  // Rendered through `keyedMessage`, which also proves the key and its
  // (nested) params render to exactly this English.
  test.each([...CHANGE_PROBLEM_CODES])('%s keeps its English, from its key', (code) => {
    const [problem, english] = SAMPLES[code]
    expect(keyedMessage(changeProblemMessage(problem))).toBe(english)
  })

  // A select branch the catalog lacks would render the raw key in production.
  test.each<[UnknownValueField, string]>([
    ['language', 'changes[0] has an unknown language: "xx".'],
    ['finish', 'changes[0] has an unknown finish: "xx".'],
    ['condition', 'changes[0] has an unknown condition: "xx".'],
    ['board', 'changes[0] has an unknown board: "xx".'],
  ])('value-unknown words its %s branch', (field, english) => {
    const problem = locatedProblem(
      'value-unknown',
      { subject: { kind: 'save-change', index: 0 } },
      { field, value: '"xx"' },
    )
    expect(keyedMessage(changeProblemMessage(problem))).toBe(english)
  })

  test('a save limit of one counts in the singular', () => {
    const problem = documentProblem('save-too-many', { count: 1, received: 2 })
    expect(keyedMessage(changeProblemMessage(problem))).toBe(
      'A save may carry at most 1 change (got 2). Save in smaller batches.',
    )
  })

  test('every problem and subject key in the catalog is reached', () => {
    const subjects: ChangeProblemSite[] = [
      { subject: { kind: 'change' } },
      { subject: { kind: 'bundle-change', list: 1, change: 1 } },
      { subject: { kind: 'bundle-move', move: 1 } },
      { subject: { kind: 'save-change', index: 0 } },
      { subject: { kind: 'history-event', set: 1, event: 1 }, part: 'from' },
    ]
    const keys = (value: unknown): string[] => {
      if (typeof value !== 'object' || value === null) return []
      const own =
        'messageKey' in value && typeof value.messageKey === 'string' ? [value.messageKey] : []
      return [...own, ...Object.values(value).flatMap(keys)]
    }
    // Only this module's own keys count: a nested rule's refusal is the card
    // vocabulary's (`domain.card.*`), pinned where it is worded.
    const reached = new Set(
      [
        ...CHANGE_PROBLEM_CODES.flatMap((code) => keys(changeProblemRef(sample(code)))),
        ...subjects.flatMap((site) =>
          keys(changeProblemRef(locatedProblem('printing-half', site))),
        ),
      ].filter((key) => key.startsWith('domain.changes.')),
    )
    const catalog = Object.keys(en).filter(
      (key) =>
        key.startsWith('domain.changes.problem.') || key.startsWith('domain.changes.subject.'),
    )
    expect(catalog.length).toBeGreaterThan(0)
    expect([...reached].sort(compareData)).toEqual(catalog.sort(compareData))
  })

  test('a history event names its set and event', () => {
    const problem = locatedProblem(
      'field-missing',
      { subject: { kind: 'history-event', set: 1, event: 2 } },
      { field: 'id' },
    )
    expect(keyedMessage(changeProblemMessage(problem))).toBe('Set #1 event #2 is missing its "id".')
  })
})

/** A reader's language: the sentence and the two records it nests, all reworded. */
const SYNTHETIC: LocaleCatalog = {
  'domain.changes.problem.notObject': '{subject} ist kein Objekt.',
  'domain.changes.problem.fieldInvalid': '{subject} hat ein ungültiges „{field}“.',
  'domain.changes.problem.fieldMissing': '{subject} fehlt „{field}“.',
  'domain.changes.subject.bundleMove': 'Zug Nr. {move}',
  'domain.changes.subject.saveChange': 'Änderung {index}',
  'domain.changes.subject.part': '{subject} „{part}“',
  'domain.changes.subject.historyEvent': 'Satz {set}, Ereignis {event}',
  'domain.changes.problem.bundleListNotObject': 'Liste Nr. {list} ist kein Objekt.',
}

describe('a rule’s refusal nests in field-rejected', () => {
  test('the decoder nests the tag rule’s keyed refusal, rendered whole in the reader’s language', () => {
    const decoded = decodeChangeEvent(
      { id: 'a1', timestamp: 1, action: 'add', cardName: 'Sol Ring', tags: 'ramp' },
      { kind: 'save-change', index: 0 },
    )
    if (decoded.ok) throw new Error('expected a refusal')
    expect(decoded.problem).toMatchObject({
      code: 'field-rejected',
      params: {
        detail: { messageKey: 'domain.card.tag.notArray', messageParams: { field: 'tags' } },
      },
    })
    const message = changeProblemMessage(decoded.problem)
    expect(keyedMessage(message)).toBe('changes[0]: tags must be an array of tags.')
    withSyntheticLocale('en-XA', pseudoCatalog(), (locale) => {
      expectLocaleInForce(locale)
      const rendered = renderSyncMessage(message)
      expect(rendered).not.toContain('must be an array of tags')
      expect(rendered).toContain('tags')
      expectLocaleInForce(locale)
    })
  })
})

describe('change problems in the reader’s language', () => {
  test('the CLI and the SPAs word the whole sentence, nested record included', () => {
    const problem = sample('not-object')
    const english = renderChangeProblem(problem, DEFAULT_LOCALE)
    const translated = withSyntheticLocale('xx', SYNTHETIC, () => renderChangeProblem(problem))
    // Vacuity guard: the synthetic locale really is active and really differs.
    expect(translated).not.toBe(english)
    expect(translated).toBe('Zug Nr. 1 „from“ ist kein Objekt.')
  })

  test('the API message stays English while the key carries the sentence', () => {
    const message = withSyntheticLocale('xx', SYNTHETIC, () =>
      changeProblemMessage(sample('not-object')),
    )
    expect(keyedMessage(message)).toBe('Move #1 "from" is not an object.')
    expect(inReaderLanguage(message)).toBe('Zug Nr. 1 „from“ ist kein Objekt.')
  })
})

/** The refusal body a handler answered with, as the message a client reads off it. */
async function refusalOf(response: Response): Promise<SyncMessage> {
  expect(response.status).toBe(400)
  const message = readSyncMessage(await response.json())
  if (message === null) throw new Error('expected a refusal with a message')
  return message
}

/** A message as the reader in {@link SYNTHETIC}'s language sees it. */
function inReaderLanguage(message: SyncMessage): string {
  return withSyntheticLocale('xx', SYNTHETIC, () => renderSyncMessage(message))
}

/** Run a handler with the server process in another language, as an operator's might be. */
function underSyntheticLocale<T>(body: () => Promise<T>): Promise<T> {
  return withSyntheticLocaleAsync('xx', SYNTHETIC, body)
}

describe('the admin routes answer a change problem in English plus its key', () => {
  test('import-changes refuses a malformed bundle', async () => {
    const response = await underSyntheticLocale(() =>
      handleImportChanges(
        new Request('http://localhost/api/import-changes', {
          method: 'POST',
          body: JSON.stringify(MALFORMED_MOVE_BUNDLE),
        }),
      ),
    )
    const message = await refusalOf(response)
    expect(keyedMessage(message)).toBe(MALFORMED_MOVE_ENGLISH)
    expect(inReaderLanguage(message)).toBe('Zug Nr. 1 „from“ ist kein Objekt.')
  })

  test('a list save refuses an undecodable change', async () => {
    const response = await underSyntheticLocale(() =>
      handleListSave(
        new Request('http://localhost/api/deck/burn/save', {
          method: 'POST',
          body: JSON.stringify({
            contentHash: 'x',
            changes: [{ action: 'add', cardName: 'Sol Ring', set: 5 }],
          }),
        }),
        'deck',
      ),
    )
    const message = await refusalOf(response)
    expect(keyedMessage(message)).toBe('changes[0] has an invalid "set".')
    expect(inReaderLanguage(message)).toBe('Änderung 0 hat ein ungültiges „set“.')
  })

  test('a history rewrite refuses an undecodable event', async () => {
    const response = await underSyntheticLocale(() =>
      handleHistorySave(
        new Request('http://localhost/api/history/deck/burn/save', {
          method: 'POST',
          body: JSON.stringify({
            sets: [
              {
                timestamp: '2026-01-01T00:00:00.000Z',
                lines: ['- Added "Sol Ring"'],
                events: [{ id: 'e1', timestamp: 1, action: 'add', cardName: 'Sol Ring', set: 5 }],
              },
            ],
          }),
        }),
      ),
    )
    const message = await refusalOf(response)
    expect(keyedMessage(message)).toBe('Set #1 event #1 has an invalid "set".')
    expect(inReaderLanguage(message)).toBe('Satz 1, Ereignis 1 hat ein ungültiges „set“.')
  })
})
