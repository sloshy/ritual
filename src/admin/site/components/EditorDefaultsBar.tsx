import { type Component, createMemo, createSignal, For, Show } from 'solid-js'
import type { Finish, Condition } from '../../../types'
import { VALID_FINISHES, VALID_CONDITIONS } from '../../../finish-condition'
import {
  type EditorDefaults,
  type UseEditorDefaultsResult,
  parseSetCodesInput,
  formatSetCodesForDisplay,
} from '../hooks/useEditorDefaults'

const FINISH_LABELS: Record<Finish, string> = {
  nonfoil: 'Nonfoil',
  foil: 'Foil',
  etched: 'Etched',
}

type EditorDefaultsBarProps = {
  defaults: UseEditorDefaultsResult
  /** Whether the condition default is offered for this list type. */
  showCondition: boolean
}

/** Read the current condition default, narrowing through the discriminated union. */
function readCondition(d: EditorDefaults): Condition | undefined {
  return d.kind === 'wanted' ? undefined : d.condition
}

export const EditorDefaultsBar: Component<EditorDefaultsBarProps> = (props) => {
  // The bar starts expanded if the user already has any defaults active —
  // making the active state visible without an extra click. After mount,
  // `expanded` is purely user-controlled (the toggle button), so the
  // initial-only read of `hasActive()` here is intentional, not reactive.
  const [expanded, setExpanded] = createSignal(props.defaults.hasActive())

  // `setsInput` is a draft input value that commits to the canonical state on
  // blur/Enter. The seed read of `defaults` is intentionally not reactive —
  // external mutations to sets go through `handleClear` which keeps the
  // draft in sync. Other set-of-codes mutations only happen via `commitSets`.
  const [setsInput, setSetsInput] = createSignal(
    formatSetCodesForDisplay(props.defaults.defaults().sets),
  )

  const d = createMemo(() => props.defaults.defaults())

  const summary = createMemo(() => {
    const v = d()
    const parts: string[] = []
    if (v.sets.length > 0) parts.push(`Sets: ${v.sets.map((s) => s.toUpperCase()).join(', ')}`)
    if (v.finish) parts.push(`Finish: ${FINISH_LABELS[v.finish]}`)
    if (props.showCondition) {
      const cond = readCondition(v)
      if (cond) parts.push(`Condition: ${cond}`)
    }
    return parts
  })

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
    <div class="editor-defaults">
      <button
        type="button"
        class="editor-defaults-toggle"
        aria-expanded={expanded()}
        onClick={() => setExpanded((v) => !v)}
      >
        <span class="editor-defaults-toggle-icon">{expanded() ? '▾' : '▸'}</span>
        <span class="editor-defaults-toggle-label">Add Card Defaults</span>
        <Show when={!expanded()}>
          <Show
            when={summary().length > 0}
            fallback={<span class="editor-defaults-summary text-muted">none</span>}
          >
            <span class="editor-defaults-summary">
              <For each={summary()}>
                {(part) => <span class="editor-defaults-chip">{part}</span>}
              </For>
            </span>
          </Show>
        </Show>
      </button>

      <Show when={expanded()}>
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
              When set, the printing picker shows only matching printings (with fallback to all if
              none match). Comma-separated, case-insensitive.
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
      </Show>
    </div>
  )
}
