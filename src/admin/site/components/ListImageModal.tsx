import { type Component, createEffect, createSignal, For, on, Show } from 'solid-js'
import { Modal } from '../../../ui/Modal'
import { useT } from '../../../ui/i18n'
import type { ListType } from '../../../list/list-type'
import {
  isListImageRefError,
  isSameListImageRef,
  listImageMode,
  parseListImage,
  type ListImageMode,
  type ListImageRef,
} from '../../../list/list-image'
import type { ListImageCardOption } from '../list-image-cards'
import { putListMetadata } from '../editor-backend'
import { ArtRefField, createArtRefField, type CardArtMode } from './ArtRefField'

type ListImageModalProps = {
  open: boolean
  onClose: () => void
  /** Which list type is being edited — it decides the route this writes to. */
  type: ListType
  /** Slug of the list whose front matter the save targets. */
  slug: string | null
  /** The list's current cover override (from the load body); absent means automatic. */
  image: ListImageRef | undefined
  /** The cards the cover may point at, from the *saved* list (see `list-image-cards.ts`). */
  cards: readonly ListImageCardOption[]
  /** The editor session's content hash — the metadata write's concurrency token. */
  contentHash: string
  /**
   * Adopt the write: the new cover, the file's new content hash, and the full
   * front matter the write produced — the deck editor holds a snapshot of that
   * block and re-sends it with every card save, so a stale one would delete the
   * very key this dialog just wrote.
   */
  onSaved: (
    image: ListImageRef | undefined,
    contentHash: string,
    frontMatter: Record<string, unknown>,
  ) => void
}

/** The modes in the order the radio group offers them. */
const MODES: readonly ListImageMode[] = ['default', 'card', 'file', 'url']

/**
 * Choose the image a list shows as its cover on the site — the `image:` key in
 * its front matter — via `PUT /api/metadata/:type/:slug`.
 *
 * The same four modes the front matter, the CLI's `set-list-image` and the MCP
 * tool speak: automatic (no key at all), one of the list's own cards by its `&N`,
 * a file in the art directory, or a URL. Front matter and card lines are
 * disjoint, so the write is safe alongside pending card edits — the returned
 * hash is adopted into the session so the next card save doesn't 409.
 *
 * The reference is parsed here before it is sent, through the very same grammar
 * module the route parses it with, so a path that escapes the art directory is
 * refused in the dialog rather than a round trip later. The route still has the
 * final word: only it can tell whether a chosen card id still exists on disk.
 */
