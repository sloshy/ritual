import { type Component, createEffect, createSignal, For, Show, on } from 'solid-js'
import { Modal } from '../../../ui/Modal'
import type { CardLabel, CardLabelChoice } from '../../../card-labels'
import { CARD_LABEL_CHOICES, sameCardLabels } from '../../../card-labels'
import type { MetadataResponse } from '../../api/metadata'
import type { ApiErrorResponse } from '../../api/save-helpers'

type CollectionLabelsModalProps = {
  open: boolean
  onClose: () => void
  /** Slug of the collection whose front matter the save targets. */
  slug: string | null
  /** The collection's current default labels (from the load body). */
  labels: CardLabel[] | undefined
  /** The editor session's content hash — the metadata write's concurrency token. */
  contentHash: string
  /** Adopt the write: the new default labels and the file's new content hash. */
  onSaved: (labels: CardLabel[] | undefined, contentHash: string) => void
}

/** One radio row per label state, "No default" first ("Use list default" makes no sense here). */
const DEFAULT_CHOICES: readonly CardLabelChoice[] = [
  { label: 'No default', labels: [] },
  ...CARD_LABEL_CHOICES.filter((choice) => choice.labels.length > 0),
]

/**
 * Edit the collection's default card labels (`labels:` front matter) via
 * `PUT /api/metadata/collection/:slug`. Front matter and card lines are
 * disjoint, so the write is safe alongside pending card edits — the returned
 * hash is adopted into the session so the next card save doesn't 409.
 */
export const CollectionLabelsModal: Component<CollectionLabelsModalProps> = (props) => {
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
      const resp = await fetch(`/api/metadata/collection/${encodeURIComponent(slug)}`, {
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
        setError(body.success === false ? body.message : `Save failed (${resp.status})`)
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
      <h3>Default Labels</h3>
      <p class="dialog-message">
        The default for every card in this collection. Individual cards can override it with their
        own label.
      </p>
      <div class="labels-modal-choices" role="radiogroup" aria-label="Default labels">
        <For each={DEFAULT_CHOICES}>
          {(choice) => (
            <label class="labels-modal-choice">
              <input
                type="radio"
                name="collection-default-labels"
                checked={isSelected(choice)}
                onChange={() => setSelected([...choice.labels])}
              />
              {choice.label}
            </label>
          )}
        </For>
      </div>
      <Show when={error()}>{(message) => <p class="form-error">{message()}</p>}</Show>
      <div class="confirm-dialog-actions">
        <button type="button" class="btn btn-secondary" onClick={props.onClose}>
          Cancel
        </button>
        <button
          type="button"
          class="btn btn-primary"
          disabled={saving() || props.slug === null}
          onClick={() => void save()}
        >
          {saving() ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Modal>
  )
}
