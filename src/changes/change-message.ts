/**
 * The **single** display renderer for change events.
 *
 * Ritual describes a change twice, on purpose, and the two must never be
 * confused:
 *
 * 1. `formatChangeCore` (`src/change-event.ts`) serializes the `.changes.md`
 *    prose line beside the typed event `changelog-blocks.ts` persists. It is a
 *    data format — frozen English, never imports `src/i18n`.
 * 2. This module renders the same change *for a human to read*, in the active
 *    UI locale, and is the only place that does. The CLI's pending-change
 *    output, the public site's changelog modal, and the admin/public editors
 *    all go through {@link changeMessage} — collapsing the duplicated wording
 *    `src/site/changelog-format.ts` used to carry beside `formatChangeCore`
 *    (the plan's §7.8 and open question #6).
 *
 * One shape reaches it — a typed {@link ChangeEvent} — normalized into
 * {@link DisplayChange} first: a pending change is described in the present
 * tense with its `&N` (it has not been saved yet); a change read back out of a
 * persisted file ({@link displayHistoryChange}) in the past tense without it.
 *
 * Browser-safe: no `node:` imports.
 */

import {
  formatFinishConditionTail,
  formatPrintingAnnotation,
  listRefLabel,
  type ChangeAction,
  type ChangeEvent,
} from './change-event'
import { formatCardLabels } from '../card/card-labels'
import { languageLabel } from '../card/card-language'
import { currentLocale } from '../i18n/runtime'
import { tSegmentsDynamic, type MessageParams, type MessageRef, type RenderParams } from '../i18n/t'
import type { MessageKey } from '../i18n/messages/en'
import type { LocaleTag, MessageSegment } from '../i18n/types'

// ---------------------------------------------------------------------------
// The normalized input
// ---------------------------------------------------------------------------

/**
 * Whether the change is being described before it is saved (`present` — "Add
 * Sol Ring") or after (`past` — "Added Sol Ring"). Carried as a `$select`
 * parameter rather than as two key families so a translator writes one entry
 * per action and inflects it however the target language needs.
 */
export type ChangeTense = 'present' | 'past'

/**
 * A change reduced to exactly what the renderer interpolates. Every field is
 * already a display fragment: the caller has resolved printings, labels and
 * list references, so {@link changeMessage} is a pure key/params lookup with no
 * second formatting pass hiding inside it.
 */
export type DisplayChange = {
  action: ChangeAction
  tense: ChangeTense
  /** The card name, or `''` for the section-structural actions, which name no card. */
  cardName: string
  /** ` &5`, or `''` when the change carries no card ID. */
  idSuffix: string
  /** ` (NEO:234) [foil] [LP] [ja]` — already space-prefixed, or `''`. */
  annotation: string
  /** A non-main deck board (`Sideboard`), or `undefined` for the main board. */
  board?: string
  /** The finish token for `set-finish`. */
  finish?: string
  /** `NEO:234 [foil]` for `set-printing`; `undefined` means "no specific printing". */
  printing?: string
  /** The language name for `set-language`, already rendered in the UI locale. */
  language?: string
  /** The note body for `set-note`; `''` means the note was cleared. */
  note?: string
  /** Comma-joined label tokens for `set-label`; `''` means the override was cleared. */
  labels?: string
  /** The section name for the section-structural actions and `set-section`. */
  section?: string
  /** The new section name for `rename-section`. */
  newSection?: string
  /** The other list's rendered name for `move-from` / `move-to`. */
  list?: string
}

// ---------------------------------------------------------------------------
// The message
// ---------------------------------------------------------------------------

/**
 * A message key plus the parameters it needs — the same `{ messageKey,
 * messageParams }` pair API responses and error envelopes carry, so a change
 * can cross a wire and be rendered in the reader's locale rather than the
 * writer's.
 *
 * The params are type-erased here because the key varies per action; they are
 * checked against the catalog at construction by {@link buildMessage}.
 */
export type ChangeMessage = MessageRef & {
  params: RenderParams
}

