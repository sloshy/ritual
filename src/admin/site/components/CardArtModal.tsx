import { type Component, createMemo, createSignal, Show } from 'solid-js'
import { Modal } from '../../../ui/Modal'
import { useT } from '../../../ui/i18n'
import { isCardArtRefError, parseCardArtRef, type CardArtRef } from '../../../card-art'
import { cardArtDisplayUrl } from '../../../site/art-url'
import type { CardArtPrompt } from '../card-art-prompt'
import { putCardArt } from '../editor-backend'
import { useDebouncedInput } from '../../../site/useDebouncedInput'

/** Which kind of reference the form is editing. */
export type CardArtMode = 'file' | 'url'

/**
 * How long the field waits before the preview follows it. Longer than the
 * filter inputs' default: each commit here is a network fetch for an image,
 * not a re-filter of already-loaded cards.
 */
const ART_PREVIEW_DEBOUNCE_MS = 500

/** The line under the field, whichever of its two messages is showing. */
const ART_VALUE_NOTE_ID = 'card-art-note'

/**
 * The typed value read as a reference: nothing yet, the reference itself, or the
 * parser's refusal.
 */
export type CardArtInput =
  | { state: 'empty' }
  | { state: 'valid'; art: CardArtRef }
  | { state: 'invalid'; reason: string }

/**
 * Read one form value as an art reference, through the same grammar the sidecar,
 * the art route and the CLI go through — the mode picks which half of it applies,
 * since a bare `sol-ring.png` is a legitimate path and never a URL.
 *
 * The dialog cannot rely on the route to catch a bad value: a card this session
 * added is staged locally and only reaches the server after the save that writes
 * its line, where a refusal arrives long after the modal is gone.
 */
export function readCardArtValue(mode: CardArtMode, raw: string): CardArtInput {
  const trimmed = raw.trim()
  if (trimmed === '') return { state: 'empty' }
  const parsed = parseCardArtRef(mode === 'file' ? { file: trimmed } : { url: trimmed })
  if (isCardArtRefError(parsed)) return { state: 'invalid', reason: parsed.error }
  return { state: 'valid', art: parsed }
}

type CardArtModalProps = {
  prompt: CardArtPrompt
  onClose: () => void
}

/**
 * Set or clear one card's custom art through `PUT /api/art/:type/:slug`.
 *
 * The write is immediate and independent of the editor's pending card changes:
 * art lives in the `<list>.art.json` sidecar, which no card save touches. The
 * preview points at the same URL the card tile will use, so a path that shows
 * nothing here is a path the site will not resolve either — the server still
 * refuses a file it cannot find, which is what turns a typo into a message
 * rather than a silently blank card.
 *
 * The grammar itself is checked here rather than left to that route: a card the
 * session added has no line to write art against yet, so its reference is staged
 * and only offered to the server after the save — far too late for the dialog to
 * report anything about it.
 */
