/**
 * The questions a move destination raises, asked identically by the single-card
 * session and by Batch Mode: which list the card goes to, which deck section it
 * lands in, and which printing a printing-less card takes on its way into a
 * collection.
 */

import type { Choice } from 'prompts'
import { listRefLabel } from '../changes/change-event'
import { t } from '../i18n/t'
import type { CardLanguage } from '../card/card-language'
import { resolveCardPrinting } from './session/prompts'
import { ask, suggestByTitleTerms } from '../cli/prompts'
import { deckSectionChoices } from './move-choices'
import type { PhysicalCard } from '../list/move-staging'
import type { ListEntry } from '../list/list-info'

/**
 * Ask which list a move targets. The caller decides what to offer (the
 * single-card flow drops the card's own list; a batch keeps every enabled
 * destination and skips the cards already sitting there) and how to word the
 * question, since only it knows whether one card or forty are moving.
 */
export async function promptMoveDestination(
  dests: readonly ListEntry[],
  message: string,
): Promise<ListEntry | undefined> {
  const choices: Choice[] = dests.map((list) => ({
    title: listRefLabel(list.ref),
    value: list,
  }))
  return ask<ListEntry>({
    type: 'autocomplete',
    message,
    subjectKey: 'cli.prompt.subject.moveDestination',
    choices,
    limit: 15,
    suggest: suggestByTitleTerms,
  })
}

/** The answer to "which section?": a section name, the deck's default, or a cancel. */
export type SectionSelection = { kind: 'cancelled' } | { kind: 'section'; section?: string }

/** Sentinel for the "create a section that does not exist yet" row. */
const NEW_SECTION = '__NEW_SECTION__'

/**
 * Ask which section of `dest` the card(s) land in. A deck with no sections at
 * all has nothing to choose between — the add resolves its own default — so the
 * prompt is skipped rather than shown with a single row. A non-deck destination
 * has no sections and is never asked about.
 *
 * The deck's default section is preselected, so pressing Return is the same
 * answer the session gave before this prompt existed. A deck the parser cannot
 * read cancels the move here rather than at the commit, which for a batch is
 * the difference between one refusal and one refusal after forty prompts.
 */
export async function promptDestinationSection(dest: ListEntry): Promise<SectionSelection> {
  if (dest.ref.type !== 'deck') return { kind: 'section' }

  const sections = await deckSectionChoices(dest.filePath)
  if (!sections.ok) {
    console.log(sections.error)
    return { kind: 'cancelled' }
  }
  const { names, defaultName } = sections
  if (names.length === 0) return { kind: 'section' }

  const choices: Choice[] = [
    ...names.map((name) => ({ title: name, value: name })),
    { title: t('cli.move.sectionNew'), value: NEW_SECTION },
  ]
  const initial = defaultName === undefined ? 0 : Math.max(0, names.indexOf(defaultName))

  const picked = await ask<string>({
    type: 'select',
    message: t('cli.move.sectionPrompt', { list: listRefLabel(dest.ref) }),
    subjectKey: 'cli.prompt.subject.deckSection',
    choices,
    initial,
  })
  if (picked === undefined) return { kind: 'cancelled' }
  if (picked !== NEW_SECTION) return { kind: 'section', section: picked }

  return promptNewSection(names)
}

/**
 * Name a section the deck does not have yet. Two answers are not new sections
 * at all and are folded rather than written: a name that differs from an
 * existing section only by case (which would produce a second `## main` beside
 * `## Main`, splitting the deck's mainboard in two), and a name carrying `#` or
 * a line break (which the serializer would emit as `## ## Sideboard`, or as a
 * heading followed by stray prose).
 */
async function promptNewSection(names: readonly string[]): Promise<SectionSelection> {
  const typed = await ask<string>({
    type: 'text',
    message: t('cli.move.sectionNewPrompt'),
    subjectKey: 'cli.prompt.subject.deckSection',
  })
  const name = typed?.trim()
  if (!name) return { kind: 'cancelled' }

  const existing = names.find((section) => section.toLowerCase() === name.toLowerCase())
  if (existing !== undefined) return { kind: 'section', section: existing }
  if (/^#|[\r\n]/.test(name)) {
    console.log(t('cli.move.sectionNameInvalid', { name }))
    return { kind: 'cancelled' }
  }
  return { kind: 'section', section: name }
}

/**
 * What a printing prompt decided for one card: nothing to do, a card stamped
 * with its resolved printing, or a reason it cannot be moved after all.
 *
 * `cancelled` (the user escaped) and `none` (the card has no known printings)
 * stay distinct all the way to the caller — a batch stops asking on a cancel
 * and keeps going on a `none`.
 */
export type MovePrintingResolution =
  | { kind: 'unchanged' }
  | { kind: 'resolved'; card: PhysicalCard }
  | { kind: 'cancelled' }
  | { kind: 'none' }

/**
 * Resolve the printing a card needs to enter `dest`, prompting when the
 * destination is a collection and the card has none of its own (a name-only
 * wanted entry). Every other combination is `unchanged` — a printing is never
 * invented for a destination whose grammar does not require one.
 */
export async function resolveMovePrinting(
  card: PhysicalCard,
  dest: ListEntry,
): Promise<MovePrintingResolution> {
  if (dest.ref.type !== 'collection') return { kind: 'unchanged' }
  if (card.set && card.collectorNumber) return { kind: 'unchanged' }

  console.log(t('cli.move.needsPrinting', { name: card.name }))
  const result = await resolveCardPrinting(card.name, {}, false)
  if (result.kind === 'cancelled') {
    console.log(t('cli.move.printingCancelled'))
    return { kind: 'cancelled' }
  }
  if (result.kind === 'none') {
    console.log(t('cli.move.noPrintingsFound', { name: card.name }))
    return { kind: 'none' }
  }

  // The picker's availability confirm may have resolved a language for the
  // assigned printing (a printing that does not exist in the configured
  // default); an explicit `en` there means a bare line. Otherwise the card
  // keeps whatever language token it already carried.
  const language: CardLanguage | undefined =
    result.language !== undefined
      ? result.language === 'en'
        ? undefined
        : result.language
      : card.language

  return {
    kind: 'resolved',
    card: {
      ...card,
      set: result.printing.set.toLowerCase(),
      collectorNumber: result.printing.collector_number,
      language,
    },
  }
}
