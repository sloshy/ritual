import { type Component, createEffect, createSignal, For, Show, on } from 'solid-js'
import { Modal } from '../../../ui/Modal'
import {
  cardLabelDefaultChoicesFor,
  sameCardLabels,
  type CardLabel,
  type CardLabelDefaultChoice,
} from '../../../card/card-labels'
import type { ListType } from '../../../list/list-type'
import { useT, useTKey } from '../../../ui/i18n'
import { putListMetadata } from '../editor-backend'
import { useApiText } from '../hooks/useApiAction'
import type { ApiActionMessage } from '../../../api/result'

type ListLabelsModalProps = {
  open: boolean
  onClose: () => void
  /** Which list type is being edited — it decides both the route and the choices. */
  type: ListType
  /** Slug of the list whose front matter the save targets. */
  slug: string | null
  /** The list's current default labels (from the load body). */
  labels: CardLabel[] | undefined
  /** The editor session's content hash — the metadata write's concurrency token. */
  contentHash: string
  /**
   * Adopt the write: the new default labels and the file's new content hash, so
   * the editor's next card save does not 409 against a write it made itself.
   */
  onSaved: (labels: CardLabel[] | undefined, contentHash: string) => void
}

/**
 * Edit a list's default card labels (`labels:` front matter) via
 * `PUT /api/metadata/:type/:slug`. Front matter and card lines are disjoint, so
 * the write is safe alongside pending card edits — the returned hash is adopted
 * into the session so the next card save doesn't 409.
 *
 * The choices are the ones the list type carries: everything for a collection,
 * `proxy` alone for a deck.
 */
export const ListLabelsModal: Component<ListLabelsModalProps> = (props) => {
  const t = useT()
  const tKey = useTKey()
  const [selected, setSelected] = createSignal<CardLabel[]>([])
  const [saving, setSaving] = createSignal(false)
  // Held unrendered and rendered in the JSX, so a language switch relabels it.
  const [error, setError] = createSignal<ApiActionMessage | null>(null)
  const heldText = useApiText()

  // Re-seed the radio state each time the modal opens (or the list changes).
  createEffect(
    on(
      () => [props.open, props.slug] as const,
      () => {
        setSelected([...(props.labels ?? [])])
        setError(null)
      },
    ),
  )

  const isSelected = (choice: CardLabelDefaultChoice): boolean =>
    sameCardLabels(choice.labels, selected())

  const save = async () => {
    const slug = props.slug
    if (!slug) return
    setSaving(true)
    setError(null)
    const labels = selected()
    const result = await putListMetadata(props.type, slug, {
      labels: labels.length > 0 ? labels : null,
      contentHash: props.contentHash,
    })
    setSaving(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    props.onSaved(labels.length > 0 ? labels : undefined, result.contentHash)
    props.onClose()
  }

  return (
    <Modal open={props.open} onClose={props.onClose} size="md" panelClass="modal-panel--prompt">
      <h3>{t('admin.labels.title')}</h3>
      <p class="dialog-message">{t('admin.labels.desc')}</p>
      <div class="labels-modal-choices" role="radiogroup" aria-label={t('admin.labels.groupLabel')}>
        <For each={cardLabelDefaultChoicesFor(props.type)}>
          {(choice) => (
            <label class="labels-modal-choice">
              <input
                type="radio"
                name="list-default-labels"
                checked={isSelected(choice)}
                onChange={() => setSelected([...choice.labels])}
              />
              {tKey(choice.label)}
            </label>
          )}
        </For>
      </div>
      <Show when={error()}>{(message) => <p class="form-error">{heldText(message())}</p>}</Show>
      <div class="confirm-dialog-actions">
        <button type="button" class="btn btn-secondary" onClick={props.onClose}>
          {t('ui.dialog.cancel')}
        </button>
        <button
          type="button"
          class="btn btn-primary"
          disabled={saving() || props.slug === null}
          onClick={() => void save()}
        >
          {saving() ? t('admin.labels.saving') : t('admin.labels.save')}
        </button>
      </div>
    </Modal>
  )
}
