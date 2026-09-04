import { type Component, type JSX, For, Show, createSignal, createMemo, onCleanup } from 'solid-js'
import type { UseEditorDefaultsResult } from '../useEditorDefaults'
import { swapNeighbour } from '../../util/array'
import type { ManagerRow, SectionInfo } from '../editor-config'
import { EditorDefaultsForm } from './EditorDefaultsForm'
import { Modal } from '../../ui/Modal'
import { useT } from '../../ui/i18n'

type EditorActionBarProps = {
  changeCount: number
  canUndo: boolean
  saving: boolean
  defaults: UseEditorDefaultsResult
  sections: SectionInfo[]
  onAddCard: () => void
  onShowChanges: () => void
  onUndo: () => void
  onSave: () => void
  onDiscard: () => void
  onAddSection: (name: string) => void
  onRequestRename: (name: string) => void
  onRemoveSection: (name: string) => void
  /** The list's categories in display order, with the number of cards holding each. */
  categories: readonly CategoryManagerRow[]
  /** Replace the list's declared vocabulary order (one `set-category-order`). */
  onSetCategoryOrder: (order: string[]) => void
  /** Ask the shell's text prompt to rename a category across the whole list. */
  onRequestRenameCategory: (name: string) => void
  /** Remove a category from the list and from every card holding it. */
  onRemoveCategory: (name: string) => void
  /** Opens the keyboard shortcuts reference (also bound to `?`). */
  onShowShortcuts: () => void
  /** When provided, shows an "Import…" button (admin only) to load an exported change file. */
  onImport?: () => void
  /**
   * When provided, shows a "Swap Printings…" button opening the batch swap
   * wizard over the whole list (admin deck/collection editors; the public
   * editor offers it from the navbar's edit row instead).
   */
  onSwapPrintings?: () => void
  /**
   * When provided, shows a "Labels" button opening the list-default label
   * editor (admin collection editor only).
   */
  onEditLabels?: () => void
  /**
   * When provided, shows a "Cover Image…" button opening the list's cover-image
   * editor (admin editors only — the public editor has no metadata route to
   * write it through).
   */
  onEditImage?: () => void
  /** Show the primary Save button. Defaults to true; the public editor exports via its banner instead. */
  showSave?: boolean
  /** Show the Discard button. Defaults to true; the public editor discards via its banner instead. */
  showDiscard?: boolean
  /**
   * Ref for the bar element itself — used by the Ctrl+B shortcut to focus its
   * first button. Called with `undefined` when the bar unmounts (the editor
   * hides it while a list loads), so the owner never holds a detached node.
   */
  barRef?: (el: HTMLDivElement | undefined) => void
}

/** One row of the Manage-categories modal — the shared manager-row model. */
export type CategoryManagerRow = ManagerRow

/** The bar's enabled buttons, in visual order. */
function barButtons(bar: HTMLElement): HTMLButtonElement[] {
  return [...bar.querySelectorAll<HTMLButtonElement>('button:not([disabled])')]
}

/**
 * Move focus to the first enabled button of `bar`. Exported so the editor shell
 * can drive it from a keyboard shortcut without reaching into the bar's markup.
 */
export function focusActionBar(bar: HTMLElement | undefined): void {
  if (!bar) return
  barButtons(bar)[0]?.focus()
}

/** The row names, in display order — the array a reorder swaps within. */
function namesOf(rows: readonly CategoryManagerRow[]): string[] {
  return rows.map((row) => row.name)
}