export const ListImageModal: Component<ListImageModalProps> = (props) => {
  const t = useT()
  const [mode, setMode] = createSignal<ListImageMode>('default')
  const [cardId, setCardId] = createSignal<number | null>(null)
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  // The file/url half is shared with the custom-art dialog; it reads the same
  // text through whichever of the two modes is selected.
  const artMode = (): CardArtMode => (mode() === 'url' ? 'url' : 'file')
  const field = createArtRefField(artMode, '')

  // Re-seed from the list's stored cover each time the modal opens, the list
  // changes, or the stored cover itself changes — the panel's contents are
  // unmounted while it is closed, but the state above it is not, and a load
  // landing while the dialog is open would otherwise leave the previous list's
  // cover on screen. The handler is idempotent, so re-running it costs nothing.
  createEffect(
    on(
      () => [props.open, props.slug, props.image] as const,
      () => {
        const image = props.image
        setMode(listImageMode(image))
        setCardId(image !== undefined && 'card' in image ? image.card : null)
        field.set(
          image === undefined ? '' : 'file' in image ? image.file : 'url' in image ? image.url : '',
        )
        setError(null)
      },
    ),
  )

  /** The card the picker is pointed at, for its preview. */
  const selectedCard = (): ListImageCardOption | undefined =>
    props.cards.find((c) => c.cardId === cardId())

  /**
   * The cover the form currently describes: `null` for automatic (which removes
   * the key), `undefined` while it describes nothing usable yet — which is what
   * keeps Save disabled rather than sending a value the route would refuse.
   */
  const chosen = (): ListImageRef | null | undefined => {
    const current = mode()
    if (current === 'default') return null
    if (current === 'card') {
      const id = cardId()
      return id === null ? undefined : { card: id }
    }
    const parsed = field.parsed()
    return parsed.state === 'valid' ? parsed.art : undefined
  }

  /** True when the form still describes exactly what the file already says. */
  const unchanged = (image: ListImageRef | null): boolean => {
    const current = props.image
    if (image === null) return current === undefined
    return current !== undefined && isSameListImageRef(image, current)
  }

  const save = async (): Promise<void> => {
    const slug = props.slug
    const image = chosen()
    if (!slug || image === undefined) return
    // A dialog opened and closed on Save writes nothing: the write would rotate
    // the file's content hash (and its git history) to say the same thing.
    if (unchanged(image)) {
      props.onClose()
      return
    }
    // Parsed once more as the route will parse it: the field validates the file
    // and URL halves, and this covers the card branch by the same grammar.
    const parsed = image === null ? null : parseListImage(image)
    if (parsed !== null && isListImageRefError(parsed)) {
      setError(t('admin.listImage.invalid', { reason: parsed.error }))
      return
    }
    setSaving(true)
    setError(null)
    const result = await putListMetadata(props.type, slug, {
      image: parsed,
      contentHash: props.contentHash,
    })
    setSaving(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    props.onSaved(parsed ?? undefined, result.contentHash, result.frontMatter)
    props.onClose()
  }

  const modeLabel = (value: ListImageMode): string => {
    if (value === 'default') return t('admin.listImage.modeDefault')
    if (value === 'card') return t('admin.listImage.modeCard')
    if (value === 'file') return t('admin.art.modeFile')
    return t('admin.art.modeUrl')
  }

  return (
    <Modal open={props.open} onClose={props.onClose} size="md" panelClass="modal-panel--prompt">
      <h3>{t('admin.listImage.title')}</h3>
      <p class="dialog-message">{t('admin.listImage.desc')}</p>
      <div class="card-art-modes" role="radiogroup" aria-label={t('admin.listImage.modeLabel')}>
        <For each={MODES}>
          {(value) => (
            <label class="labels-modal-choice">
              <input
                type="radio"
                name="list-image-mode"
                value={value}
                checked={mode() === value}
                onChange={() => setMode(value)}
              />
              {modeLabel(value)}
            </label>
          )}
        </For>
      </div>
      <Show when={mode() === 'default'}>
        <p class="dialog-message text-muted">{t('admin.listImage.modeDefaultNote')}</p>
      </Show>
      <Show when={mode() === 'card'}>
        <Show
          when={props.cards.length > 0}
          fallback={<p class="dialog-message text-muted">{t('admin.listImage.noCards')}</p>}
        >
          <div class="text-prompt-field">
            <label class="text-prompt-label" for="list-image-card">
              {t('admin.listImage.cardLabel')}
            </label>
            <select
              id="list-image-card"
              class="form-input"
              value={cardId() === null ? '' : String(cardId())}
              onChange={(e) =>
                setCardId(e.currentTarget.value === '' ? null : Number(e.currentTarget.value))
              }
            >
              <option value="" />
              <For each={props.cards}>
                {(card) => (
                  // `selected` is load-bearing: rebuilding the option list (a
                  // fresh load) resets the element to its first option, and the
                  // `value` binding above does not re-run when the id it holds
                  // did not change.
                  <option value={String(card.cardId)} selected={card.cardId === cardId()}>
                    {card.label}
                  </option>
                )}
              </For>
            </select>
          </div>
          <Show when={selectedCard()?.image}>
            {(url) => (
              <div class="card-art-preview">
                <img src={url()} alt={t('admin.listImage.previewAlt')} />
              </div>
            )}
          </Show>
        </Show>
      </Show>
      <Show when={mode() === 'file' || mode() === 'url'}>
        <ArtRefField
          field={field}
          mode={artMode()}
          inputId="list-image-value"
          previewAlt={t('admin.listImage.previewAlt')}
          invalidMessage={(reason) => t('admin.listImage.invalid', { reason })}
        />
      </Show>
      <Show when={error()}>{(message) => <p class="form-error">{message()}</p>}</Show>
      <div class="confirm-dialog-actions">
        <button type="button" class="btn btn-secondary" onClick={props.onClose}>
          {t('ui.dialog.cancel')}
        </button>
        <button
          type="button"
          class="btn btn-primary"
          disabled={saving() || props.slug === null || chosen() === undefined}
          onClick={() => void save()}
        >
          {saving() ? t('admin.listImage.saving') : t('admin.listImage.save')}
        </button>
      </div>
    </Modal>
  )
}
