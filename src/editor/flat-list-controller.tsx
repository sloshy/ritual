import { type Accessor, type JSX, Show, batch, createMemo, createSignal } from 'solid-js'
import type { Finish, Condition } from '../card/finish-condition'
import { DEFAULT_SECTION } from '../list/deck'
import type { CardLabel } from '../card/card-labels'
import type { CardLanguage } from '../card/card-language'
import type { ChangeInput, ListRef, PrintingTuple } from '../changes/change-event'
import type { SelectedCard } from '../list-view/useCardSelection'
import type { CardContextInfo } from '../list-view/card-context'
import type { ListEditorConfig, UseEditorResult } from './editor-config'
import type { EditorEntity } from './entity'
import type { ListType } from '../list/list-type'
import {
  bulkMoveToList,
  printingForMove,
  printingOf as currentPrintingOf,
} from '../list-view/printing-prompt'
import { promptListMove, promptSectionMove } from '../list-view/move-prompt'
import { promptCardLanguage } from '../list-view/language-prompt'
import { useEditor } from './useEditor'
import { sharedBulkEdit } from './shared-bulk-edit'
import type { UseEditorDefaultsResult } from './useEditorDefaults'
import type { SearchProvider } from './search-provider'
import { useEntryCardData, type EntryCardData, type EntryCardDataActions } from './useEntryCardData'
import { sectionOfTarget } from './section-helpers'
import { CardContextMenu } from './components/CardContextMenu'
import { canSetFinish, hasSpecificPrinting } from '../card/card-printing'
import { findEntryByIdOrName } from '../changes/entry-targeting'
import { EditorShell } from './components/EditorShell'
import type { ApplyChange } from '../changes/apply-batch'
import type { SwapPrintingsWizardProps } from './components/SwapPrintingsWizard'
import { entityListType } from './entity'
import { createSwapController, type SwapController } from './swap-controller'
import { flatSwapTargets } from './swap-targets'

/** Minimal flat-list entry shape the shared controller and context menu rely on. */
export type FlatEntry = {
  name: string
  cardId?: number
  fileOrder?: number
  section: string
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
  /** The line's language token, when present. Absent means `en`. */
  language?: CardLanguage
  /** The line's label override, where the list type carries labels. */
  labels?: CardLabel[]
  note?: string
}

/** The printing fields logged when a flat entry is added or removed. */
export type FlatPrinting = {
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
  /** The copy's language. Omitted means English (the bare-line default). */
  language?: CardLanguage
}

/** A change input for flat lists — {@link ChangeInput} plus a `fileOrder` removal target. */
export type FlatChangeInput = ChangeInput & { fileOrder?: number }

/**
 * Bulk edit operations over a multi-select of flat-list cards (collections/wanted).
 * Flat entries are one-per-copy with their own `cardId`, so removals target specific
 * entries resolved from the selection's `cardIds` — never by name. No commander.
 */
export type FlatBulkEdit = {
  /** Add one more copy of each selected card. */
  addCopy: (cards: SelectedCard[]) => void
  /** Remove one copy of each selected card. */
  removeCopy: (cards: SelectedCard[]) => void
  /** Remove every copy of each selected card (full removal). */
  removeAll: (cards: SelectedCard[]) => void
  /** Set the finish on each selected card that supports it; others are skipped. */
  setFinish: (cards: SelectedCard[], finish: Finish) => void
  /**
   * Whether {@link setFinish} would apply the finish to *every* selected card
   * as the list stands now — both halves of the question it asks: the card's
   * printing publishes that finish, and (for foil/etched) the line pins a
   * printing at all. A {@link SelectedCard} is a snapshot taken when the tile
   * was ticked, so its printing can be stale in both directions — pinned since,
   * or unpinned again by an undo — and the answer comes from live data.
   *
   * All-or-nothing on purpose: `setFinish` skips what it cannot apply, so a
   * partially-applicable selection would look like it worked while quietly
   * leaving cards behind. The menu greys the action out instead.
   */
  canSetFinish: (cards: SelectedCard[], finish: Finish) => boolean
  /** Set the language on every copy of every selected card. */
  setLanguage: (cards: SelectedCard[], language: CardLanguage) => void
  /**
   * Set (or clear, with `[]`) the label override on every selected card.
   * Collection editors only — supplied by the collection layer, absent elsewhere.
   */
  setLabel?: (cards: SelectedCard[], labels: CardLabel[]) => void
  /** Run the change-printing flow over the selection one card at a time. */
  changePrinting: (cards: SelectedCard[]) => void
  /**
   * Open the "Swap Printings" wizard pre-checked on the selection. Collection
   * editors only — supplied by the collection layer, absent elsewhere (a
   * wanted list holds no physical cards to swap).
   */
  swapPrintings?: (cards: SelectedCard[]) => void
  /** Move every selected card into an existing section. */
  moveToSection: (cards: SelectedCard[], section: string) => void
  /** Prompt for a new section name and move every selected card into it. */
  promptNewSection: (cards: SelectedCard[]) => void
  /** Current section names, for the move submenu. */
  sections: () => string[]
  /** Move every selected card out of this list into another list. */
  moveToList: (cards: SelectedCard[], dest: ListRef) => void
  /** The other lists cards can be moved to, for the move-to-list submenu. */
  moveTargets: () => ListRef[]
}

