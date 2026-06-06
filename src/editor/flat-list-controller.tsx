import { type Accessor, type JSX, Show, createSignal } from 'solid-js'
import type { Finish, Condition } from '../types'
import type { ChangeInput } from '../change-event'
import type { CardContextInfo } from './context-menu'
import type { EditorConfig, UseEditorResult } from './useEditor'
import type { ChangeFileKind } from './change-file'
import { useEditor } from './useEditor'
import type { UseEditorDefaultsResult } from './useEditorDefaults'
import type { SearchProvider } from './search-provider'
import { useEntryCardData, type EntryCardData, type EntryCardDataActions } from './useEntryCardData'
import { sectionOfTarget } from './section-helpers'
import { CardContextMenu } from './components/CardContextMenu'
import { EditorShell } from './components/EditorShell'

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
  closeModal: () => void
  closeContextMenu: () => void
}

type FlatListControllerParams<E extends FlatEntry> = {
  buildConfig: (cardActions: EntryCardDataActions) => EditorConfig<E[]>
  initialSlug?: string | null
  applyChange: (entries: E[], change: FlatChangeInput) => E[]
  /** Printing fields (set/cn/finish/condition) to log when this entry is added or removed. */
  printingOf: (entry: E) => FlatPrinting
}

export function useFlatListEditController<E extends FlatEntry>(
  params: FlatListControllerParams<E>,
): FlatListController<E> {
  const [cardData, cardActions] = useEntryCardData()
  const [modalCardKey, setModalCardKey] = createSignal<string | null>(null)

  const editor = useEditor<E[], E>(params.buildConfig(cardActions), params.initialSlug)

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

  const closeModal = () => setModalCardKey(null)

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
    closeModal,
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
          sections={editor.sectionOrder()}
          currentSection={editor.data() ? sectionOfTarget(editor.data()!, menu()) : undefined}
          onMoveToSection={(section) => editor.handleMoveCardToSection(menu(), section)}
          onCreateSection={() => editor.promptNewSectionForCard(menu())}
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
  importKind?: ChangeFileKind
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