export const EditorActionBar: Component<EditorActionBarProps> = (props) => {
  const t = useT()
  const [defaultsOpen, setDefaultsOpen] = createSignal(false)
  const [sectionsOpen, setSectionsOpen] = createSignal(false)
  const [categoriesOpen, setCategoriesOpen] = createSignal(false)
  const [newSectionName, setNewSectionName] = createSignal('')
  // Condition is tracked for every list kind except wanted lists; derive it
  // from the defaults discriminant rather than threading a separate prop.
  const showCondition = () => props.defaults.kind !== 'wanted'

  const trimmedName = () => newSectionName().trim()
  // The existing section whose name matches the draft case-insensitively (its canonical casing),
  // or undefined when the draft is free. Drives the duplicate highlight and the disabled state.
  const duplicateOf = createMemo(() => {
    const lower = trimmedName().toLowerCase()
    if (!lower) return undefined
    return props.sections.find((s) => s.name.toLowerCase() === lower)?.name
  })
  const canAddSection = () => trimmedName() !== '' && !duplicateOf()

  const submitNewSection = () => {
    if (!canAddSection()) return
    props.onAddSection(trimmedName())
    setNewSectionName('')
  }

  const closeSections = () => {
    setNewSectionName('')
    setSectionsOpen(false)
  }

  /**
   * Roving keyboard navigation once focus is in the bar (typically via Ctrl+B):
   * ←/→ wrap between buttons, Esc gives focus back to the page. Tab still walks
   * the buttons natively.
   */
  const handleBarKeyDown: JSX.EventHandler<HTMLDivElement, KeyboardEvent> = (e) => {
    const active = document.activeElement
    if (!(active instanceof HTMLElement) || !e.currentTarget.contains(active)) return
    if (e.key === 'Escape') {
      e.preventDefault()
      active.blur()
      return
    }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    const buttons = barButtons(e.currentTarget)
    const index = buttons.findIndex((button) => button === active)
    if (index === -1) return
    e.preventDefault()
    const delta = e.key === 'ArrowRight' ? 1 : buttons.length - 1
    buttons[(index + delta) % buttons.length]?.focus()
  }

  return (
    <div class="editor-action-dock">
      <Show when={defaultsOpen()}>
        <div class="editor-action-defaults">
          <EditorDefaultsForm defaults={props.defaults} showCondition={showCondition()} />
        </div>
      </Show>
      <div
        class="editor-action-bar"
        ref={(el) => {
          props.barRef?.(el)
          onCleanup(() => props.barRef?.(undefined))
        }}
        onKeyDown={handleBarKeyDown}
      >
        <button
          type="button"
          class="btn-add"
          title={t('ui.editor.addCardTitle')}
          onClick={props.onAddCard}
        >
          {t('ui.editor.addCard')}
        </button>
        <button
          type="button"
          class="btn-defaults"
          aria-expanded={defaultsOpen()}
          onClick={() => setDefaultsOpen((v) => !v)}
        >
          <span class="btn-defaults-caret">{defaultsOpen() ? '▾' : '▴'}</span>
          {t('ui.editor.addCardDefaults')}
          <Show when={props.defaults.hasActive()}>
            <span class="btn-defaults-dot" aria-label={t('ui.editor.defaultsActive')} />
          </Show>
        </button>
        <button type="button" class="btn-sections" onClick={() => setSectionsOpen(true)}>
          {t('ui.editor.sections')}
        </button>
        <button type="button" class="btn-categories" onClick={() => setCategoriesOpen(true)}>
          {t('ui.editor.categories')}
        </button>
        <Show when={props.onEditLabels}>
          <button type="button" class="btn-labels" onClick={() => props.onEditLabels!()}>
            {t('ui.editor.labels')}
          </button>
        </Show>
        <Show when={props.onEditImage}>
          <button type="button" class="btn-cover-image" onClick={() => props.onEditImage!()}>
            {t('ui.editor.coverImage')}
          </button>
        </Show>
        <Show when={props.onImport}>
          <button type="button" class="btn-import" onClick={() => props.onImport!()}>
            {t('ui.editor.import')}
          </button>
        </Show>
        <Show when={props.onSwapPrintings}>
          <button type="button" class="btn-swap-printings" onClick={() => props.onSwapPrintings!()}>
            {t('ui.editor.swapPrintings')}
          </button>
        </Show>
        <button type="button" class="btn-changes" onClick={props.onShowChanges}>
          {t('ui.editor.changes')}
          <Show when={props.changeCount > 0}>
            <span class="changes-badge">{props.changeCount}</span>
          </Show>
        </button>
        <button type="button" class="btn-undo" disabled={!props.canUndo} onClick={props.onUndo}>
          {t('ui.editor.undo')}
        </button>
        <Show when={props.showSave ?? true}>
          <button
            type="button"
            class="btn-save"
            disabled={props.changeCount === 0 || props.saving}
            onClick={props.onSave}
          >
            {props.saving ? t('ui.editor.saving') : t('ui.editor.saveChanges')}
          </button>
        </Show>
        <Show when={props.showDiscard ?? true}>
          <button
            type="button"
            class="btn btn-danger"
            disabled={props.changeCount === 0}
            onClick={props.onDiscard}
          >
            {t('ui.editor.discardChanges')}
          </button>
        </Show>
        <button
          type="button"
          class="btn-shortcuts"
          title={t('ui.editor.shortcutsTitle')}
          aria-label={t('ui.editor.shortcutsLabel')}
          onClick={props.onShowShortcuts}
        >
          ?
        </button>
      </div>

      <Modal
        open={sectionsOpen()}
        onClose={closeSections}
        size="md"
        panelClass="modal-panel--prompt section-manager"
      >
        <h3>{t('ui.editor.manageSections')}</h3>
        <p class="dialog-message">{t('ui.editor.sectionsHelp')}</p>

        <div class="section-manager-add">
          <input
            type="text"
            class={`form-input section-manager-input${duplicateOf() ? ' form-input--invalid' : ''}`}
            placeholder={t('ui.editor.newSectionName')}
            aria-invalid={duplicateOf() ? 'true' : undefined}
            value={newSectionName()}
            onInput={(e) => setNewSectionName(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                submitNewSection()
              }
            }}
          />
          <button
            type="button"
            class="btn section-manager-add-btn"
            disabled={!canAddSection()}
            onClick={submitNewSection}
          >
            {t('ui.editor.addSection')}
          </button>
        </div>
        <Show when={duplicateOf()}>
          {(name) => <p class="form-error">{t('ui.editor.sectionExists', { name: name() })}</p>}
        </Show>

        <ul class="section-manager-list">
          <For each={props.sections}>
            {(section) => (
              <li
                class={`section-manager-row${duplicateOf() === section.name ? ' section-manager-row--clash' : ''}`}
              >
                <span class="section-manager-name">{section.name}</span>
                <span class="section-manager-count">{section.count}</span>
                <button
                  type="button"
                  class="btn btn-secondary btn-sm section-manager-rename"
                  onClick={() => props.onRequestRename(section.name)}
                >
                  {t('ui.editor.rename')}
                </button>
                <button
                  type="button"
                  class="btn btn-secondary btn-sm section-manager-delete"
                  disabled={section.count > 0}
                  title={section.count > 0 ? t('ui.editor.deleteSectionDisabled') : undefined}
                  onClick={() => props.onRemoveSection(section.name)}
                >
                  {t('ui.editor.delete')}
                </button>
              </li>
            )}
          </For>
        </ul>

        <div class="confirm-dialog-actions">
          <button type="button" class="btn btn-secondary" onClick={closeSections}>
            {t('ui.dialog.done')}
          </button>
        </div>
      </Modal>

      <Modal
        open={categoriesOpen()}
        onClose={() => setCategoriesOpen(false)}
        size="md"
        panelClass="modal-panel--prompt category-manager"
      >
        <h3>{t('ui.editor.manageCategories')}</h3>
        <p class="dialog-message">{t('ui.editor.categoriesHelp')}</p>

        <Show when={props.categories.length === 0}>
          <p class="dialog-message">{t('ui.editor.noCategories')}</p>
        </Show>

        <ul class="section-manager-list">
          <For each={props.categories}>
            {(category, i) => (
              <li class="section-manager-row category-manager-row">
                <span class="section-manager-name">{category.name}</span>
                <span class="section-manager-count">{category.count}</span>
                <button
                  type="button"
                  class="btn btn-secondary btn-sm category-manager-up"
                  title={t('ui.editor.moveCategoryUp')}
                  aria-label={t('ui.editor.moveCategoryUp')}
                  disabled={i() === 0}
                  onClick={() =>
                    props.onSetCategoryOrder(swapNeighbour(namesOf(props.categories), i(), -1))
                  }
                >
                  ▲
                </button>
                <button
                  type="button"
                  class="btn btn-secondary btn-sm category-manager-down"
                  title={t('ui.editor.moveCategoryDown')}
                  aria-label={t('ui.editor.moveCategoryDown')}
                  disabled={i() === props.categories.length - 1}
                  onClick={() =>
                    props.onSetCategoryOrder(swapNeighbour(namesOf(props.categories), i(), 1))
                  }
                >
                  ▼
                </button>
                <button
                  type="button"
                  class="btn btn-secondary btn-sm category-manager-rename"
                  onClick={() => props.onRequestRenameCategory(category.name)}
                >
                  {t('ui.editor.rename')}
                </button>
                <button
                  type="button"
                  class="btn btn-secondary btn-sm category-manager-remove"
                  onClick={() => props.onRemoveCategory(category.name)}
                >
                  {t('ui.editor.removeCategory')}
                </button>
              </li>
            )}
          </For>
        </ul>

        <div class="confirm-dialog-actions">
          <button type="button" class="btn btn-secondary" onClick={() => setCategoriesOpen(false)}>
            {t('ui.dialog.done')}
          </button>
        </div>
      </Modal>
    </div>
  )
}
