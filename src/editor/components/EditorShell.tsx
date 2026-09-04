import { type Accessor, type JSX, Show, For, createMemo, createSignal } from 'solid-js'
import type { ScryfallCard } from '../../scryfall/types'
import type { UseEditorResult, ListItem } from '../editor-config'
import type { UseEditorDefaultsResult } from '../useEditorDefaults'
import type { SearchProvider } from '../search-provider'
import type { ListType } from '../../list/list-type'

import { ChangesDialog } from './ChangesDialog'
import { ImportChangesDialog } from './ImportChangesDialog'
import { DiscardConfirmDialog } from './DiscardConfirmDialog'
import { CardSearchModal } from './CardSearchModal'
import type { AddCardOptionsConfig } from './AddCardOptions'
import { ChangePrintingQuantityDialog } from './ChangePrintingQuantityDialog'
import { EditorActionBar, focusActionBar } from './EditorActionBar'
import { SwapPrintingsWizard, type SwapPrintingsWizardProps } from './SwapPrintingsWizard'
import { TextPromptDialog } from './TextPromptDialog'
import { TagsEditDialog } from './TagsEditDialog'
import { CategoriesEditDialog } from './CategoriesEditDialog'
import { categoryManagerOrder, categoryUsageCount } from '../card-categories-edit'
import type { CategoryManagerRow } from './EditorActionBar'
import { ShortcutsDialog } from './ShortcutsDialog'
import { StatusToast } from '../../ui/StatusToast'
import { useEditorShortcuts } from '../useEditorShortcuts'
import { type EditorEntity, entityListType } from '../entity'
import { renderStatus } from '../useEditorStatus'
import { hasSpecificPrinting } from '../../card/card-printing'
import { useT, useTDynamic } from '../../ui/i18n'

type BaseCardData = {
  cards: Record<string, ScryfallCard | null>
  printings: Record<string, ScryfallCard[]>
  symbolMap: Record<string, string>
}

type EditorShellProps<TData, TCardEntry> = {
  /** Which kind of list is being edited; names it in the loading placeholder. */
  entityLabel: EditorEntity
  selectorId: string
  editor: UseEditorResult<TData, TCardEntry>
  cardData: BaseCardData
  /** Backend resolving card search (admin API or Scryfall), forwarded to the search modals. */
  search: SearchProvider
  requirePrinting?: boolean
  /**
   * Defaults state for batch card entry. The `kind` field also drives whether
   * condition is tracked (wanted lists do not).
   */
  defaults: UseEditorDefaultsResult
  /** Show the action bar's Save button. Defaults to true; the public editor exports via its banner. */
  showSave?: boolean
  /** Show the action bar's Discard button. Defaults to true; the public editor discards via its banner. */
  showDiscard?: boolean
  /** Enable the admin-only "Import…" button + dialog for loading exported change files. */
  enableImport?: boolean
  /** The list kind for import validation; required when `enableImport` is set. */
  importKind?: ListType
  /** Open the list-default label editor (admin collection editor only). */
  onEditLabels?: () => void
  /** Open the list's cover-image editor (admin editors only). */
  onEditImage?: () => void
  /**
   * Offer custom art in the add dialog. Set by the hosts that can actually write
   * it — the admin editors, whose art route the staged reference is flushed to.
   * The label row needs no flag: labels ride the `add` event, so they travel in
   * the public editor's exported changes too.
   */
  enableAddArt?: boolean
  /**
   * Open the "Swap Printings" wizard over the whole list from the action bar.
   * Admin hosts pass it; the public editor reaches the wizard from the navbar's
   * edit row and leaves this unset.
   */
  onSwapPrintings?: () => void
  /** The swap wizard's props; the wizard is mounted only when present (deck and collection editors). */
  swap?: SwapPrintingsWizardProps
  contextMenu?: JSX.Element
  /**
   * The page, rendered once the list is loaded and non-empty with the data it
   * shows — non-null by construction, so no body has to assert it.
   */
  children: (data: Accessor<TData>) => JSX.Element
}

