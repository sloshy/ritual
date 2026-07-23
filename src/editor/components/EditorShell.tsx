import { type JSX, Show, For, createSignal } from 'solid-js'
import type { ScryfallCard } from '../../types'
import type { UseEditorResult, ListItem } from '../useEditor'
import type { UseEditorDefaultsResult } from '../useEditorDefaults'
import type { SearchProvider } from '../search-provider'
import type { ListType } from '../../list-type'
import { ChangesDialog } from './ChangesDialog'
import { ImportChangesDialog } from './ImportChangesDialog'
import { DiscardConfirmDialog } from './DiscardConfirmDialog'
import { CardSearchModal } from './CardSearchModal'
import { ChangePrintingQuantityDialog } from './ChangePrintingQuantityDialog'
import { EditorActionBar, focusActionBar } from './EditorActionBar'
import { TextPromptDialog } from './TextPromptDialog'
import { ShortcutsDialog } from './ShortcutsDialog'
import { useEditorShortcuts } from '../useEditorShortcuts'

type BaseCardData = {
  cards: Record<string, ScryfallCard | null>
  printings: Record<string, ScryfallCard[]>
  symbolMap: Record<string, string>
}

type EditorShellProps<TData, TCardEntry> = {
  /** Lowercase entity noun for status text (e.g. "deck", "wanted list"). */
  entityLabel: string
  selectorId: string
  selectorLabel: string
  selectorPlaceholder: string
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
  contextMenu?: JSX.Element
  children: JSX.Element
}

export function EditorShell<TData, TCardEntry>(
  props: EditorShellProps<TData, TCardEntry>,
): JSX.Element {
  const editor = props.editor
  let actionBarEl: HTMLDivElement | undefined
  const [showShortcuts, setShowShortcuts] = createSignal(false)

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
            {props.selectorLabel}
          </label>
          <select
            id={props.selectorId}
            class="deck-selector"
            value={editor.slug() ?? ''}
            onChange={editor.handleSelect}
          >
            <option value="">— {props.selectorPlaceholder} —</option>
            <For each={editor.list()}>
              {(item: ListItem) => <option value={item.slug}>{item.name}</option>}
            </For>
          </select>
        </div>
      </Show>

      {/* Status messages */}
      <Show when={editor.status.error}>
        <div class="alert alert-error">{editor.status.error}</div>
      </Show>
      <Show when={editor.status.saveStatus}>
        <div class="alert alert-success">{editor.status.saveStatus}</div>
      </Show>
      <Show when={editor.status.loading}>
        <p class="text-muted">Loading {props.entityLabel}...</p>
      </Show>

      {/* Content slot */}
      <Show when={editor.isDataReady()}>{props.children}</Show>

      {/* Context menu slot */}
      {props.contextMenu}

      {/* Card search modal */}
      <CardSearchModal
        open={editor.dialogs.showSearchModal()}
        onClose={editor.dialogs.closeSearchModal}
        onAddCard={(cardName, options, scryfallCard, allPrintings) =>
          void editor.handleAddCardFromSearch(cardName, options, scryfallCard, allPrintings)
        }
        search={props.search}
        requirePrinting={props.requirePrinting}
        defaults={props.defaults.defaults()}
      />

      {/* Change-printing flow: optional quantity prompt, then the printing picker
          (the add-card dialog reused at its printing step). */}
      <ChangePrintingQuantityDialog
        open={editor.changePrinting()?.step === 'quantity'}
        cardName={editor.changePrinting()?.target.cardName ?? ''}
        total={editor.changePrinting()?.target.quantity ?? 1}
        onConfirm={editor.confirmChangePrintingCount}
        onCancel={editor.cancelChangePrinting}
      />
      <CardSearchModal
        open={editor.changePrinting()?.step === 'printing'}
        initialCardName={editor.changePrinting()?.target.cardName}
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
            onImport={(changes) => editor.importChanges(changes)}
          />
        )}
      </Show>

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
          onShowShortcuts={() => setShowShortcuts(true)}
          onImport={props.enableImport ? editor.dialogs.openImport : undefined}
          showSave={props.showSave}
          showDiscard={props.showDiscard}
          barRef={(el) => (actionBarEl = el)}
        />
      </Show>
    </div>
  )
}