/**
 * Build a {@link ChangeMessage}, checking the params against the key's catalog
 * entry. This is where the compile-time guarantee lives: rename a placeholder
 * in `domain.ts` and every branch below stops compiling.
 */
function buildMessage<K extends MessageKey>(key: K, params: MessageParams<K>): ChangeMessage {
  return { key, params }
}

/**
 * Render a built message. {@link tSegmentsDynamic} re-attaches the params to
 * their key after {@link ChangeMessage} erased the relationship; it is sound
 * because {@link buildMessage} is the only constructor and it checked them.
 */
function renderMessage(message: ChangeMessage, locale: LocaleTag): MessageSegment[] {
  return tSegmentsDynamic(locale, message.key, message.params)
}

/**
 * The message key and parameters describing a change. **The single display
 * renderer** — every user-facing surface goes through here, and nothing else
 * may re-implement the 21-action wording.
 */
export function changeMessage(change: DisplayChange): ChangeMessage {
  const tense = change.tense
  const name = change.cardName
  const id = change.idSuffix
  const annotation = change.annotation
  const section = change.section ?? ''

  switch (change.action) {
    case 'add':
      return change.board === undefined
        ? buildMessage('domain.change.add', { tense, name, annotation, id })
        : buildMessage('domain.change.addToBoard', {
            tense,
            name,
            annotation,
            board: change.board,
            id,
          })
    case 'remove':
      return change.board === undefined
        ? buildMessage('domain.change.remove', { tense, name, annotation, id })
        : buildMessage('domain.change.removeFromBoard', {
            tense,
            name,
            annotation,
            board: change.board,
            id,
          })
    case 'set-commander':
      return buildMessage('domain.change.setCommander', { name, id })
    case 'unset-commander':
      return buildMessage('domain.change.unsetCommander', { name, id })
    case 'set-finish':
      return buildMessage('domain.change.setFinish', { name, finish: change.finish ?? '', id })
    case 'set-printing':
      return change.printing === undefined
        ? buildMessage('domain.change.setPrintingNone', { name, id })
        : buildMessage('domain.change.setPrinting', { name, printing: change.printing, id })
    case 'set-language':
      return buildMessage('domain.change.setLanguage', {
        name,
        language: change.language ?? '',
        id,
      })
    case 'set-note':
      // An empty note is a clear, not a set — the same fold `formatChangeCore`
      // applies, so the two descriptions of one event stay in step.
      return change.note
        ? buildMessage('domain.change.setNote', { name, id, note: change.note })
        : buildMessage('domain.change.clearNote', { tense, name, id })
    case 'set-label':
      return change.labels
        ? buildMessage('domain.change.setLabels', { name, id, labels: change.labels })
        : buildMessage('domain.change.clearLabels', { tense, name, id })
    case 'move-from':
      return buildMessage('domain.change.moveToList', {
        tense,
        name,
        annotation,
        id,
        list: change.list ?? '',
      })
    case 'move-to':
      return buildMessage('domain.change.moveFromList', {
        tense,
        name,
        annotation,
        id,
        list: change.list ?? '',
      })
    case 'add-section':
      return buildMessage('domain.change.addSection', { tense, section })
    case 'remove-section':
      return buildMessage('domain.change.removeSection', { tense, section })
    case 'rename-section':
      return buildMessage('domain.change.renameSection', {
        tense,
        section,
        newSection: change.newSection ?? '',
      })
    case 'set-section':
      return buildMessage('domain.change.setSection', { tense, name, section, id })
    default:
      change.action satisfies never
      throw new Error(`Unhandled change action (this is a bug)`)
  }
}

/**
 * A change rendered as ordered text/parameter segments, so a UI can wrap one
 * parameter in markup — the public site turns the `name` segment into a
 * clickable card link. The translator keeps full control of word order, which
 * the previous `{ prefix, suffix }` split could not offer.
 */
