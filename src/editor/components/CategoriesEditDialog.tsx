import { type Component, createEffect, createMemo, createSignal, For, on, Show } from 'solid-js'
import { focusAndSelectOnOpen } from '../../ui/focus-on-open'
import { swapNeighbour } from '../../util/array'
import { Modal } from '../../ui/Modal'
import { useT } from '../../ui/i18n'
import {
  CARD_CATEGORY_SEPARATOR,
  foldCardCategory,
  formatCardCategories,
  parseCardCategory,
  parseCardCategoriesInput,
  type CardCategory,
} from '../../card/card-categories'
import { closeCategoriesPrompt, pendingCategoriesPrompt } from '../categories-prompt'

/**
 * **Deliberately a sibling of `TagsEditDialog`, not a shared shell.** The two
 * read alike, but a common component would need eight-odd parameters (parse,
 * format, separator, fold key, class prefix, five message keys) plus a slot for
 * this dialog's ordering chip row — parameterization that reads worse than two
 * short files. The shared halves that *are* worth sharing were extracted: the
 * prompt singleton (`src/ui/prompt-singleton.ts`) and the neighbour swap
 * (`src/util/array.ts`). A third open-vocabulary kind should extract the shell
 * rather than add a third clone.
 *
 * The "Edit Categories…" dialog: one text field holding the card's whole ordered
 * category list (`Ramp, Artifacts`, comma-separated — the same grammar the CLI
 * prompt reads through `parseCardCategoriesInput`), validated as you type, with
 * the list's other categories and the configured defaults offered as one-click
 * additions. Unlike tags, order matters: the first entry is the card's primary
 * category, so the parsed list is shown as a reorderable chip row above the
 * field. Saving with an empty field clears every category. Rendered once per
 * editor shell, driven by the `categories-prompt` singleton.
 */
