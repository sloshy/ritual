import { type Component, createSignal, For, Show } from 'solid-js'
import type { Finish, Condition } from '../../types'
import { VALID_FINISHES, VALID_CONDITIONS } from '../../finish-condition'
import {
  type EditorDefaults,
  type UseEditorDefaultsResult,
  parseSetCodesInput,
  formatSetCodesForDisplay,
} from '../useEditorDefaults'

const FINISH_LABELS: Record<Finish, string> = {
  nonfoil: 'Nonfoil',
  foil: 'Foil',
  etched: 'Etched',
}

type EditorDefaultsFormProps = {
  defaults: UseEditorDefaultsResult
  /** Whether the condition default is offered for this list type. */
  showCondition: boolean
}

/** Read the current condition default, narrowing through the discriminated union. */
function readCondition(d: EditorDefaults): Condition | undefined {
  return d.kind === 'wanted' ? undefined : d.condition
}

/**
 * The add-card defaults form (set codes, finish, condition). Rendered inside the
 * editor action bar's expandable defaults panel; the expand/collapse toggle and
 * active-state indicator live on the action bar itself.
 */
export const EditorDefaultsForm: Component<EditorDefaultsFormProps> = (props) => {
  // `setsInput` is a draft input value that commits to the canonical state on
  // blur/Enter. The seed read of `defaults` is intentionally not reactive —
  // external mutations to sets go through `handleClear` which keeps the draft
  // in sync. The action bar mounts/unmounts this form via a <Show>, so the seed
  // also re-reads the committed value on each panel reopen (an uncommitted draft
  // is intentionally discarded when the panel is closed).
  const [setsInput, setSetsInput] = createSignal(
    formatSetCodesForDisplay(props.defaults.defaults().sets),
  )

  // `props.defaults.defaults` is already a memoized accessor; wrap it in a plain
  // function so reads stay reactive without adding a redundant memo node.
  const d = () => props.defaults.defaults()

  const commitSets = () => {
    const codes = parseSetCodesInput(setsInput())
    props.defaults.setSets(codes)
    setSetsInput(formatSetCodesForDisplay(codes))
  }

  const handleClear = () => {
    props.defaults.clear()
    setSetsInput('')
  }

  return (
    <div class="editor-defaults-body">
      <div class="editor-defaults-row">
        <label class="editor-defaults-label" for="defaults-sets">
          Set codes
        </label>
        <input
          id="defaults-sets"
          type="text"
          class="form-input editor-defaults-sets-input"
          placeholder="e.g. FDN, SPG"
          value={setsInput()}
          onInput={(e) => setSetsInput(e.currentTarget.value)}
          onBlur={commitSets}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitSets()
            }
          }}
        />
        <p class="form-hint editor-defaults-hint">
          When set, the printing picker shows only matching printings (with fallback to all if none
          match). Comma-separated, case-insensitive.
        </p>
      </div>

      <div class="editor-defaults-row">
        <span class="editor-defaults-label">Finish</span>
        <div class="editor-defaults-options">
          <label
            class={`editor-defaults-option${d().finish === undefined ? ' editor-defaults-option--selected' : ''}`}
          >
            <input
              type="radio"
              name="defaults-finish"
              checked={d().finish === undefined}
              onChange={() => props.defaults.setFinish(undefined)}
            />
            Ask each time
          </label>
          <For each={VALID_FINISHES}>
            {(finish) => (
              <label
                class={`editor-defaults-option${d().finish === finish ? ' editor-defaults-option--selected' : ''}`}
              >
                <input
                  type="radio"
                  name="defaults-finish"
                  checked={d().finish === finish}
                  onChange={() => props.defaults.setFinish(finish)}
                />
                {FINISH_LABELS[finish]}
              </label>
            )}
          </For>
        </div>
      </div>

      <Show when={props.showCondition}>
        <div class="editor-defaults-row">
          <span class="editor-defaults-label">Condition</span>
          <div class="editor-defaults-options">
            <label
              class={`editor-defaults-option${readCondition(d()) === undefined ? ' editor-defaults-option--selected' : ''}`}
            >
              <input
                type="radio"
                name="defaults-condition"
                checked={readCondition(d()) === undefined}
                onChange={() => props.defaults.setCondition(undefined)}
              />
              Ask each time
            </label>
            <For each={VALID_CONDITIONS}>
              {(condition: Condition) => (
                <label
                  class={`editor-defaults-option${readCondition(d()) === condition ? ' editor-defaults-option--selected' : ''}`}
                >
                  <input
                    type="radio"
                    name="defaults-condition"
                    checked={readCondition(d()) === condition}
                    onChange={() => props.defaults.setCondition(condition)}
                  />
                  {condition}
                </label>
              )}
            </For>
          </div>
        </div>
      </Show>

      <div class="editor-defaults-actions">
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          onClick={handleClear}
          disabled={!props.defaults.hasActive()}
        >
          Clear all
        </button>
      </div>
    </div>
  )
}
