/**
 * The `ritual move` session's shared choice builders: the searchable card
 * list, the destination deck's sections, and the checkbox/tri-state toggles
 * the list filters and Batch Mode share. Each screen owns its own menu rows
 * (`buildMoveMenuChoices`, `buildBatchMenuChoices`); `deckSectionChoices`
 * reads the destination deck off disk, everything else is pure. The engine
 * these read from is `src/list/move-commit.ts`.
 */

import { compareDisplay } from '../i18n/collate'
import { t } from '../i18n/t'
import { listRefLabel } from '../changes/change-event'
import { finishSuffix } from '../card/finish-condition'
import { printingSuffix } from '../card/card-line'
import { languageToken } from '../card/card-language'
import { importFromTextFile } from '../importers/text-file'
import { resolveDefaultAddSection } from '../list/deck-format'
import type { VirtualCard } from '../list/move-commit'

// ── UI helpers ─────────────────────────────────────────────────────────────────

/** Truncate a string to at most maxLen characters, appending "…" if truncated. */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen - 1) + '…'
}

export type CardSearchChoice = {
  title: string
  value: string
  /**
   * The card text the row is searched by, set only when the title carries a
   * checkbox: `[X]` is an ornament, not something a user types.
   */
  searchText?: string
}

/**
 * The searchable card rows for a move session.
 *
 * `selected` turns the rows into a checklist (Batch Mode): each row gains a
 * `[X]`/`[ ]` box, and keeps the undecorated card text as its `searchText` so
 * the box never answers a search. The sort happens on that card text rather
 * than the finished title, so ticking a card never makes it jump — a list that
 * reorders under the cursor is unusable for picking many cards in a row.
 */
export function buildCardSearchChoices(
  state: Map<string, VirtualCard>,
  enabledSources: ReadonlySet<string>,
  selected?: ReadonlySet<string>,
): CardSearchChoice[] {
  const choices: CardSearchChoice[] = []

  for (const vc of state.values()) {
    if (!enabledSources.has(vc.currentList.filePath)) continue
    if (vc.pendingMove !== null) continue // already moved this session

    const card = vc.card
    const listLabel = listRefLabel(vc.currentList.ref)

    const printingPart = printingSuffix(card.set, card.collectorNumber)
    const finishPart = finishSuffix(card.finish) + languageToken(card.language)
    const idPart = card.cardId !== undefined ? ` &${card.cardId}` : ''

    let notePart = ''
    if (card.note) {
      // Truncate note to keep lines short (~80 chars)
      const noteMax = Math.max(
        20,
        80 - card.name.length - printingPart.length - finishPart.length - 20,
      )
      notePart = ` | ${truncate(card.note, noteMax)}`
    }

    const title = `${card.name}${printingPart}${finishPart}${idPart} — ${listLabel}${notePart}`
    choices.push({ title, value: vc.physicalKey })
  }

  // Sort alphabetically by card name for consistent display
  choices.sort((a, b) => compareDisplay(a.title, b.title))
  if (selected === undefined) return choices
  return choices.map((choice) => ({
    ...choice,
    title: toggleItemTitle(selected.has(choice.value), choice.title),
    searchText: choice.title,
  }))
}

/**
 * Every card key Batch Mode may currently select: a card sitting in one of the
 * given lists that is not already queued for a move. The same predicate
 * {@link buildCardSearchChoices} filters its rows by, so "Select all" can never
 * tick a card the screen does not show.
 */
export function batchSelectableKeys(
  state: Map<string, VirtualCard>,
  sourcePaths: ReadonlySet<string>,
): Set<string> {
  const keys = new Set<string>()
  for (const vc of state.values()) {
    if (!sourcePaths.has(vc.currentList.filePath)) continue
    if (vc.pendingMove !== null) continue
    keys.add(vc.physicalKey)
  }
  return keys
}

/** A destination deck's sections, and the one an unqualified add would land in. */
export type DeckSectionChoices =
  | {
      ok: true
      names: string[]
      /** The section an unqualified add resolves to; `undefined` for a deck with no sections. */
      defaultName: string | undefined
    }
  | { ok: false; error: string }

/**
 * The section names a destination deck offers, for the "which section?" prompt.
 *
 * The default is resolved **before** the names are read: `resolveDefaultAddSection`
 * appends a `Main` section to a deck that has only a commander and a sideboard,
 * and a name list snapshotted before that call would not contain the very
 * section the prompt means to preselect.
 *
 * A deck that cannot be parsed is reported rather than reduced to "no sections":
 * skipping the prompt for it would only defer the failure to the commit, after
 * the user had answered every printing prompt of a batch.
 */
export async function deckSectionChoices(filePath: string): Promise<DeckSectionChoices> {
  const deck = await importFromTextFile(filePath).catch(() => null)
  if (!deck) return { ok: false, error: t('cli.move.cannotReadDeck', { file: filePath }) }
  if (deck.sections.length === 0) return { ok: true, names: [], defaultName: undefined }
  // Mutates only this throwaway parse, never the file.
  const defaultName = resolveDefaultAddSection(deck.sections).name
  return { ok: true, names: deck.sections.map((section) => section.name), defaultName }
}

// ── Toggle state helpers ───────────────────────────────────────────────────────

export function toggleSetAll(target: Set<string>, filePaths: string[], on: boolean): void {
  for (const fp of filePaths) {
    if (on) {
      target.add(fp)
    } else {
      target.delete(fp)
    }
  }
}

export type ToggleState = 'all' | 'some' | 'none'

export function getToggleState(
  filePaths: readonly string[],
  enabled: ReadonlySet<string>,
): ToggleState {
  const count = filePaths.filter((fp) => enabled.has(fp)).length
  if (count === 0) return 'none'
  if (count === filePaths.length) return 'all'
  return 'some'
}

/**
 * A two-state checkbox row: `[X] name` / `[ ] name`. The tri-state sibling for
 * category rows is {@link toggleStateChar}; both spell the box the same way, and
 * a row that got the empty box's space wrong would misalign a whole screen.
 */
export function toggleItemTitle(selected: boolean, name: string): string {
  return t('cli.move.toggleItem', { state: selected ? 'X' : ' ', name })
}

export function toggleStateChar(state: ToggleState): string {
  if (state === 'all') return 'X'
  if (state === 'some') return '~'
  return ' '
}