export const CategoriesEditDialog: Component = () => {
  let inputRef: HTMLInputElement | undefined
  const t = useT()
  const [value, setValue] = createSignal('')

  // Seed the draft from the request itself rather than from the modal's open
  // transition: a request that *replaces* one already open never re-opens the
  // modal, and the field must still show the new card's categories.
  createEffect(
    on(pendingCategoriesPrompt, (prompt) => {
      if (prompt) setValue(formatCardCategories(prompt.current))
    }),
  )

  const parsed = createMemo(() => parseCardCategoriesInput(value()))
  const canSave = () => parsed().ok
  // An empty field parses as "clear every category", so there is nothing to
  // pre-flag: a message means something typed was refused.
  const error = () => {
    const result = parsed()
    return result.ok ? null : result.message
  }
  /** The ordered chips shown above the field; empty while the draft is refused. */
  const ordered = createMemo((): readonly CardCategory[] => {
    const result = parsed()
    return result.ok ? result.categories : []
  })
  /**
   * The draft's well-formed categories, for hiding suggestions it already holds.
   * Parsed per entry rather than through `parsed()`, so one malformed entry
   * mid-edit does not re-offer every category the field already has.
   */
  const draftCategories = createMemo((): ReadonlySet<string> => {
    const parts = value()
      .split(CARD_CATEGORY_SEPARATOR)
      .map((part) => parseCardCategory(part))
    return new Set(parts.flatMap((part) => (part.ok ? [foldCardCategory(part.category)] : [])))
  })
  const suggestions = createMemo(() =>
    (pendingCategoriesPrompt()?.suggestions ?? []).filter(
      (category) => !draftCategories().has(foldCardCategory(category)),
    ),
  )

  const setFromList = (categories: readonly CardCategory[]): void => {
    setValue(formatCardCategories(categories))
  }

  /** Swap one chip with its neighbour; index 0 is the primary category. */
  const move = (index: number, delta: number): void => {
    setFromList(swapNeighbour(ordered(), index, delta))
  }

  const appendCategory = (category: CardCategory): void => {
    const draft = value().replace(/[\s,]+$/, '')
    const next = draft === '' ? category : `${draft}${CARD_CATEGORY_SEPARATOR} ${category}`
    setValue(next)
    const input = inputRef
    if (input) {
      input.focus()
      input.setSelectionRange(next.length, next.length)
    }
  }

  const save = (): void => {
    const prompt = pendingCategoriesPrompt()
    const result = parsed()
    if (!prompt || !result.ok) return
    closeCategoriesPrompt()
    prompt.onSave(result.categories)
  }

  return (
    <Modal
      open={pendingCategoriesPrompt() !== null}
      onClose={closeCategoriesPrompt}
      size="md"
      panelClass="modal-panel--prompt text-prompt categories-prompt"
      onOpen={() => focusAndSelectOnOpen(() => inputRef)}
    >
      <h3>{t('ui.editor.editCategoriesTitle')}</h3>
      <div class="text-prompt-field">
        <Show when={ordered().length > 0}>
          <div
            class="categories-prompt-order"
            role="group"
            aria-label={t('ui.editor.categoriesOrderLabel')}
          >
            <For each={ordered()}>
              {(category, i) => (
                <span
                  class={`categories-prompt-chip${i() === 0 ? ' categories-prompt-chip--primary' : ''}`}
                >
                  <button
                    type="button"
                    class="categories-prompt-move"
                    title={t('ui.editor.categoriesMoveEarlier')}
                    aria-label={t('ui.editor.categoriesMoveEarlier')}
                    disabled={i() === 0}
                    onClick={() => move(i(), -1)}
                  >
                    ◀
                  </button>
                  {category}
                  <Show when={i() === 0}>
                    <span class="categories-prompt-primary-badge">
                      {t('ui.editor.categoriesPrimaryBadge')}
                    </span>
                  </Show>
                  <button
                    type="button"
                    class="categories-prompt-move"
                    title={t('ui.editor.categoriesMoveLater')}
                    aria-label={t('ui.editor.categoriesMoveLater')}
                    disabled={i() === ordered().length - 1}
                    onClick={() => move(i(), 1)}
                  >
                    ▶
                  </button>
                </span>
              )}
            </For>
          </div>
        </Show>
        <label class="text-prompt-label" for="categories-prompt-input">
          {t('ui.editor.categoriesLabel')}
        </label>
        <input
          id="categories-prompt-input"
          ref={inputRef}
          type="text"
          class={`form-input${error() !== null ? ' form-input--invalid' : ''}`}
          value={value()}
          placeholder={t('ui.editor.categoriesPlaceholder')}
          autocomplete="off"
          spellcheck={false}
          aria-invalid={error() !== null ? 'true' : undefined}
          aria-describedby={
            error() !== null
              ? 'categories-prompt-hint categories-prompt-error'
              : 'categories-prompt-hint'
          }
          onInput={(e) => setValue(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              save()
            }
          }}
        />
        <p id="categories-prompt-hint" class="categories-prompt-hint">
          {t('ui.editor.categoriesHint')}
        </p>
        <Show when={error()}>
          {(message) => (
            <p id="categories-prompt-error" class="form-error" role="alert">
              {message()}
            </p>
          )}
        </Show>
        <Show when={suggestions().length > 0}>
          <div
            class="categories-prompt-suggestions"
            role="group"
            aria-label={t('ui.editor.categoriesSuggestions')}
          >
            <span class="categories-prompt-suggestions-label">
              {t('ui.editor.categoriesSuggestions')}
            </span>
            <For each={suggestions()}>
              {(category) => (
                <button
                  type="button"
                  class="categories-prompt-suggestion"
                  onClick={() => appendCategory(category)}
                >
                  {category}
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
      <div class="confirm-dialog-actions">
        <button type="button" class="btn btn-secondary" onClick={closeCategoriesPrompt}>
          {t('ui.dialog.cancel')}
        </button>
        <button type="button" class="btn btn-primary" disabled={!canSave()} onClick={save}>
          {t('ui.editor.categoriesSave')}
        </button>
      </div>
    </Modal>
  )
}