export function changeSegments(change: DisplayChange): MessageSegment[] {
  return renderMessage(changeMessage(change), currentLocale())
}

/** A change rendered as one flat string in the active UI locale. */
export function renderChange(change: DisplayChange): string {
  let out = ''
  for (const segment of changeSegments(change)) out += segment.value
  return out
}

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

/** The `&5` suffix a live change carries; section-meta changes carry no card. */
function idSuffixOf(change: ChangeEvent): string {
  const cardId = 'cardId' in change ? change.cardId : undefined
  return cardId === undefined ? '' : ` &${cardId}`
}

/** A non-main board name, or `undefined` — the main board is never annotated. */
function boardOf(board: string | undefined): string | undefined {
  return board !== undefined && board !== '' && board.toLowerCase() !== 'main' ? board : undefined
}

/** The `NEO:234 [foil] [ja]` descriptor, or `undefined` for "no specific printing". */
function printingDescriptor(
  set: string | undefined,
  collectorNumber: string | undefined,
  finish: string | undefined,
  condition: string | undefined,
  language: string | undefined,
): string | undefined {
  if (!set || !collectorNumber) return undefined
  const tail = formatFinishConditionTail(finish, condition, language)
  return `${set.toUpperCase()}:${collectorNumber}${tail}`
}

/**
 * Normalize a live {@link ChangeEvent}. Defaults to the present tense: these
 * are pending changes a user is deciding whether to save.
 */
export function displayChangeFromEvent(
  change: ChangeEvent,
  tense: ChangeTense = 'present',
): DisplayChange {
  const locale = currentLocale()
  const base: DisplayChange = {
    action: change.action,
    tense,
    cardName: 'cardName' in change ? change.cardName : '',
    idSuffix: idSuffixOf(change),
    annotation: '',
  }

  switch (change.action) {
    case 'add':
      return { ...base, annotation: formatPrintingAnnotation(change), board: boardOf(change.board) }
    case 'remove':
      return { ...base, annotation: formatPrintingAnnotation(change), board: boardOf(change.board) }
    case 'set-finish':
      return { ...base, finish: change.finish }
    case 'set-printing':
      return {
        ...base,
        printing: printingDescriptor(
          change.set,
          change.collectorNumber,
          change.finish,
          change.condition,
          change.language,
        ),
      }
    case 'set-language':
      return { ...base, language: languageLabel(change.language, locale) }
    case 'set-note':
      return { ...base, note: change.note }
    case 'set-label':
      return { ...base, labels: formatCardLabels(change.labels) }
    case 'move-from':
      return {
        ...base,
        annotation: formatPrintingAnnotation(change),
        list: listRefLabel(change.to),
      }
    case 'move-to':
      return {
        ...base,
        annotation: formatPrintingAnnotation(change),
        list: listRefLabel(change.from),
      }
    case 'add-section':
    case 'remove-section':
      return { ...base, section: change.section }
    case 'rename-section':
      return { ...base, section: change.section, newSection: change.newSection }
    case 'set-section':
      return { ...base, section: change.section }
    case 'set-commander':
    case 'unset-commander':
      return base
    default:
      change satisfies never
      throw new Error(`Unhandled change action (this is a bug)`)
  }
}

/**
 * Normalize a change read back out of a `.changes.md` file. Always past
 * tense — the file records what happened — and never carries an `&N` suffix:
 * the block persists the ID into `cardId`, but it is deliberately not rendered,
 * since the UI has no use for an internal line number.
 */
export function displayHistoryChange(change: ChangeEvent): DisplayChange {
  return { ...displayChangeFromEvent(change, 'past'), idSuffix: '' }
}

/**
 * Describe a pending change for a human — "Add Sol Ring (NEO:234) &5".
 *
 * Lives here rather than beside `formatChangeCore` because it is *display*:
 * it follows the UI locale, so it must not sit in the module the persistence
 * fence keeps away from `src/i18n`.
 */
export function formatChange(change: ChangeEvent): string {
  return renderChange(displayChangeFromEvent(change))
}
