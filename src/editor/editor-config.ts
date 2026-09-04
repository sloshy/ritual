/**
 * The editor's type contract: the config a list page supplies to
 * {@link import('./useEditor').useEditor}, the result it hands back, and the
 * shapes the two share with the dialogs and controllers.
 */

import type { Accessor, Setter } from 'solid-js'
import type { Finish } from '../card/finish-condition'
import type { ScryfallCard } from '../scryfall/types'
import type { CardLanguage } from '../card/card-language'
import type { CardTag } from '../card/card-tags'
import type { CardCategory } from '../card/card-categories'
import type { CardCategoriesJson, CardCategoriesRecord } from '../list/card-categories-record'
import type { CardLabel } from '../card/card-labels'
import type { CardArtRef } from '../list/card-art'
import type { SaveEffect } from '../changes/save-effects'
import type { PriceCurrency } from '../pricing/price-currency'
import type {
  ChangeEvent,
  ChangeInput,
  CardPrintingOptions,
  PrintingTuple,
  ListRef,
} from '../changes/change-event'
import type { ImportConflict } from './import-changes'
import type { ContextMenuState, CardContextInfo } from '../list-view/card-context'
import type { EditorStatus, EditorStatusActions } from './useEditorStatus'
import type { EditorEntity } from './entity'
import type { DialogState } from './useDialogState'
import type { UseCardIdPoolResult } from './useCardIdPool'
import type { UseCardChangesResult } from './useCardChanges'
import type { CommitSink } from './commit'
import type { ApplyChange } from '../changes/apply-batch'
import type { SwapSourceProvider } from './swap-printings'

export type ListItem = { slug: string; name: string }

/**
 * Narrow set of change/pool operations the "change printing" flow needs, built
 * by {@link import('./useEditor').useEditor} from the card-changes and card-id-pool hooks. Kept free of
 * the editor's card-entry generic so the per-list `applyChangePrinting`
 * implementations stay simple.
 */
export type ChangePrintingTools = {
  setPrinting: (
    cardName: string,
    target: PrintingTuple,
    original: PrintingTuple,
    cardId?: number,
  ) => void
  addCard: (cardName: string, options?: CardPrintingOptions) => void
  decrementCard: (cardName: string, cardId?: number) => void
  allocateId: () => number
}

/** Everything a list-specific `applyChangePrinting` needs to apply the change. */
export type ChangePrintingContext<TData> = {
  data: TData
  original: TData | null
  /** Identity + current printing of the targeted tile. */
  target: CardContextInfo
  /** How many copies to retarget (1..target.quantity). */
  count: number
  /** The chosen printing (set/collectorNumber/finish/condition); empty = no specific printing. */
  options: CardPrintingOptions
  tools: ChangePrintingTools
  setData: Setter<TData | null>
}

/** UI state for the multi-step change-printing flow. */
export type ChangePrintingFlow = {
  target: CardContextInfo
  step: 'quantity' | 'printing'
  count: number
}

export type LoadResult<TData> = {
  data: TData
  poolIds: number[]
  contentHash: string
  extra: Record<string, unknown>
}

/**
 * Commit a card chosen in the search dialog. Every argument past the name is
 * optional, so the dialog, the shell, and the editor share one type rather than
 * three hand-written copies that can silently drop a trailing argument.
 */
export type AddCardFromSearch = (
  cardName: string,
  options?: CardPrintingOptions,
  scryfallCard?: ScryfallCard,
  allPrintings?: ScryfallCard[],
  /** Copies to add. Defaults to 1. */
  quantity?: number,
  extras?: AddCardExtras,
) => void

/**
 * What the add dialog can attach to the new card beyond its printing: the label
 * override it starts under, and custom art for the line it becomes.
 *
 * Kept apart from {@link CardPrintingOptions} because neither is part of a
 * printing's identity — the labels ride the `add` event, while the art is list
 * metadata the editor stages against the id it allocates (see
 * `pending-art.ts`).
 */
export type AddCardExtras = {
  labels?: CardLabel[]
  art?: CardArtRef
}

/**
 * How a list models multiple copies of the same printing. Decks keep one entry
 * carrying a quantity, so every copy shares a single card ID; collections and
 * wanted lists store one entry per copy, so each copy needs its own ID.
 */
export type CopyModel = 'quantity' | 'per-entry'

/**
 * The editor config a list page supplies. The copy model is not part of it: it
 * follows from the data shape, so the deck / flat-list controller fills it in.
 */
export type ListEditorConfig<TData> = Omit<EditorConfig<TData>, 'copyModel'>

