/**
 * Wording a {@link ChangeProblem} — the boundary where the persistence fence's
 * structured refusals become text.
 *
 * The validators (`change-bundle.ts`, `change-event-decode.ts`,
 * `wire-changes.ts`) may not import `src/i18n`, so they return a code, its
 * values and the record it is about. Every surface that shows one goes through
 * here:
 *
 * - the admin API and MCP answer with {@link changeProblemMessage} — English
 *   `message` plus the key and (nested) params, a `SyncMessage`;
 * - the CLI renders it in its own UI language with {@link renderChangeProblem};
 * - the SPAs hold the problem (or {@link changeProblemRef}) unrendered and
 *   render it in tracked JSX, so a language switch relabels it.
 *
 * The record a located problem is about ({@link ChangeProblemSite}) is a nested
 * message of its own (`List #2: Change #3`, `Move #1 "from"`), so the sentence
 * around it can place it wherever the reader's language wants its subject.
 *
 * Browser-safe: both SPAs import it.
 */

import type { MessageKey } from '../i18n/messages/en'
import type { LocaleTag } from '../i18n/types'
import {
  renderSyncMessage,
  syncRef,
  toSyncMessage,
  type SyncMessage,
  type ParamTypeDrift,
  type PlaceholderDrift,
  type SyncMessageParams,
  type SyncMessageRef,
} from '../sync/message'
import type {
  ChangeProblem,
  ChangeProblemCode,
  ChangeProblemParams,
  ChangeProblemSite,
  ChangeProblemSubject,
  LocatedProblemCode,
} from './change-problem'

/** The catalog key each problem code is worded with. */
const PROBLEM_KEYS = {
  'json-invalid': 'domain.changes.problem.jsonInvalid',
  'json-not-object': 'domain.changes.problem.jsonNotObject',
  'bundle-format-missing': 'domain.changes.problem.bundleFormatMissing',
  'bundle-version-unsupported': 'domain.changes.problem.bundleVersionUnsupported',
  'bundle-field-invalid': 'domain.changes.problem.bundleFieldInvalid',
  'bundle-array-invalid': 'domain.changes.problem.bundleArrayInvalid',
  'bundle-line-break': 'domain.changes.problem.bundleLineBreak',
  'bundle-list-not-object': 'domain.changes.problem.bundleListNotObject',
  'bundle-list-kind-invalid': 'domain.changes.problem.bundleListKindInvalid',
  'bundle-list-field-invalid': 'domain.changes.problem.bundleListFieldInvalid',
  'bundle-list-array-invalid': 'domain.changes.problem.bundleListArrayInvalid',
  'bundle-list-field-malformed': 'domain.changes.problem.bundleListFieldMalformed',
  'save-changes-not-array': 'domain.changes.problem.saveChangesNotArray',
  'save-too-many': 'domain.changes.problem.saveTooMany',
  'not-object': 'domain.changes.problem.notObject',
  'action-unknown': 'domain.changes.problem.actionUnknown',
  'field-missing': 'domain.changes.problem.fieldMissing',
  'field-invalid': 'domain.changes.problem.fieldInvalid',
  'line-break': 'domain.changes.problem.lineBreak',
  'action-field-missing': 'domain.changes.problem.actionFieldMissing',
  'category-card-id': 'domain.changes.problem.categoryCardId',
  'list-action-card-name': 'domain.changes.problem.listActionCardName',
  'printing-half': 'domain.changes.problem.printingHalf',
  'value-unknown': 'domain.changes.problem.valueUnknown',
  'list-type-invalid': 'domain.changes.problem.listTypeInvalid',
  'list-kind-invalid': 'domain.changes.problem.listKindInvalid',
  'replacement-condition': 'domain.changes.problem.replacementCondition',
  'replacement-printing-missing': 'domain.changes.problem.replacementPrintingMissing',
  'replacement-unpinned': 'domain.changes.problem.replacementUnpinned',
  'move-in-changes': 'domain.changes.problem.moveInChanges',
  'move-same-list': 'domain.changes.problem.moveSameList',
  'move-pin-without-target': 'domain.changes.problem.movePinWithoutTarget',
  'move-replacement-unpinned': 'domain.changes.problem.moveReplacementUnpinned',
  'field-rejected': 'domain.changes.problem.fieldRejected',
} as const satisfies Record<ChangeProblemCode, MessageKey>