export function EditorShell<TData, TCardEntry>(
  props: EditorShellProps<TData, TCardEntry>,
): JSX.Element {
  const editor = props.editor
  const t = useT()
  const tDyn = useTDynamic()
  const listType = (): ListType => entityListType(props.entityLabel)
  let actionBarEl: HTMLDivElement | undefined
  const [showShortcuts, setShowShortcuts] = createSignal(false)

  /** The Manage-categories rows: the list's vocabulary with each name's usage count. */
  const categoryRows = createMemo((): CategoryManagerRow[] => {
    const record = editor.categoriesRecord()
    return categoryManagerOrder(record).map((name) => ({
      name,
      count: categoryUsageCount(record, name),
    }))
  })

  // Whether the change-printing flow's target already pins a printing — false
  // both when it does not and when no flow is running (the dialogs are closed).
  const changePrintingTargetPinned = createMemo(() => {
    const target = editor.changePrinting()?.target
    return target !== undefined && hasSpecificPrinting(target)
  })

  // The add dialog's per-card options, derived from what this list is: only the
  // add flow gets them, so the change-printing modal below is left without.
  const addOptions = createMemo<AddCardOptionsConfig>(() => ({
    listType: listType(),
    enableArt: props.enableAddArt === true,
  }))

  useEditorShortcuts({
    onAddCard: () => editor.dialogs.openSearchModal(),
    onFocusActionBar: () => focusActionBar(actionBarEl),
    onShowShortcuts: () => setShowShortcuts(true),
  })

  return (
    <div>
      {/* Selector dropdown (hidden for the public single-item editor) */}
      <Show when={editor.showSelector}>
        <div class="deck-selector-container">
          <label class="deck-selector-label" for={props.selectorId}>
            {t('ui.editor.selectorLabel', { listType: listType() })}
          </label>
          <select
            id={props.selectorId}
            class="deck-selector"
            value={editor.slug() ?? ''}
            onChange={editor.handleSelect}
          >
            <option value="">
              — {t('ui.editor.selectorPlaceholder', { listType: listType() })} —
            </option>
            <For each={editor.list()}>
              {(item: ListItem) => <option value={item.slug}>{item.name}</option>}
            </For>
          </select>
        </div>
      </Show>

      {/* Status messages. Floated over the viewport rather than left at the top
          of the page: a list is long, and a save result the reader has to scroll
          up to find is a save result they never see. */}
      <StatusToast
        error={editor.status.error}
        status={editor.status.saveStatus}
        render={(message) => renderStatus(tDyn, message)}
      />
      <Show when={editor.status.loading}>
        <p class="text-muted">{t('ui.editor.loading', { listType: listType() })}</p>
      </Show>

      {/* Content slot */}
      <Show when={editor.isDataReady() ? editor.data() : null}>
        {(data) => props.children(data)}
      </Show>

      {/* Context menu slot */}
      {props.contextMenu}

      {/* Card search modal */}
      <CardSearchModal
        open={editor.dialogs.showSearchModal()}
        onClose={editor.dialogs.closeSearchModal}
        onAddCard={(...args) => void editor.handleAddCardFromSearch(...args)}
        search={props.search}
        requirePrinting={props.requirePrinting}
        defaults={props.defaults.defaults()}
        addOptions={addOptions()}
      />

      {/* Change-printing flow: optional quantity prompt, then the printing picker
          (the add-card dialog reused at its printing step). */}
      <ChangePrintingQuantityDialog
        open={editor.changePrinting()?.step === 'quantity'}
        cardName={editor.changePrinting()?.target.cardName ?? ''}
        hasPrinting={changePrintingTargetPinned()}
        total={editor.changePrinting()?.target.quantity ?? 1}
        onConfirm={editor.confirmChangePrintingCount}
        onCancel={editor.cancelChangePrinting}
      />
      <CardSearchModal
        open={editor.changePrinting()?.step === 'printing'}
        initialCardName={editor.changePrinting()?.target.cardName}
        targetHasPrinting={changePrintingTargetPinned()}
        onClose={editor.cancelChangePrinting}
        onAddCard={(_cardName, options, scryfallCard, allPrintings) =>
          editor.handleChangePrintingSelect(options, scryfallCard, allPrintings)
        }
        search={props.search}
        requirePrinting={props.requirePrinting}
        defaults={props.defaults.defaults()}
      />

      {/* Changes dialog */}
      <ChangesDialog
        open={editor.dialogs.showChanges()}
        changes={editor.changes.changes()}
        cards={props.cardData.cards}
        printings={props.cardData.printings}
        symbolMap={props.cardData.symbolMap}
        currency={editor.currency()}
        onClose={editor.dialogs.closeChanges}
      />

      {/* Discard confirm dialog */}
      <DiscardConfirmDialog
        open={editor.dialogs.showDiscard()}
        changes={editor.changes.changes()}
        onConfirm={editor.handleDiscard}
        onCancel={editor.handleCancelDiscard}
      />

      {/* Import changes dialog (admin only) */}
      <Show when={props.enableImport && props.importKind}>
        {(kind) => (
          <ImportChangesDialog
            open={editor.dialogs.showImport()}
            onClose={editor.dialogs.closeImport}
            expectedKind={kind()}
            expectedSlug={editor.slug() ?? undefined}
            expectedName={editor.list().find((item) => item.slug === editor.slug())?.name}
            onImport={(changes) => editor.importChanges(changes)}
          />
        )}
      </Show>

      {/* Batch "Swap Printings" wizard (deck and collection editors). The
          host's props object carries getters (see `createSwapController`), and
          a component spread is reactive — `mergeProps` reads its keys lazily —
          so `request` keeps updating while the wizard is mounted. */}
      <Show when={props.swap}>{(swap) => <SwapPrintingsWizard {...swap()} />}</Show>

      {/* Keyboard shortcuts reference */}
      <ShortcutsDialog open={showShortcuts()} onClose={() => setShowShortcuts(false)} />

      {/* Section-naming prompt (new section / rename), replacing native window.prompt */}
      <TextPromptDialog
        open={editor.textPrompt() !== null}
        title={editor.textPrompt()?.title ?? ''}
        label={editor.textPrompt()?.label ?? ''}
        initialValue={editor.textPrompt()?.initialValue ?? ''}
        confirmLabel={editor.textPrompt()?.confirmLabel ?? ''}
        validate={editor.textPrompt()?.validate}
        onConfirm={(v) => editor.textPrompt()?.onConfirm(v)}
        onCancel={editor.closeTextPrompt}
      />

      {/* "Edit Tags…" dialog, driven by the `tags-prompt` singleton the card
          context menus open (they unmount as they act, so the request lives
          outside them) */}
      <TagsEditDialog />

      {/* "Edit Categories…" dialog, driven by the `categories-prompt` singleton
          the same card context menus open */}
      <CategoriesEditDialog />

      {/* Action bar */}
      <Show when={editor.isDataReady()}>
        <EditorActionBar
          changeCount={editor.changes.changeCount()}
          canUndo={editor.changes.canUndo()}
          saving={editor.status.saving}
          defaults={props.defaults}
          sections={editor.sectionInfo()}
          onAddCard={editor.dialogs.openSearchModal}
          onShowChanges={editor.dialogs.openChanges}
          onUndo={editor.handleUndo}
          onSave={() => void editor.handleSave()}
          onDiscard={editor.dialogs.openDiscard}
          onAddSection={editor.handleAddSection}
          onRequestRename={editor.promptRenameSection}
          onRemoveSection={editor.handleRemoveSection}
          categories={categoryRows()}
          onSetCategoryOrder={editor.handleSetCategoryOrder}
          onRequestRenameCategory={editor.promptRenameCategory}
          onRemoveCategory={editor.handleRemoveCategory}
          onShowShortcuts={() => setShowShortcuts(true)}
          onImport={props.enableImport ? editor.dialogs.openImport : undefined}
          onSwapPrintings={props.onSwapPrintings}
          onEditLabels={props.onEditLabels}
          onEditImage={props.onEditImage}
          showSave={props.showSave}
          showDiscard={props.showDiscard}
          barRef={(el) => (actionBarEl = el)}
        />
      </Show>
    </div>
  )
}