export type EditorConfig<TData> = {
  /** See {@link CopyModel}. Supplied by the deck / flat-list controller. */
  copyModel: CopyModel
  /**
   * Fetch the raw list-of-items payload (passed to {@link EditorConfig.extractListItems}).
   * Admin hits `/api/decks` etc.; the public site resolves a single preloaded
   * item without a network call.
   */
  fetchList: () => Promise<unknown>
  /** Extract the list items from the {@link EditorConfig.fetchList} payload. */
  extractListItems: (response: unknown) => ListItem[]
  /**
   * Fetch the raw payload for one item (passed to {@link EditorConfig.processLoadResponse}).
   * Admin hits `/api/deck/{slug}`; the public site resolves its preloaded data.
   */
  fetchData: (slug: string, signal: AbortSignal) => Promise<unknown>
  /** Commit (or export) the pending edits. See {@link CommitSink}. */
  commit: CommitSink<TData>
  /** Whether to render the list selector dropdown. Defaults to true (admin); the public single-item editor hides it. */
  showSelector?: boolean
  /**
   * Which kind of list this editor edits. Names the entity in status text
   * ("Loading deck…") by selecting a per-type message rather than splicing a
   * noun into a frame.
   */
  entityLabel: EditorEntity

  /** Process the load payload into editor state. Return null on failure. */
  processLoadResponse: (response: unknown) => LoadResult<TData> | null

  /** Load card display data from the full load payload */
  loadCardData: (response: unknown) => void
  /** Add a single card's display data after search selection */
  addCardData: (cardName: string, card?: ScryfallCard, printings?: ScryfallCard[]) => void
  /**
   * Hook run after a card is added from search, to load and apply its prices.
   * Admin fetches `/api/card-price`; the public site uses the printing already in
   * hand or its session cache. Optional — adding still works without prices.
   */
  onCardAdded?: (cardName: string, scryfallCard?: ScryfallCard) => Promise<void> | void
  /**
   * Aim custom art at a card line this session created (or clear what a reused
   * `&N` was carrying). Called once per allocated id: with the reference an add
   * supplied, and with `null` for an id the pool handed out that some earlier
   * card's art is still filed under. Optional — a host with no art route (the
   * public editor) simply does not offer art at add time.
   */
  onCardArt?: (cardId: number, art: CardArtRef | null) => void
  /**
   * An undo handed a card id back to the pool: whatever art was staged against
   * it belongs to a card that is no longer there, and the list's own art applies
   * again. Covers both directions — a session add taken back, and a removal
   * reclaiming the `&N` it had released, which is how undoing the removal of a
   * card with custom art gets that art back.
   */
  onCardArtReset?: (cardId: number) => void
  /**
   * The `&N` an add of this card would land on because it *merges* into a line
   * the list already has, or `undefined` when it starts a new line. Decks fold a
   * repeat of the same printing (and label override) into one entry, so the id
   * the editor just allocated never reaches a card line — and art staged against
   * it would be written for a line that does not exist. Art is per line, so the
   * copies share the target line's.
   *
   * Only consulted for art targeting; the add itself still carries the allocated
   * id, exactly as before. Omitted by list types whose adds never merge.
   */
  findAddMergeTargetId?: (data: TData, add: ChangeInput) => number | undefined
  /**
   * Run after a save has succeeded, with what the save reported it did. The
   * admin editors use it to flush the art they staged for cards that had no line
   * on disk until this very save — the effects say which `&N` each of those
   * cards actually got. Awaited by no one: the save is already committed, and
   * the hook reports its own failures.
   */
  onSaved?: (effects: readonly SaveEffect[]) => void | Promise<void>

  /** Apply a change to the in-memory data, returning updated data */
  applyChange: ApplyChange<TData, ChangeInput>
  /**
   * Apply a "change printing" action: emit the appropriate change events (via
   * `ctx.tools`) and update the in-memory data (via `ctx.setData`). List types
   * differ — decks split a multi-copy entry into decrement + new-printing add,
   * while collections/wanted retarget individual entries — so each editor
   * provides its own implementation. Omitted to disable the feature for a list.
   */
  applyChangePrinting?: (ctx: ChangePrintingContext<TData>) => void
  /** Whether the loaded data is non-empty (e.g. entries.length > 0) */
  hasData: (data: TData) => boolean

  /**
   * Resolve the current finish of one targeted card. `cardId` identifies the
   * copy when the caller has one — a list can hold the same card twice (one
   * pinned, one name-only), and resolving by name alone answers for whichever
   * comes first.
   */
  findCurrentFinish: (data: TData, cardName: string, cardId?: number) => Finish
  /** Resolve the original finish for foil toggle comparison. `cardId` as above. */
  findOriginalFinish: (original: TData, cardName: string, cardId?: number) => Finish
  /** Find the card ID for a card by name */
  findCardId: (data: TData, cardName: string) => number | undefined
  /**
   * Resolve the on-disk language of a card for set-language consolidation
   * (undefined for a bare line, which means `en`). Optional because the deck /
   * flat-list controllers inject a data-shape-appropriate default; a page config
   * may still override it.
   */
  findOriginalLanguage?: (
    original: TData,
    cardName: string,
    cardId?: number,
  ) => CardLanguage | undefined

  /** Extract all card IDs from data (for pool reset on discard) */
  getOriginalIds: (original: TData) => number[]

  /**
   * Derive the section order directly from the data, when sections live in the data itself
   * (decks: `deck.sections`). Flat lists (collections/wanted) omit this and instead seed the
   * order from `extra.sectionOrder` on load, after which it is derived by replaying the
   * section-structural changes.
   */
  sectionsOf?: (data: TData) => string[]
  /** Count cards per section, used to disable deletion of non-empty sections. */
  cardCountsBySection?: (data: TData) => Record<string, number>
  /** Resolve the section a targeted card currently belongs to (for move consolidation). */
  cardSectionOf?: (data: TData, target: CardContextInfo) => string | undefined

  /**
   * The other lists a card in this editor can be moved to. Drives the "Move to
   * list" menus; omit to disable cross-list moves. Receives the slug of the list
   * currently open — which changes as the user picks another one — so the
   * implementation can exclude it without tracking the selection itself.
   */
  moveTargets?: (currentSlug: string | null) => ListRef[]

  /**
   * The other lists the "Swap Printings" wizard may draw replacement copies
   * from, and how to load them. Omit to leave the wizard out of this editor
   * (wanted lists, which hold no physical cards).
   */
  swapSources?: SwapSourceProvider

  /**
   * The currency price displays should use, as a reactive accessor. The admin
   * editors pass the configured default currency (from `/api/config`); the
   * public editors pass the site's active currency. Defaults to USD.
   */
  currency?: Accessor<PriceCurrency>
}

