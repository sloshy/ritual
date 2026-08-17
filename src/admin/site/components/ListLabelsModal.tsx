import { type Component, createEffect, createSignal, For, Show, on } from 'solid-js'
import { Modal } from '../../../ui/Modal'
import type { CardLabel, CardLabelChoice } from '../../../card-labels'
import { cardLabelDefaultChoicesFor, sameCardLabels } from '../../../card-labels'
import type { ListType } from '../../../list-type'
import { useT, useTKey } from '../../../ui/i18n'
import type { MetadataResponse } from '../../api/metadata'
import type { ApiErrorResponse } from '../../api/save-helpers'

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
  /** Adopt the write: the new default labels and the file's new content hash. */
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
  const [error, setError] = createSignal<string | null>(null)

  // Re-seed the radio state each time the modal opens (or the list changes).
  createEffect(
    on(
      () => [props.open, props.slug] as const,
      () => {
        setSelected(props.labels ?? [])
        setError(null)
      },
    ),
  )

  const isSelected = (choice: CardLabelChoice): boolean => sameCardLabels(choice.labels, selected())

  const save = async () => {
    const slug = props.slug
    if (!slug) return
    setSaving(true)
    setError(null)
    try {
      const labels = selected()
      const resp = await fetch(`/api/metadata/${props.type}/${encodeURIComponent(slug)}`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          labels: labels.length > 0 ? labels : null,
          contentHash: props.contentHash,
        }),
      })
      const body = (await resp.json()) as MetadataResponse | ApiErrorResponse
      if (!resp.ok || !body.success) {
        setError(
          body.success === false
            ? body.message
            : t('admin.labels.saveFailed', { status: resp.status }),
        )
        return
      }
      props.onSaved(labels.length > 0 ? labels : undefined, body.contentHash)
      props.onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
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
      <Show when={error()}>{(message) => <p class="form-error">{message()}</p>}</Show>
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
