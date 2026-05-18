import { type JSX, Show, For } from 'solid-js'
import type { ScryfallCard } from '../../../types'
import type { UseEditorResult, ListItem } from '../hooks/useEditor'
import type { UseEditorDefaultsResult } from '../hooks/useEditorDefaults'
import { ChangesDialog } from './ChangesDialog'
import { DiscardConfirmDialog } from './DiscardConfirmDialog'
import { CardSearchModal } from './CardSearchModal'
import { EditorActionBar } from './EditorActionBar'
import { EditorDefaultsBar } from './EditorDefaultsBar'

type BaseCardData = {
  cards: Record<string, ScryfallCard | null>
  printings: Record<string, ScryfallCard[]>
  symbolMap: Record<string, string>
}

type EditorShellProps<TData, TCardEntry> = {
  heading: string
  selectorId: string
  selectorLabel: string
  selectorPlaceholder: string
  editor: UseEditorResult<TData, TCardEntry>
  cardData: BaseCardData
  requirePrinting?: boolean
  /**
   * Defaults state for batch card entry. The `kind` field also drives whether
   * condition is tracked (wanted lists do not).
   */
  defaults: UseEditorDefaultsResult
  contextMenu?: JSX.Element
  children: JSX.Element
}

export function EditorShell<TData, TCardEntry>(
  props: EditorShellProps<TData, TCardEntry>,
): JSX.Element {
  const editor = props.editor

  return (
    <div>
      <h2 class="section-heading">{props.heading}</h2>

      {/* Selector dropdown */}
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

      {/* Add-card defaults */}
      <EditorDefaultsBar
        defaults={props.defaults}
        showCondition={props.defaults.kind !== 'wanted'}
      />

      {/* Status messages */}
      <Show when={editor.status.error}>
        <div class="alert alert-error">{editor.status.error}</div>
      </Show>
      <Show when={editor.status.saveStatus}>
        <div class="alert alert-success">{editor.status.saveStatus}</div>
      </Show>
      <Show when={editor.status.loading}>
        <p class="text-muted">Loading {props.heading.toLowerCase().replace(' editor', '')}...</p>
      </Show>

      {/* Content slot */}
      <Show when={editor.isDataReady()}>{props.children}</Show>

      {/* Context menu slot */}
      {props.contextMenu}

      {/* Card search modal */}
      <CardSearchModal
        open={editor.dialogs.showSearchModal()}
        onClose={editor.dialogs.closeSearchModal}
        onAddCard={(card) => void editor.handleAddCardFromSearch(card)}
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
        currency={editor.currency}
        onClose={editor.dialogs.closeChanges}
      />

      {/* Discard confirm dialog */}
      <DiscardConfirmDialog
        open={editor.dialogs.showDiscard()}
        changes={editor.changes.changes()}
        onConfirm={editor.handleDiscard}
        onCancel={editor.dialogs.closeDiscard}
      />

      {/* Action bar */}
      <Show when={editor.isDataReady()}>
        <EditorActionBar
          changeCount={editor.changes.changeCount()}
          canUndo={editor.changes.canUndo()}
          saving={editor.status.saving}
          onShowChanges={editor.dialogs.openChanges}
          onUndo={editor.handleUndo}
          onSave={() => void editor.handleSave()}
          onDiscard={editor.dialogs.openDiscard}
        />
      </Show>
    </div>
  )
}
