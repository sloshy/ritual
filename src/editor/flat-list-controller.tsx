import { type Accessor, type JSX, Show, batch, createSignal } from 'solid-js'
import { type Finish, type Condition, DEFAULT_SECTION } from '../types'
import type { ChangeInput, ListRef, PrintingTuple } from '../change-event'
import type { SelectedCard } from '../site/useCardSelection'
import type { CardContextInfo } from './context-menu'
import type { ListEditorConfig, UseEditorResult } from './useEditor'
import type { ListType } from '../list-type'
import { contextInfoFromSelected } from './selected-to-context'
import { printingForMove } from '../site/printing-prompt'
import { promptListMove, promptSectionMove } from '../site/move-prompt'
import { useEditor } from './useEditor'
import type { UseEditorDefaultsResult } from './useEditorDefaults'
import type { SearchProvider } from './search-provider'
import { useEntryCardData, type EntryCardData, type EntryCardDataActions } from './useEntryCardData'
import { sectionOfTarget } from './section-helpers'
import { CardContextMenu } from './components/CardContextMenu'
import { EditorShell } from './components/EditorShell'
import type { ApplyChange } from './apply-batch'

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
  note?: string
}

/** The printing fields logged when a flat entry is added or removed. */
export type FlatPrinting = {
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
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
  /** Run the change-printing flow over the selection one card at a time. */
  changePrinting: (cards: SelectedCard[]) => void
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
export type FlatListController<E extends FlatEntry> = {
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

  const editor = useEditor<E[], E>(
    { ...params.buildConfig(cardActions), copyModel: 'per-entry' },
    params.initialSlug,
  )

  const handleIncrement = (entry: E) => {
    const cardId = editor.pool.allocate()
    const p = params.printingOf(entry)
    editor.changes.addCard(entry.name, { ...p, cardId })
    editor.setData((prev) =>
      prev ? params.applyChange(prev, { action: 'add', cardName: entry.name, ...p, cardId }) : prev,
    )
  }

  const handleDecrement = (entry: E) => {
    if (entry.cardId !== undefined) editor.pool.release(entry.cardId)
    const p = params.printingOf(entry)
    editor.changes.removeCard(entry.name, { ...p, cardId: entry.cardId }, { ...entry })
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
  // own cardId), updating the live data and freeing each id back to the pool.
  const emitMove = (
    cardName: string,
    dest: ListRef,
    printing: PrintingTuple,
    cardIds: number[],
  ) => {
    batch(() => {
      for (const id of cardIds) {
        editor.changes.moveCardToList(cardName, dest, { ...printing, cardId: id })
        editor.setData((prev) =>
          prev
            ? params.applyChange(prev, {
                action: 'move-from',
                cardName,
                ...printing,
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
      {
        set: target.set,
        collectorNumber: target.collectorNumber,
        finish: target.finish,
        condition: target.condition,
      },
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
    changePrinting: (cards) => editor.startBulkChangePrinting(cards.map(contextInfoFromSelected)),
    moveToSection: (cards, section) =>
      editor.handleMoveCardsToSection(cards.map(contextInfoFromSelected), section),
    promptNewSection: (cards) =>
      editor.promptNewSectionForCards(cards.map(contextInfoFromSelected)),
    sections: () => editor.sectionOrder(),
    moveToList: (cards, dest) => {
      void (async () => {
        for (const c of cards) {
          const printing = await printingForMove(
            c.name,
            dest,
            {
              set: c.set,
              collectorNumber: c.collectorNumber,
              finish: c.finish,
              condition: c.condition,
            },
            c.printings ?? [],
          )
          if (printing) emitMove(c.name, dest, printing, c.cardIds)
        }
      })()
    },
    moveTargets: () => editor.moveTargets(),
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
  }
}

type FlatListContextMenuProps<E extends FlatEntry> = { ctrl: FlatListController<E> }

/** The flat-list context menu (foil, change printing, section moves) — no commander. */
export function FlatListContextMenu<E extends FlatEntry>(
  props: FlatListContextMenuProps<E>,
): JSX.Element {
  const editor = props.ctrl.editor
  return (
    <Show when={editor.contextMenuCard()}>
      {(menu) => (
        <CardContextMenu
          cardName={menu().cardName}
          card={menu().card}
          currentFinish={editor.data()?.find((e) => e.name === menu().cardName)?.finish}
          onSetFoil={editor.handleSetFoil}
          onChangePrinting={props.ctrl.handleChangePrinting}
          onUnsetCommander={props.ctrl.closeContextMenu}
          anchorRect={menu().anchorRect}
          onClose={props.ctrl.closeContextMenu}
          hideCommander={true}
          onMoveToSection={() => {
            const target = menu()
            const current = editor.data() ? sectionOfTarget(editor.data()!, target) : undefined
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
      )}
    </Show>
  )
}

type FlatListEditorShellProps<E extends FlatEntry> = {
  ctrl: FlatListController<E>
  entityLabel: string
  selectorId: string
  selectorLabel: string
  selectorPlaceholder: string
  defaults: UseEditorDefaultsResult
  search: SearchProvider
  requirePrinting: boolean
  showSave?: boolean
  showDiscard?: boolean
  enableImport?: boolean
  importKind?: ListType
  children: JSX.Element
}

/** The {@link EditorShell} configured for a flat list, wrapping a caller-supplied page. */
export function FlatListEditorShell<E extends FlatEntry>(
  props: FlatListEditorShellProps<E>,
): JSX.Element {
  return (
    <EditorShell
      entityLabel={props.entityLabel}
      selectorId={props.selectorId}
      selectorLabel={props.selectorLabel}
      selectorPlaceholder={props.selectorPlaceholder}
      editor={props.ctrl.editor}
      cardData={props.ctrl.cardData}
      search={props.search}
      defaults={props.defaults}
      requirePrinting={props.requirePrinting}
      showSave={props.showSave}
      showDiscard={props.showDiscard}
      enableImport={props.enableImport}
      importKind={props.importKind}
      contextMenu={<FlatListContextMenu ctrl={props.ctrl} />}
    >
      {props.children}
    </EditorShell>
  )
}