/**
 * Shared controller for the flat-list editors (collections and wanted lists):
 * owns the entry card-data store, the {@link useEditor} instance, and the
 * quantity-stepper / context-menu / change-printing handlers. Collections and
 * wanted lists differ only in their entry shape and `applyChange`, so both drive
 * their UI from this generic controller.
 */
export type FlatListController<E extends FlatEntry> = SwapController & {
  editor: UseEditorResult<E[], E>
  cardData: EntryCardData
  cardActions: EntryCardDataActions
  modalCardKey: Accessor<string | null>
  setModalCardKey: (value: string | null) => void
  handleIncrement: (entry: E) => void
  handleDecrement: (entry: E) => void
  handleContextMenu: (info: CardContextInfo, rect: DOMRect) => void
  handleChangePrinting: () => void
  /** Move the context-menu's card (every copy of the tile) into another list. */
  handleMoveCardToList: (target: CardContextInfo, dest: ListRef) => void
  closeModal: () => void
  closeContextMenu: () => void
  /** Bulk edit operations over a multi-select of flat-list cards. */
  bulkEdit: FlatBulkEdit
}

type FlatListControllerParams<E extends FlatEntry> = {
  buildConfig: (cardActions: EntryCardDataActions) => ListEditorConfig<E[]>
  initialSlug?: string | null
  applyChange: ApplyChange<E[], FlatChangeInput>
  /** Printing fields (set/cn/finish/condition) to log when this entry is added or removed. */
  printingOf: (entry: E) => FlatPrinting
}