export const CardArtModal: Component<CardArtModalProps> = (props) => {
  const t = useT()
  const initial = props.prompt.current
  const [mode, setMode] = createSignal<CardArtMode>(
    initial !== null && 'url' in initial ? 'url' : 'file',
  )
  const [value, setValue] = createSignal(
    initial === null ? '' : 'file' in initial ? initial.file : initial.url,
  )
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  // The exact URL whose preview failed, not a flag: the field is edited
  // character by character, and a flag would keep flagging the value that fixed
  // it until something else cleared it.
  const [brokenUrl, setBrokenUrl] = createSignal<string | null>(null)

  // The field commits on a pause, not per keystroke: the preview points an
  // `<img>` at whatever is typed, and an uncommitted draft would fire a request
  // for every prefix of a path or URL. Saving reads the draft, so a click
  // straight after typing still writes what is on screen.
  const input = useDebouncedInput(value, setValue, ART_PREVIEW_DEBOUNCE_MS)

  const ref = createMemo<CardArtInput>(() => readCardArtValue(mode(), input.draft()))
  const refError = createMemo(() => {
    const parsed = ref()
    return parsed.state === 'invalid' ? parsed.reason : null
  })
  // Only a reference the parser accepts gets a preview: pointing an `<img>` at
  // a refused value would answer "that image could not be loaded" to a question
  // the field has already answered more precisely.
  const previewUrl = createMemo(() => {
    const parsed = readCardArtValue(mode(), value())
    return parsed.state === 'valid' ? cardArtDisplayUrl(parsed.art) : null
  })

  const submit = async (art: CardArtRef | null): Promise<void> => {
    // A card this session added has no line for the route to find: the reference
    // goes back to the editor to be staged with the pending changes, and the
    // save that writes the line writes the art straight after it.
    if (props.prompt.staged === true) {
      props.prompt.onSaved(art)
      props.onClose()
      return
    }
    setSaving(true)
    setError(null)
    const { listType, slug, cardId } = props.prompt
    const result = await putCardArt(listType, slug, cardId, art)
    setSaving(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    props.prompt.onSaved(art)
    props.onClose()
  }

  return (
    <Modal open={true} onClose={props.onClose} size="md" panelClass="modal-panel--prompt">
      <h3>{t('admin.art.title')}</h3>
      <p class="dialog-message">{t('admin.art.desc', { name: props.prompt.cardName })}</p>
      <div class="card-art-modes" role="radiogroup" aria-label={t('admin.art.modeLabel')}>
        <label class="labels-modal-choice">
          <input
            type="radio"
            name="card-art-mode"
            checked={mode() === 'file'}
            onChange={() => setMode('file')}
          />
          {t('admin.art.modeFile')}
        </label>
        <label class="labels-modal-choice">
          <input
            type="radio"
            name="card-art-mode"
            checked={mode() === 'url'}
            onChange={() => setMode('url')}
          />
          {t('admin.art.modeUrl')}
        </label>
      </div>
      <div class="text-prompt-field">
        <label class="text-prompt-label" for="card-art-value">
          {mode() === 'file' ? t('admin.art.fileLabel') : t('admin.art.urlLabel')}
        </label>
        <input
          id="card-art-value"
          type="text"
          class={`form-input${refError() !== null ? ' form-input--invalid' : ''}`}
          value={input.draft()}
          placeholder={
            mode() === 'file' ? t('admin.art.filePlaceholder') : t('admin.art.urlPlaceholder')
          }
          aria-invalid={refError() !== null}
          aria-describedby={refError() !== null ? ART_VALUE_NOTE_ID : undefined}
          onInput={(e) => input.onInput(e.currentTarget.value)}
          onBlur={() => input.flush()}
        />
      </div>
      <Show when={refError()}>
        {(reason) => (
          // The reason is engine prose — the same sentence the art route and the
          // CLI report — framed by a translated wrapper.
          <p id={ART_VALUE_NOTE_ID} class="form-error">
            {t('admin.art.invalid', { reason: reason() })}
          </p>
        )}
      </Show>
      <Show when={previewUrl()}>
        {(url) => (
          <div class="card-art-preview">
            <img
              src={url()}
              alt={t('admin.art.previewAlt', { name: props.prompt.cardName })}
              onError={() => setBrokenUrl(url())}
            />
          </div>
        )}
      </Show>
      <Show when={brokenUrl() !== null && brokenUrl() === previewUrl()}>
        <p class="form-error">{t('admin.art.previewFailed')}</p>
      </Show>
      <Show when={props.prompt.staged === true}>
        <p class="dialog-message text-muted">{t('admin.art.pendingNote')}</p>
      </Show>
      <Show when={error()}>{(message) => <p class="form-error">{message()}</p>}</Show>
      <div class="confirm-dialog-actions">
        <button type="button" class="btn btn-secondary" onClick={props.onClose}>
          {t('ui.dialog.cancel')}
        </button>
        <Show when={props.prompt.current !== null}>
          <button
            type="button"
            class="btn btn-secondary"
            disabled={saving()}
            onClick={() => void submit(null)}
          >
            {t('admin.art.clear')}
          </button>
        </Show>
        <button
          type="button"
          class="btn btn-primary"
          disabled={saving() || ref().state !== 'valid'}
          onClick={() => {
            const parsed = ref()
            if (parsed.state === 'valid') void submit(parsed.art)
          }}
        >
          {saving() ? t('admin.art.saving') : t('admin.art.save')}
        </button>
      </div>
    </Modal>
  )
}
