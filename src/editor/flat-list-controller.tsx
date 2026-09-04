import { type Accessor, type JSX, Show, batch, createMemo, createSignal } from 'solid-js'
import type { Finish, Condition } from '../card/finish-condition'
import { DEFAULT_SECTION } from '../list/deck'
import type { CardLabel } from '../card/card-labels'
import type { CardLanguage } from '../card/card-language'
import type { CardTag } from '../card/card-tags'
import { bulkAddTags, tagSuggestions, type TagTarget } from './card-tags-edit'
import { promptCardTags } from './tags-prompt'
import { openCategoriesPrompt } from './card-categories-edit'
import { holdsCardName } from '../card/card-categories'
import type { ChangeInput, ListRef, PrintingTuple } from '../changes/change-event'
import type { SelectedCard } from '../list-view/useCardSelection'
import type { CardContextInfo } from '../list-view/card-context'
import type { BulkEditBundle } from '../list-view/selection-edit-actions'
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
  /** The line's `#tag` tokens in canonical form; absent when it carries none. */
  tags?: CardTag[]
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
export type FlatBulkEdit = Omit<BulkEditBundle, 'setCommander'>

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
  /**
   * A line's tags as the live data holds them now — what every tag edit seeds
   * from and consolidates against (see `card-tags-edit.ts`). Every copy of a
   * grouped tile shares them: differently-tagged copies never share a tile
   * (`duplicateGroupKey`). A card added this session may have no id yet; the
   * lookup then resolves the line by name.
   */
  liveTagsOf: (cardName: string, cardId?: number) => readonly CardTag[] | undefined
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
    // The new copy inherits the line's override and tags — a copy of a
    // `[proxy]` card is a proxy — which is also what keeps increment and
    // decrement opposites.
    const labels = entry.labels
    const tags = entry.tags
    editor.changes.addCard(entry.name, { ...p, cardId, labels, tags })
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

  /** Does the list still hold any line of `cardName`? (The shared fold rule.) */
  const listHoldsCardName = (entries: readonly E[], cardName: string): boolean =>
    holdsCardName(
      entries.map((entry) => entry.name),
      cardName,
    )

  const handleDecrement = (entry: E) => {
    if (entry.cardId !== undefined) editor.pool.release(entry.cardId)
    const p = params.printingOf(entry)
    // The line's override and tags ride the removal: a re-add under different
    // ones is not this removal undone, and must not cancel it out.
    editor.changes.removeCard(
      entry.name,
      { ...p, cardId: entry.cardId, labels: entry.labels, tags: entry.tags },
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
    // The removal took the list's last line of this name, so its pending
    // `set-categories` events no longer have a card — fold them onto the undo
    // entry the removal just pushed (the web half of `FoldOptions.goneCardName`).
    if (!listHoldsCardName(editor.data() ?? [], entry.name)) {
      editor.changes.foldGoneCardCategories(entry.name)
    }
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
  // copy keeps its own language and tags, resolved per entry before that entry's
  // move-from removes it; a name-only card whose printing came from the picker has
  // no entry language, so the tuple's own stamp (a ja-only pick) wins as the fallback.
  const emitMove = (
    cardName: string,
    dest: ListRef,
    printing: PrintingTuple,
    cardIds: number[],
  ) => {
    batch(() => {
      for (const id of cardIds) {
        const entry = entryByCardId(id)
        const language = entry?.language ?? printing.language
        const tags = entry?.tags
        editor.changes.moveCardToList(cardName, dest, { ...printing, language, tags, cardId: id })
        editor.setData((prev) =>
          prev
            ? params.applyChange(prev, {
                action: 'move-from',
                cardName,
                ...printing,
                language,
                tags,
                cardId: id,
                to: dest,
              })
            : prev,
        )
        editor.pool.release(id)
      }
      if (!listHoldsCardName(editor.data() ?? [], cardName)) {
        editor.changes.foldGoneCardCategories(cardName)
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

  const liveTagsOf = (cardName: string, cardId?: number): readonly CardTag[] | undefined =>
    findEntryByIdOrName(editor.data() ?? [], cardName, cardId)?.tags

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
    addTags: (cards, onApplied) =>
      bulkAddTags({
        suggestions: tagSuggestions(editor.data() ?? []),
        // One target per copy: each copy is its own entry with its own tags.
        targets: cards.flatMap((c): TagTarget[] =>
          c.cardIds.length > 0
            ? c.cardIds.map((cardId) => ({ cardName: c.name, cardId }))
            : [{ cardName: c.name }],
        ),
        liveTagsOf,
        setTags: editor.handleSetTagsFor,
        onApplied,
      }),
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
    liveTagsOf,
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
            onEditTags={() => {
              const target = menu()
              // The tile's live tags seed the field (see `liveTagsOf`).
              const current = props.ctrl.liveTagsOf(target.cardName, target.cardIds[0])
              props.ctrl.closeContextMenu()
              promptCardTags({
                mode: 'edit',
                current,
                suggestions: tagSuggestions(editor.data() ?? []),
                onSave: (tags) => {
                  // A card added this session may have no id yet; the editor
                  // then resolves the line by name.
                  const ids: readonly (number | undefined)[] =
                    target.cardIds.length > 0 ? target.cardIds : [undefined]
                  // The baseline is re-read per copy at save time, not the
                  // snapshot the dialog was seeded from: the delta decides
                  // which events exist, so it must be each copy's own live set.
                  batch(() => {
                    for (const id of ids) {
                      const live = props.ctrl.liveTagsOf(target.cardName, id)
                      editor.handleSetTagsFor(target.cardName, tags, live, id)
                    }
                  })
                },
              })
            }}
            onEditCategories={() => {
              const target = menu()
              props.ctrl.closeContextMenu()
              openCategoriesPrompt(editor, target.cardName)
            }}
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

export type FlatListEditorShellProps<E extends FlatEntry> = {
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
  // Every prop this shell forwards unchanged already carries the editor shell's
  // own name, so the spread says it once; what is left is what this layer
  // *decides* — the editor and card data off the controller, the add-time art
  // flag, and the flat-list context menu.
  return (
    <EditorShell
      {...props}
      editor={props.ctrl.editor}
      cardData={props.ctrl.cardData}
      // Art is offered at add time exactly where a card's art can be written:
      // the same authed route behind the context menu's "Set Custom Art…".
      enableAddArt={props.onSetCustomArt !== undefined}
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