export function useFlatListEditController<E extends FlatEntry>(
  params: FlatListControllerParams<E>,
): FlatListController<E> {
  const [cardData, cardActions] = useEntryCardData()
  const [modalCardKey, setModalCardKey] = createSignal<string | null>(null)

  const pageConfig = params.buildConfig(cardActions)
  const editor = useEditor<E[], E>(
    {
      // Flat entries carry their language directly, so the controller supplies the
      // set-language original resolver; a page config may still override it.
      // `findEntryByIdOrName` owns the id-then-name rule this needs — including
      // the name agreement that keeps a recycled `&N` in the on-disk baseline
      // from answering for the card that used to hold it.
      findOriginalLanguage: (entries, cardName, cardId) =>
        findEntryByIdOrName(entries, cardName, cardId)?.language,
      ...pageConfig,
      copyModel: 'per-entry',
    },
    params.initialSlug,
  )

  const swap = createSwapController({
    editor,
    listType: entityListType(pageConfig.entityLabel),
    kind: 'flat',
    targetsOf: (entries) => flatSwapTargets(entries, cardData),
    applyChange: params.applyChange,
    // One entry per copy: a flat line always holds exactly one, and an
    // arriving copy never merges onto a standing line.
    quantityOf: () => 1,
    mergeTargetId: () => undefined,
  })

  const handleIncrement = (entry: E) => {
    const cardId = editor.pool.allocate()
    const p = params.printingOf(entry)
    // The new copy inherits the line's override — a copy of a `[proxy]` card is
    // a proxy — which is also what keeps increment and decrement opposites.
    const labels = entry.labels
    editor.changes.addCard(entry.name, { ...p, cardId, labels })
    editor.setData((prev) =>
      prev
        ? params.applyChange(prev, {
            action: 'add',
            cardName: entry.name,
            ...p,
            labels,
            cardId,
          })
        : prev,
    )
  }

  const handleDecrement = (entry: E) => {
    if (entry.cardId !== undefined) editor.pool.release(entry.cardId)
    const p = params.printingOf(entry)
    // The line's override rides the removal: a re-add under a different one is
    // not this removal undone, and must not cancel it out.
    editor.changes.removeCard(
      entry.name,
      { ...p, cardId: entry.cardId, labels: entry.labels },
      { ...entry },
    )
    editor.setData((prev) =>
      prev
        ? params.applyChange(prev, {
            action: 'remove',
            cardName: entry.name,
            set: p.set,
            collectorNumber: p.collectorNumber,
            cardId: entry.cardId,
            fileOrder: entry.fileOrder,
          })
        : prev,
    )
  }

  const closeContextMenu = () => editor.setContextMenuCard(null)

  const handleContextMenu = (info: CardContextInfo, rect: DOMRect) => {
    editor.setContextMenuCard({ ...info, anchorRect: rect })
  }

  const handleChangePrinting = () => {
    const menu = editor.contextMenuCard()
    editor.setContextMenuCard(null)
    if (menu) editor.startChangePrinting(menu)
  }

  // Emit one move-from per copy (flat lists hold one entry per copy, each with its
  // own cardId), updating the live data and freeing each id back to the pool. Each
  // copy keeps its own language, resolved per entry before that entry's move-from
  // removes it; a name-only card whose printing came from the picker has no entry
  // language, so the tuple's own stamp (a ja-only pick) wins as the fallback.
  const emitMove = (
    cardName: string,
    dest: ListRef,
    printing: PrintingTuple,
    cardIds: number[],
  ) => {
    batch(() => {
      for (const id of cardIds) {
        const language = entryByCardId(id)?.language ?? printing.language
        editor.changes.moveCardToList(cardName, dest, { ...printing, language, cardId: id })
        editor.setData((prev) =>
          prev
            ? params.applyChange(prev, {
                action: 'move-from',
                cardName,
                ...printing,
                language,
                cardId: id,
                to: dest,
              })
            : prev,
        )
        editor.pool.release(id)
      }
    })
  }

  const handleMoveCardToList = (target: CardContextInfo, dest: ListRef) => {
    closeContextMenu()
    void printingForMove(
      target.cardName,
      dest,
      currentPrintingOf(target),
      cardData.printings[target.cardName] ?? [],
    ).then((printing) => {
      if (printing) emitMove(target.cardName, dest, printing, target.cardIds)
    })
  }

  const closeModal = () => setModalCardKey(null)

  // Resolve a selection cardId back to its live entry — flat removals must target
  // the specific copy, since each copy is its own entry with its own printing.
  const entryByCardId = (id: number): E | undefined => editor.data()?.find((e) => e.cardId === id)

  // The entry to add another copy of: prefer a live entry, else synthesize one from
  // the selection's captured printing (DEFAULT_SECTION when its section is unknown).
  const entryToAdd = (c: SelectedCard): E => {
    const live = c.cardIds.map(entryByCardId).find((e): e is E => e !== undefined)
    if (live) return live
    return {
      name: c.name,
      cardId: c.cardIds[0],
      section: DEFAULT_SECTION,
      set: c.set,
      collectorNumber: c.collectorNumber,
      finish: c.finish,
      condition: c.condition,
      note: c.note,
    } as E
  }

  const bulkEdit: FlatBulkEdit = {
    addCopy: (cards) => {
      for (const c of cards) handleIncrement(entryToAdd(c))
    },
    removeCopy: (cards) => {
      // One copy per tile: the first resolvable entry.
      for (const c of cards) {
        const entry = c.cardIds.map(entryByCardId).find((e): e is E => e !== undefined)
        if (entry) handleDecrement(entry)
      }
    },
    removeAll: (cards) => {
      for (const c of cards) {
        for (const id of c.cardIds) {
          const entry = entryByCardId(id)
          if (entry) handleDecrement(entry)
        }
      }
    },
    setFinish: (cards, finish) => {
      for (const c of cards) {
        if (!c.scryfallCard?.finishes?.includes(finish)) continue
        for (const id of c.cardIds) editor.handleSetFinishFor(c.name, finish, id)
      }
    },
    canSetFinish: (cards, finish) => {
      // Read unconditionally rather than through `entryByCardId` inside the
      // loop: `every` short-circuits, so a first card that fails would leave the
      // caller's memo subscribed to the selection but not to the list data.
      const entries = editor.data() ?? []
      return (
        cards.length > 0 &&
        cards.every((c) => {
          if (!c.scryfallCard?.finishes?.includes(finish)) return false
          return c.cardIds.length === 0
            ? canSetFinish(c, finish)
            : c.cardIds.every((id) =>
                canSetFinish(entries.find((e) => e.cardId === id) ?? c, finish),
              )
        })
      )
    },
    setLanguage: (cards, language) => {
      batch(() => {
        for (const c of cards) {
          for (const id of c.cardIds) editor.handleSetLanguageFor(c.name, language, id)
        }
      })
    },
    ...sharedBulkEdit(editor),
    moveToList: (cards, dest) =>
      bulkMoveToList(cards, dest, (c, to, printing) => emitMove(c.name, to, printing, c.cardIds)),
  }

  return {
    editor,
    cardData,
    cardActions,
    modalCardKey,
    setModalCardKey,
    handleIncrement,
    handleDecrement,
    handleContextMenu,
    handleChangePrinting,
    handleMoveCardToList,
    closeModal,
    bulkEdit,
    closeContextMenu,
    ...swap,
  }
}

