import { type Component, createSignal, For, Show } from 'solid-js'
import type { Finish, Condition } from '../../types'
import { VALID_FINISHES, VALID_CONDITIONS } from '../../finish-condition'
import { useT, useTKey } from '../../ui/i18n'
import type { ParameterlessKey } from '../../i18n/t'
import {
  type EditorDefaults,
  type UseEditorDefaultsResult,
  parseSetCodesInput,
  formatSetCodesForDisplay,
} from '../useEditorDefaults'

/**
 * Message keys, not rendered text: the table is built once at module load, so a
 * rendered string would keep the radio labels in the boot language after a
 * locale switch (plan §7.2).
 */
const FINISH_LABELS: Record<Finish, ParameterlessKey> = {
  nonfoil: 'ui.editor.finishNonfoil',
  foil: 'ui.editor.finishFoil',
  etched: 'ui.editor.finishEtched',
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
  const t = useT()
  const tKey = useTKey()
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
          {t('ui.editor.defaultsSets')}
        </label>
        <input
          id="defaults-sets"
          type="text"
          class="form-input editor-defaults-sets-input"
          placeholder={t('ui.editor.defaultsSetsPlaceholder')}
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
        <p class="form-hint editor-defaults-hint">{t('ui.editor.defaultsSetsHint')}</p>
      </div>

      <div class="editor-defaults-row">
        <span class="editor-defaults-label">{t('ui.field.finish')}</span>
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
            {t('ui.editor.defaultsAskEachTime')}
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
                {tKey(FINISH_LABELS[finish])}
              </label>
            )}
          </For>
        </div>
      </div>

      <Show when={props.showCondition}>
        <div class="editor-defaults-row">
          <span class="editor-defaults-label">{t('ui.field.condition')}</span>
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
              {t('ui.editor.defaultsAskEachTime')}
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
          {t('ui.editor.defaultsClear')}
        </button>
      </div>
    </div>
  )
}