/**
 * Compile-time agreement between each code's params and its key's
 * placeholders (plus `{subject}` for a located code): a placeholder renamed in
 * the catalog, or a value added to a code, fails here rather than rendering a
 * literal `{field}`.
 */
type ExpectedParams = {
  [C in ChangeProblemCode]:
    keyof ChangeProblemParams[C] | (C extends LocatedProblemCode ? 'subject' : never)
}
type ParamsDrift = PlaceholderDrift<ChangeProblemCode, typeof PROBLEM_KEYS, ExpectedParams>
const PARAMS_AGREE: [ParamsDrift] extends [never] ? true : ParamsDrift = true
void PARAMS_AGREE

/**
 * And their types: each code's params, with the record nested as `subject`,
 * must be what the key accepts — a select's selector one of its branches (the
 * `value-unknown` fields), a plural's `count` a number — the check `syncRef`
 * makes per call, which `changeProblemRef` (a lookup by code) cannot.
 */
type SubjectParam = { subject: SyncMessageRef }
type GivenParams = {
  [C in ChangeProblemCode]: ChangeProblemParams[C] &
    (C extends LocatedProblemCode ? SubjectParam : unknown)
}
type ParamTypesDrift = ParamTypeDrift<ChangeProblemCode, typeof PROBLEM_KEYS, GivenParams>
const PARAM_TYPES_AGREE: [ParamTypesDrift] extends [never] ? true : ParamTypesDrift = true
void PARAM_TYPES_AGREE

/** The record a problem is about, as a message of its own. */
function subjectRef(subject: ChangeProblemSubject): SyncMessageRef {
  switch (subject.kind) {
    case 'change':
      return syncRef('domain.changes.subject.change')
    case 'bundle-change':
      return syncRef('domain.changes.subject.bundleChange', {
        list: subject.list,
        change: subject.change,
      })
    case 'bundle-move':
      return syncRef('domain.changes.subject.bundleMove', { move: subject.move })
    case 'save-change':
      return syncRef('domain.changes.subject.saveChange', { index: subject.index })
    case 'history-event':
      return syncRef('domain.changes.subject.historyEvent', {
        set: subject.set,
        event: subject.event,
      })
  }
}

function siteRef(site: ChangeProblemSite): SyncMessageRef {
  const subject = subjectRef(site.subject)
  return site.part === undefined
    ? subject
    : syncRef('domain.changes.subject.part', { subject, part: site.part })
}

/** The problem as an unrendered message: its key, and its values with the record nested. */
export function changeProblemRef(problem: ChangeProblem): SyncMessageRef {
  const params: SyncMessageParams = { ...problem.params }
  if ('site' in problem) params.subject = siteRef(problem.site)
  // The params were checked against the key's placeholders above
  // (`PARAMS_AGREE`), which is what `syncRef` would otherwise check per call.
  return Object.keys(params).length === 0
    ? { messageKey: PROBLEM_KEYS[problem.code] }
    : { messageKey: PROBLEM_KEYS[problem.code], messageParams: params }
}

/** The problem as English plus its key and params — what an API response or MCP carries. */
export function changeProblemMessage(problem: ChangeProblem): SyncMessage {
  return toSyncMessage(changeProblemRef(problem))
}

/**
 * The problem in `locale` — the active UI locale by default, read reactively
 * inside a Solid component's JSX.
 */
export function renderChangeProblem(problem: ChangeProblem, locale?: LocaleTag): string {
  return renderSyncMessage(changeProblemRef(problem), locale)
}