type FlatListContextMenuProps<E extends FlatEntry> = {
  ctrl: FlatListController<E>
  /** Open the "Swap Printings" wizard on the targeted card. Collection editors only. */
  onSwapPrinting?: (target: CardContextInfo) => void
  /** Open the label picker for the targeted card. Collection editors only. */
  onSetLabel?: (target: CardContextInfo) => void
  /** Open the custom-art dialog for the targeted card. Admin editors only. */
  onSetCustomArt?: (target: CardContextInfo) => void
}

/** The flat-list context menu (foil, change printing, section moves) — no commander. */
export function FlatListContextMenu<E extends FlatEntry>(
  props: FlatListContextMenuProps<E>,
): JSX.Element {
  const editor = props.ctrl.editor
  return (
    <Show when={editor.contextMenuCard()}>
      {(menu) => {
        // The live entry behind the tile, resolved by its own `&N` — the menu's
        // captured snapshot goes stale the moment an edit lands while it is
        // open, and a name lookup answers for the wrong copy when the list
        // holds the same card twice.
        // Memoized, and falling back to the menu's own snapshot only when the
        // entry has left the list — see the deck controller's twin.
        const target = createMemo(
          () =>
            findEntryByIdOrName(editor.data() ?? [], menu().cardName, menu().cardIds[0]) ?? menu(),
        )
        return (
          <CardContextMenu
            cardName={menu().cardName}
            card={menu().card}
            currentFinish={target().finish}
            onSetFoil={editor.handleSetFoil}
            printingAction={{
              onSelect: props.ctrl.handleChangePrinting,
              get hasPrinting() {
                return hasSpecificPrinting(target())
              },
            }}
            onSwapPrinting={
              props.onSwapPrinting
                ? () => {
                    const apply = props.onSwapPrinting
                    if (!apply) return
                    // The menu's snapshot, captured before the close unmounts it
                    // (and its props); the wizard re-resolves the copies by `&N`.
                    const info = menu()
                    props.ctrl.closeContextMenu()
                    apply(info)
                  }
                : undefined
            }
            onSetLabel={
              props.onSetLabel
                ? () => {
                    const apply = props.onSetLabel
                    if (!apply) return
                    const target = menu()
                    props.ctrl.closeContextMenu()
                    apply(target)
                  }
                : undefined
            }
            // Offered for a card added this session too: its art is held with
            // the pending changes and written by the save that gives the line its
            // `&N` (see `pending-art.ts`). Only a tile with no id at all —
            // nothing to key art by — hides the item.
            onSetCustomArt={
              props.onSetCustomArt && menu().cardIds[0] !== undefined
                ? () => {
                    const apply = props.onSetCustomArt
                    if (!apply) return
                    const target = menu()
                    props.ctrl.closeContextMenu()
                    apply(target)
                  }
                : undefined
            }
            onSetLanguage={() => {
              const target = menu()
              // The tile's current language, for marking in the picker. The exact
              // copy (by cardId) must win outright before any name fallback, or a
              // [ja] copy behind an English copy of the same card would mark
              // English as current.
              const current = findEntryByIdOrName(
                editor.data() ?? [],
                target.cardName,
                target.cardIds[0],
              )?.language
              props.ctrl.closeContextMenu()
              promptCardLanguage(current, (language) => {
                batch(() => {
                  for (const id of target.cardIds) {
                    editor.handleSetLanguageFor(target.cardName, language, id)
                  }
                })
              })
            }}
            onUnsetCommander={props.ctrl.closeContextMenu}
            anchorRect={menu().anchorRect}
            onClose={props.ctrl.closeContextMenu}
            hideCommander={true}
            onMoveToSection={() => {
              const target = menu()
              const d = editor.data()
              const current = d ? sectionOfTarget(d, target) : undefined
              props.ctrl.closeContextMenu()
              promptSectionMove(
                editor.sectionOrder().filter((s) => s !== current),
                (section) => editor.handleMoveCardToSection(target, section),
                () => editor.promptNewSectionForCard(target),
              )
            }}
            moveTargets={editor.moveTargets()}
            onMoveToList={() => {
              const target = menu()
              props.ctrl.closeContextMenu()
              promptListMove(editor.moveTargets(), (dest) =>
                props.ctrl.handleMoveCardToList(target, dest),
              )
            }}
          />
        )
      }}
    </Show>
  )
}

