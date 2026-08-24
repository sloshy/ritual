import { type Component, createSignal, Show } from 'solid-js'
import { Modal } from '../../../ui/Modal'
import { useT } from '../../../ui/i18n'
import type { CardArtRef } from '../../../card-art'
import type { CardArtPrompt } from '../card-art-prompt'
import { putCardArt } from '../editor-backend'
import { ArtRefField, createArtRefField, type CardArtMode } from './ArtRefField'

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
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const field = createArtRefField(
    mode,
    initial === null ? '' : 'file' in initial ? initial.file : initial.url,
  )

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
      <ArtRefField
        field={field}
        mode={mode()}
        inputId="card-art-value"
        previewAlt={t('admin.art.previewAlt', { name: props.prompt.cardName })}
        invalidMessage={(reason) => t('admin.art.invalid', { reason })}
      />
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
          disabled={saving() || field.parsed().state !== 'valid'}
          onClick={() => {
            const parsed = field.parsed()
            if (parsed.state === 'valid') void submit(parsed.art)
          }}
        >
          {saving() ? t('admin.art.saving') : t('admin.art.save')}
        </button>
      </div>
    </Modal>
  )
}
