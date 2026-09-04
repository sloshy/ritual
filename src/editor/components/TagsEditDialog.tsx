import { type Component, createEffect, createMemo, createSignal, For, on, Show } from 'solid-js'
import { focusAndSelectOnOpen } from '../../ui/focus-on-open'
import { Modal } from '../../ui/Modal'
import { useT } from '../../ui/i18n'
import {
  CARD_TAG_SEPARATOR,
  formatCardTags,
  parseCardTag,
  parseCardTagsInput,
  type CardTag,
} from '../../card/card-tags'
import { closeTagsPrompt, pendingTagsPrompt } from '../tags-prompt'

/**
 * The "Edit Tags…" dialog: one text field holding the card's whole tag set
 * (`Ramp, Card Draw`, comma-separated — the same grammar the CLI prompt reads
 * through `parseCardTagsInput`), validated as you
 * type, with the list's other tags offered as one-click additions. Saving with
 * an empty field clears every tag. The same dialog serves the selection menu's
 * "Add Tag…" (`mode: 'add'`): its heading and hint say the tags are added on
 * top of what each card has, and an empty field cannot be saved. Rendered once
 * per editor shell, driven by the `tags-prompt` singleton.
 */
export const TagsEditDialog: Component = () => {
  let inputRef: HTMLInputElement | undefined
  const t = useT()
  const [value, setValue] = createSignal('')

  // Seed the draft from the request itself rather than from the modal's open
  // transition: a request that *replaces* one already open never re-opens the
  // modal, and the field must still show the new card's tags.
  createEffect(
    on(pendingTagsPrompt, (prompt) => {
      if (prompt) setValue(formatCardTags(prompt.current))
    }),
  )

  const parsed = createMemo(() => parseCardTagsInput(value()))
  // `add` mode falls back to `edit` while the prompt is null so the closing
  // transition never flips the heading or hint mid-fade.
  const isAdd = () => pendingTagsPrompt()?.mode === 'add'
  // An empty set is a legitimate `edit` (clear every tag) but a no-op `add`.
  const canSave = () => {
    const result = parsed()
    return result.ok && !(isAdd() && result.tags.length === 0)
  }
  // An empty field parses as "clear every tag", so there is nothing to
  // pre-flag: a message means something typed was refused.
  const error = () => {
    const result = parsed()
    return result.ok ? null : result.message
  }
  /**
   * The draft's well-formed tags, for hiding suggestions it already holds.
   * Parsed per entry rather than through `parsed()`, so one malformed entry
   * mid-edit does not re-offer every tag the field already has.
   */
  const draftTags = createMemo((): ReadonlySet<CardTag> => {
    const parts = value()
      .split(CARD_TAG_SEPARATOR)
      .map((part) => parseCardTag(part))
    return new Set(parts.flatMap((part) => (part.ok ? [part.tag] : [])))
  })
  const suggestions = createMemo(() =>
    (pendingTagsPrompt()?.suggestions ?? []).filter((tag) => !draftTags().has(tag)),
  )

  const appendTag = (tag: CardTag): void => {
    const draft = value().replace(/[\s,]+$/, '')
    const next = draft === '' ? tag : `${draft}${CARD_TAG_SEPARATOR} ${tag}`
    setValue(next)
    const input = inputRef
    if (input) {
      input.focus()
      input.setSelectionRange(next.length, next.length)
    }
  }

  // One gate for the button and the Enter key: `canSave` subsumes `result.ok`,
  // and the `result.ok` read here only narrows the union for `result.tags`.
  const save = (): void => {
    const prompt = pendingTagsPrompt()
    const result = parsed()
    if (!prompt || !canSave() || !result.ok) return
    closeTagsPrompt()
    prompt.onSave(result.tags)
  }

  return (
    <Modal
      open={pendingTagsPrompt() !== null}
      onClose={closeTagsPrompt}
      size="md"
      panelClass="modal-panel--prompt text-prompt tags-prompt"
      onOpen={() => focusAndSelectOnOpen(() => inputRef)}
    >
      <h3>{isAdd() ? t('ui.editor.addTagsTitle') : t('ui.editor.editTagsTitle')}</h3>
      <div class="text-prompt-field">
        <label class="text-prompt-label" for="tags-prompt-input">
          {t('ui.editor.tagsLabel')}
        </label>
        <input
          id="tags-prompt-input"
          ref={inputRef}
          type="text"
          class={`form-input${error() !== null ? ' form-input--invalid' : ''}`}
          value={value()}
          placeholder={t('ui.editor.tagsPlaceholder')}
          autocomplete="off"
          spellcheck={false}
          aria-invalid={error() !== null ? 'true' : undefined}
          aria-describedby={
            error() !== null ? 'tags-prompt-hint tags-prompt-error' : 'tags-prompt-hint'
          }
          onInput={(e) => setValue(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              save()
            }
          }}
        />
        <p id="tags-prompt-hint" class="tags-prompt-hint">
          {isAdd() ? t('ui.editor.addTagsHint') : t('ui.editor.tagsHint')}
        </p>
        <Show when={error()}>
          {(message) => (
            <p id="tags-prompt-error" class="form-error" role="alert">
              {message()}
            </p>
          )}
        </Show>
        <Show when={suggestions().length > 0}>
          <div
            class="tags-prompt-suggestions"
            role="group"
            aria-label={t('ui.editor.tagsSuggestions')}
          >
            <span class="tags-prompt-suggestions-label">{t('ui.editor.tagsSuggestions')}</span>
            <For each={suggestions()}>
              {(tag) => (
                <button type="button" class="tags-prompt-suggestion" onClick={() => appendTag(tag)}>
                  {tag}
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
      <div class="confirm-dialog-actions">
        <button type="button" class="btn btn-secondary" onClick={closeTagsPrompt}>
          {t('ui.dialog.cancel')}
        </button>
        <button type="button" class="btn btn-primary" disabled={!canSave()} onClick={save}>
          {t('ui.editor.tagsSave')}
        </button>
      </div>
    </Modal>
  )
}