type FlatListEditorShellProps<E extends FlatEntry> = {
  ctrl: FlatListController<E>
  entityLabel: EditorEntity
  selectorId: string
  defaults: UseEditorDefaultsResult
  search: SearchProvider
  requirePrinting: boolean
  showSave?: boolean
  showDiscard?: boolean
  enableImport?: boolean
  importKind?: ListType
  /** Open the label picker for a context-menu card. Collection editors only. */
  onSetLabel?: (target: CardContextInfo) => void
  /** Open the custom-art dialog for a context-menu card. Admin editors only. */
  onSetCustomArt?: (target: CardContextInfo) => void
  /** Open the list-default label editor (admin collection editor only). */
  onEditLabels?: () => void
  /** Open the list's cover-image editor (admin editors only). */
  onEditImage?: () => void
  /** The "Swap Printings" wizard's props; mounts the wizard (collection editors only). */
  swap?: SwapPrintingsWizardProps
  /** Offer the whole-list swap from the action bar (admin collection editor). */
  onSwapPrintings?: () => void
  /** Open the wizard on one context-menu card (collection editors only). */
  onSwapPrinting?: (target: CardContextInfo) => void
  /** The page, rendered with the loaded entries (see {@link EditorShell}'s `children`). */
  children: (entries: Accessor<E[]>) => JSX.Element
}

/** The {@link EditorShell} configured for a flat list, wrapping a caller-supplied page. */
export function FlatListEditorShell<E extends FlatEntry>(
  props: FlatListEditorShellProps<E>,
): JSX.Element {
  return (
    <EditorShell
      entityLabel={props.entityLabel}
      selectorId={props.selectorId}
      editor={props.ctrl.editor}
      cardData={props.ctrl.cardData}
      search={props.search}
      defaults={props.defaults}
      requirePrinting={props.requirePrinting}
      showSave={props.showSave}
      showDiscard={props.showDiscard}
      enableImport={props.enableImport}
      importKind={props.importKind}
      onEditLabels={props.onEditLabels}
      onEditImage={props.onEditImage}
      // Art is offered at add time exactly where a card's art can be written:
      // the same authed route behind the context menu's "Set Custom Art…".
      enableAddArt={props.onSetCustomArt !== undefined}
      swap={props.swap}
      onSwapPrintings={props.onSwapPrintings}
      contextMenu={
        <FlatListContextMenu
          ctrl={props.ctrl}
          onSwapPrinting={props.onSwapPrinting}
          onSetLabel={props.onSetLabel}
          onSetCustomArt={props.onSetCustomArt}
        />
      }
    >
      {props.children}
    </EditorShell>
  )
}
