import { type Component, For, Show, createMemo } from 'solid-js'
import {
  cardLabelChoicesFor,
  formatCardLabels,
  supportsAnyLabels,
  type CardLabel,
} from '../../card/card-labels'
import { isCardArtRefError, parseCardArtInput, type CardArtRef } from '../../list/card-art'
import type { ListType } from '../../list/list-type'
import { useT } from '../../ui/i18n'

/**
 * The optional per-card choices the add dialog offers alongside the printing:
 * the label override the new line starts under, and its custom art.
 *
 * Rendered on both the printing step and the finish/condition step, bound to the
 * same state. Both matter: the printing grid commits the moment a tile is
 * clicked (and the finish step is skipped outright when the editor's defaults
 * answer it), so a control that lived only on the last step would be
 * unreachable for most adds.
 */

/**
 * The line under the art field — its pending-write note, or the parser's
 * refusal. One id either way, so the field's `aria-describedby` points at
 * whichever of the two is showing.
 */
const ADD_CARD_ART_NOTE_ID = 'add-card-art-note'

/** What the host list supports here. Absent entirely when it supports neither. */
export type AddCardOptionsConfig = {
  /** Drives which label rows are offered — a deck gets `proxy` and nothing else. */
  listType: ListType
  /**
   * Whether art may be set at add time. Only a host with somewhere to put it
   * (the admin editors, whose art route the staged reference is flushed to)
   * turns this on; the public editor exports card changes and has no sidecar.
   */
  enableArt: boolean
}

/** The add dialog's live options state, owned by the dialog and shown by this row. */
export type AddCardOptionsState = {
  labels: CardLabel[]
  setLabels: (labels: CardLabel[]) => void
  /** The raw art text exactly as typed — a path inside the art dir, or a URL. */
  art: string
  setArt: (value: string) => void
  /**
   * {@link art} already read as a reference. Passed in rather than parsed here:
   * the dialog gates its own commit paths (the printing click, Enter, the Add
   * buttons) on the same answer, so parsing again in the row would run the
   * grammar twice per keystroke and leave two readings that could disagree
   * about whether the field blocks the add.
   */
  artInput: AddCardArtInput
}

type AddCardOptionsProps = AddCardOptionsState & {
  config: AddCardOptionsConfig
}

/**
 * The options row as the steps that show it receive it. Held at dialog level,
 * not per step: the printing grid and the finish/condition step show the same
 * row, and a value typed on one must survive the walk to the other.
 */
export type AddOptionsRowProps = {
  /** Absent wherever the dialog does not commit an `add` (change-printing mode). */
  addOptions: AddCardOptionsConfig | undefined
  options: AddCardOptionsState
}

/**
 * Read the typed art text as a reference: `null` for an empty field (no art),
 * the parse error otherwise. One parse for the whole dialog — the same
 * `parseCardArtInput` the CLI's `--art` and the sidecar itself go through, so a
 * value this row accepts is a value the art route will accept.
 */
export type AddCardArtInput =
  | { state: 'empty' }
  | { state: 'valid'; art: CardArtRef }
  | { state: 'invalid'; reason: string }

export function readAddCardArt(raw: string): AddCardArtInput {
  if (raw.trim() === '') return { state: 'empty' }
  const parsed = parseCardArtInput(raw)
  if (isCardArtRefError(parsed)) return { state: 'invalid', reason: parsed.error }
  return { state: 'valid', art: parsed }
}

/**
 * Whether this row has anything to show for `config`. A wanted list has no
 * labels, so on a host that cannot write art either (the public editor) the row
 * is nothing at all; where art can be set it still shows the art field alone.
 */
export function hasAddCardOptions(config: AddCardOptionsConfig): boolean {
  return config.enableArt || supportsAnyLabels(config.listType)
}

export const AddCardOptions: Component<AddCardOptionsProps> = (props) => {
  const t = useT()
  const choices = createMemo(() => cardLabelChoicesFor(props.config.listType))
  const selected = createMemo(() => formatCardLabels(props.labels))
  const artError = createMemo(() =>
    props.artInput.state === 'invalid' ? props.artInput.reason : null,
  )

  return (
    <Show when={hasAddCardOptions(props.config)}>
      <div class="finish-condition-section add-card-options">
        <h4>{t('ui.addCard.optionsHeading')}</h4>
        <Show when={supportsAnyLabels(props.config.listType)}>
          <div class="add-card-option">
            <label class="add-card-option-label" for="add-card-labels">
              {t('ui.addCard.labelField')}
            </label>
            <select
              id="add-card-labels"
              class="form-input"
              value={selected()}
              onChange={(e) => {
                const picked = choices().find(
                  (choice) => formatCardLabels(choice.labels) === e.currentTarget.value,
                )
                props.setLabels(picked ? [...picked.labels] : [])
              }}
            >
              <For each={choices()}>
                {(choice) => (
                  // `selected` as well as the select's own `value`: a fresh
                  // option list is rendered before the value is applied, so
                  // without it the first row would show while the state says
                  // otherwise.
                  <option
                    value={formatCardLabels(choice.labels)}
                    selected={formatCardLabels(choice.labels) === selected()}
                  >
                    {t(choice.label)}
                  </option>
                )}
              </For>
            </select>
          </div>
        </Show>
        <Show when={props.config.enableArt}>
          <div class="add-card-option">
            <label class="add-card-option-label" for="add-card-art">
              {t('ui.addCard.artField')}
            </label>
            <input
              id="add-card-art"
              type="text"
              class={`form-input${artError() !== null ? ' form-input--invalid' : ''}`}
              value={props.art}
              placeholder={t('ui.addCard.artPlaceholder')}
              // The field that blocks the commit announces itself: the buttons
              // it disables are far enough down the dialog that a screen reader
              // would otherwise meet a dead Add with no stated reason.
              aria-invalid={artError() !== null}
              aria-describedby={ADD_CARD_ART_NOTE_ID}
              onInput={(e) => props.setArt(e.currentTarget.value)}
            />
          </div>
          <Show
            when={artError()}
            fallback={
              <p id={ADD_CARD_ART_NOTE_ID} class="text-muted">
                {t('ui.addCard.artPendingNote')}
              </p>
            }
          >
            {(reason) => (
              // The reason is engine prose — the same sentence the art route and
              // the CLI report — framed by a translated wrapper.
              <p id={ADD_CARD_ART_NOTE_ID} class="form-error">
                {t('ui.addCard.artInvalid', { reason: reason() })}
              </p>
            )}
          </Show>
        </Show>
      </div>
    </Show>
  )
}

/** The row where a step offers it: nothing at all without a host config. */
export const AddOptionsRow: Component<AddOptionsRowProps> = (props) => (
  <Show when={props.addOptions}>
    {(config) => (
      <AddCardOptions
        config={config()}
        labels={props.options.labels}
        setLabels={props.options.setLabels}
        art={props.options.art}
        setArt={props.options.setArt}
        artInput={props.options.artInput}
      />
    )}
  </Show>
)