/**
 * One row of a manager modal: a name and how many cards it currently covers.
 * The Sections modal and the Manage-categories modal render the same row markup
 * (`.section-manager-row`) from this one model, so the two cannot drift apart.
 */
export type ManagerRow = { name: string; count: number }

/** A section plus how many cards it currently holds — a {@link ManagerRow}. */
export type SectionInfo = ManagerRow

/** An in-app text-input prompt (replaces native `window.prompt` for section naming). */
export type TextPromptState = {
  title: string
  label: string
  initialValue: string
  confirmLabel: string
  /** Returns an error message for an invalid value, or null when acceptable. */
  validate?: (value: string) => string | null
  onConfirm: (value: string) => void
}

/** Outcome of importing a change file's events into the editor. */
export type ImportResult = {
  /** Number of changes loaded as pending edits after re-targeting. */
  loaded: number
  /** Changes that could not be re-targeted to a current card and were skipped. */
  conflicts: ImportConflict[]
}

export type UseEditorResult<TData, TCardEntry> = {
  slug: Accessor<string | null>
  list: Accessor<ListItem[]>
  /** Whether the list selector dropdown should be shown (false for the public single-item editor). */
  showSelector: boolean
  data: Accessor<TData | null>
  setData: Setter<TData | null>
  contentHash: Accessor<string>
  /**
   * Adopt a fresh content hash mid-session — for out-of-band writes to the same
   * file that return one (the collection Labels metadata save), so the next
   * card save doesn't 409 against a change this editor itself made.
   */
  setContentHash: (hash: string) => void
  extra: Accessor<Record<string, unknown>>
  /**
   * Replace the load-time extras mid-session — for an out-of-band write to the
   * same file that returns a fresher copy of what they snapshot (the deck
   * editor's `frontMatter`, rewritten by the labels and cover dialogs). Without
   * it the next card save would re-send the snapshot taken at load and delete
   * the key that write just added.
   */
  setExtra: (extra: Record<string, unknown>) => void
  /** The currency price displays use (the config's accessor, or a USD constant). */
  currency: Accessor<PriceCurrency>
  getOriginal: () => TData | null
  isDataReady: () => boolean

  status: EditorStatus
  statusActions: EditorStatusActions
  dialogs: DialogState
  contextMenuCard: Accessor<ContextMenuState | null>
  setContextMenuCard: (state: ContextMenuState | null) => void

  /** Current change-printing flow state (null when inactive). */
  changePrinting: Accessor<ChangePrintingFlow | null>
  /** Open the change-printing flow for a targeted tile. */
  startChangePrinting: (target: CardContextInfo) => void
  /** Begin a sequential change-printing run over many targets (bulk multi-select). */
  startBulkChangePrinting: (targets: CardContextInfo[]) => void
  /** Advance from the quantity prompt to the printing picker. */
  confirmChangePrintingCount: (count: number) => void
  /** Apply the chosen printing to the targeted copies. */
  handleChangePrintingSelect: (
    options?: CardPrintingOptions,
    scryfallCard?: ScryfallCard,
    allPrintings?: ScryfallCard[],
  ) => void
  /** Abandon the change-printing flow. */
  cancelChangePrinting: () => void

  changes: UseCardChangesResult<TCardEntry>
  /** Card names added this session (not pre-existing, not moved from another list). */
  addedCardNames: () => string[]
  pool: UseCardIdPoolResult

  handleSelect: (e: Event) => void
  handleCancelDiscard: () => void
  handleSetFoil: () => void
  /** Set an explicit finish on one targeted card/copy (backs the bulk foil actions). */
  handleSetFinishFor: (cardName: string, finish: Finish, cardId?: number) => void
  /** Set an explicit language on one targeted card/copy (backs the menu and bulk language actions). */
  handleSetLanguageFor: (cardName: string, language: CardLanguage, cardId?: number) => void
  /**
   * Set one card's tags to exactly `tags` (backs the "Edit Tags…" menu row on
   * every list type). `currentTags` are the card's live tags, read by the
   * caller from the entry it targeted — see `card-tags-edit.ts` for why the
   * edit consolidates against the live set rather than the on-disk one.
   */
  handleSetTagsFor: (
    cardName: string,
    tags: readonly CardTag[],
    currentTags: readonly CardTag[] | undefined,
    cardId?: number,
  ) => void
  /**
   * Set one card's categories to exactly `categories` (backs the "Edit
   * Categories…" menu row on every list type). Name-keyed and latest-wins, so
   * there is no `cardId` parameter: the event covers every line of the name.
   */
  handleSetCategoriesFor: (cardName: string, categories: CardCategory[]) => void
  /** The list's categories as loaded, with the session's pending category events replayed. */
  categoriesRecord: Accessor<CardCategoriesRecord>
  /**
   * {@link categoriesRecord} in the JSON shape the read pages take, memoized —
   * one derivation for the three editor bodies, and one stable identity per
   * change rather than a fresh object per render.
   */
  categoriesJson: Accessor<CardCategoriesJson>
  /** Rename a category across the whole list (`rename-category`). */
  handleRenameCategory: (from: CardCategory, to: CardCategory) => void
  /** Replace the list's declared vocabulary order (`set-category-order`). */
  handleSetCategoryOrder: (order: CardCategory[]) => void
  /**
   * Remove a category: one `set-categories` per card that held it, plus a
   * `set-category-order` without it. There is no `remove-category` action —
   * design §5 keeps the action set to three.
   */
  handleRemoveCategory: (category: CardCategory) => void
  handleAddCardFromSearch: (...args: Parameters<AddCardFromSearch>) => Promise<void>
  handleUndo: () => void
  handleSave: () => Promise<void>
  handleDiscard: () => void
  /** Load an imported change file's events as pending edits, re-targeted to current card IDs. */
  importChanges: (changes: ChangeEvent[]) => ImportResult
  /** Resume an in-memory edit session verbatim (no re-targeting), preserving exact card IDs. */
  restoreChanges: (changes: ChangeEvent[]) => void

  /** Current section names in display order, including empty sections. */
  sectionOrder: Accessor<string[]>
  /** Sections with their current card counts, in display order. */
  sectionInfo: Accessor<SectionInfo[]>
  /** Create a new, empty section. No-op if a section with that name already exists. */
  handleAddSection: (name: string) => void
  /** Rename an existing section, moving all its cards along with it. */
  handleRenameSection: (oldName: string, newName: string) => void
  /** Delete a section. Only takes effect when the section is empty. */
  handleRemoveSection: (name: string) => void
  /** Move a card (identified by the context menu target) into a section, creating it if needed. */
  handleMoveCardToSection: (target: CardContextInfo, section: string) => void
  /** Move many targeted cards into a section in one pass (creating it once if needed). */
  handleMoveCardsToSection: (targets: CardContextInfo[], section: string) => void

  /** The other lists a card here can be moved to (excludes the current list). */
  moveTargets: () => ListRef[]
  /** The swap wizard's source provider, when the config supplies one. */
  swapSources: () => SwapSourceProvider | undefined

  /** The active in-app text prompt (section naming), or null when none is open. */
  textPrompt: Accessor<TextPromptState | null>
  /** Dismiss the active text prompt without confirming. */
  closeTextPrompt: () => void
  /** Open a styled prompt to name a new section and move the targeted card into it. */
  promptNewSectionForCard: (target: CardContextInfo) => void
  /** Open a styled prompt to name a new section and move many targeted cards into it. */
  promptNewSectionForCards: (targets: CardContextInfo[]) => void
  /** Open a styled prompt to rename an existing section. */
  promptRenameSection: (oldName: string) => void
  /** Open the shell's text prompt to rename one category across the whole list. */
  promptRenameCategory: (oldName: CardCategory) => void
}
