/**
 * Apply an "Edit Tags…" gesture to an editor session — the shared body behind
 * the card context menu on every list type (collections and wanted lists via
 * the flat-list controller, decks via the deck controller). Lives beside
 * `collection-labels.ts` and follows its shape: record the change events, then
 * apply the same edit to the live data so the tile updates at once.
 *
 * The events are recorded against the card's *live* tags (not the on-disk
 * baseline the label edit uses): tags are an additive vocabulary diffed one
 * tag at a time, and `consolidateTagEdits` cancels a `remove-tag` against a
 * pending `add-tag` of the same tag, so adding and then removing a tag in one
 * session leaves nothing pending. The live data is updated from the tag delta
 * itself, which is the right edit whether an event was recorded or cancelled
 * a pending opposite.
 */

import { batch, type Setter } from 'solid-js'
import { tagEditChanges, type ChangeInput } from '../changes/change-event'
import type { ApplyChange } from '../changes/apply-batch'
import { normalizeCardTags, withCardTags, type CardTag } from '../card/card-tags'
import { compareDisplay } from '../i18n/collate'
import type { TagEditResult, UseCardChangesResult } from './useCardChanges'
import { promptCardTags } from './tags-prompt'

/** What one tag edit targets and asks for. */
export type CardTagsEdit = {
  cardName: string
  /** The exact copy, when the tile has an `&N`; a card added this session may not yet. */
  cardId?: number
  /** The tags the card should end up with — `[]` clears every tag. */
  tags: readonly CardTag[]
  /** The card's tags right now, as the live data holds them. */
  currentTags: readonly CardTag[] | undefined
}

/** The slice of an editor session a tag edit needs. */
export type TagEditSession<TData, TCardEntry> = {
  changes: UseCardChangesResult<TCardEntry>
  setData: Setter<TData | null>
  applyChange: ApplyChange<TData, ChangeInput>
}

/**
 * The `add-tag` / `remove-tag` inputs that turn `currentTags` into `tags`, in
 * canonical order — what the live data is updated with.
 */
export function tagEditInputs(edit: CardTagsEdit): ChangeInput[] {
  // The one statement of the per-tag delta, shared with `consolidateTagEdits`,
  // so the live data and the recorded events cannot disagree.
  return tagEditChanges(edit.cardName, edit.tags, edit.currentTags, edit.cardId)
}

/** The empty result: nothing recorded, nothing pending. */
const NO_TAG_EDIT: TagEditResult = { addedChanges: [], cancelledChanges: [] }

/**
 * Apply a tag edit to the live data and record its events, in one batch so the
 * tile and the changes badge update together. The data is updated *first*, and
 * nothing is recorded when the engine refuses (`onMiss` — the line could not be
 * found): a change the file never took must not reach the changelog, the same
 * rule `handleSetFinishFor` applies. Returns what was recorded (see
 * {@link TagEditResult}); a no-op or refused edit records nothing.
 */
export function applyCardTagsEdit<TData, TCardEntry>(
  session: TagEditSession<TData, TCardEntry>,
  edit: CardTagsEdit,
): TagEditResult {
  const inputs = tagEditInputs(edit)
  if (inputs.length === 0) return NO_TAG_EDIT
  return batch(() => {
    let missed = false
    session.setData((prev) => {
      if (prev === null) return prev
      let next: TData = prev
      for (const input of inputs) {
        next = session.applyChange(next, input, { onMiss: () => (missed = true) })
      }
      // Every input targets the same line, so a miss is all-or-nothing; keep
      // the data exactly as it was rather than half an edit.
      return missed ? prev : next
    })
    if (missed) return NO_TAG_EDIT
    return session.changes.setTags(edit.cardName, edit.tags, edit.currentTags, edit.cardId)
  })
}

/** Anything that can carry a tag set — an entry of any list type. */
export type TaggedEntry = { tags?: readonly CardTag[] }

/**
 * Every tag used anywhere in `entries`, as one canonical set — the dialog's
 * one-click suggestions. The dialog hides the ones the draft already holds, so
 * the targeted card's own tags need no special treatment here.
 */
export function tagSuggestions(entries: readonly TaggedEntry[]): CardTag[] {
  // Chips a person reads, so display collation — the pinned data order
  // `normalizeCardTags` gives is for the file, not the eye.
  return normalizeCardTags(entries.flatMap((entry) => entry.tags ?? [])).sort(compareDisplay)
}

/** One line a bulk tag add targets: its card name and, when it has one, its `&N`. */
export type TagTarget = { cardName: string; cardId?: number }

/** What the selection menu's "Add Tag…" needs from the controller that opens it. */
export type BulkAddTagsParams = {
  /** The list's distinct tags, offered as one-click additions ({@link tagSuggestions}). */
  suggestions: readonly CardTag[]
  /**
   * Every line the add applies to. The flat controllers expand a tile into its
   * copies (a card added this session may have no `&N` yet, so one target
   * with no id resolves by name); a deck tile is one line under one id.
   */
  targets: readonly TagTarget[]
  /** A line's tags as the live data holds them *now*; read per target at save time. */
  liveTagsOf: (cardName: string, cardId?: number) => readonly CardTag[] | undefined
  /** The editor's per-line setter — `handleSetTagsFor`. */
  setTags: (
    cardName: string,
    tags: readonly CardTag[],
    currentTags: readonly CardTag[] | undefined,
    cardId?: number,
  ) => void
  /**
   * Runs once the union has been applied. The selection menu clears its
   * selection here, so cancelling the dialog keeps the cards selected.
   */
  onApplied: () => void
}

/**
 * The bulk "Add Tag…" gesture, once for every controller: open the tags dialog
 * empty (`mode: 'add'`) and, on save, union the typed tags onto each target's
 * *live* tag set — one `add-tag` per tag a line lacked, never a replacement.
 * The baseline is re-read per target inside the batch, not taken from the
 * selection snapshot: an earlier target in the same batch may share the line.
 */
export function bulkAddTags(params: BulkAddTagsParams): void {
  promptCardTags({
    mode: 'add',
    current: undefined,
    suggestions: params.suggestions,
    onSave: (added) => {
      batch(() => {
        for (const target of params.targets) {
          const live = params.liveTagsOf(target.cardName, target.cardId)
          params.setTags(target.cardName, withCardTags(live, added), live, target.cardId)
        }
      })
      params.onApplied()
    },
  })
}
