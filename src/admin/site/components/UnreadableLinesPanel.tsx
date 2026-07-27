import { type JSX, For } from 'solid-js'
import type { UnreadableSource } from '../../../sync-common'

/**
 * The browser's stand-in for the CLI's confirmation prompt: the run refused
 * these files because the parser could not read some of their lines, and
 * pressing the button is the explicit yes.
 *
 * Shared by both sync pages so the sentence a user reads before agreeing to lose
 * lines — and the markup the e2e specs assert against — cannot drift between
 * them. Only the noun, the consequence, and the button label differ.
 */
export type UnreadableLinesPanelProps = {
  sources: readonly UnreadableSource[]
  /** Singular noun for the count, e.g. `deck`; pluralized with a trailing `s`. */
  noun: string
  /** What syncing anyway would do to the listed lines. */
  consequence: string
  confirmLabel: string
  disabled: boolean
  onConfirm: () => void
}

export function UnreadableLinesPanel(props: UnreadableLinesPanelProps): JSX.Element {
  return (
    <div class="sync-unreadable">
      <p class="sync-unreadable-lead">
        {props.sources.length} {props.noun}
        {props.sources.length === 1 ? '' : 's'} contain lines Ritual cannot read.{' '}
        {props.consequence}
      </p>
      <ul class="sync-unreadable-list">
        <For each={props.sources}>
          {(source) => (
            <li>
              <span class="sync-unreadable-file">
                {source.file} ({source.name})
              </span>
              <For each={source.warnings}>
                {(warning) => <span class="sync-unreadable-line">{warning}</span>}
              </For>
            </li>
          )}
        </For>
      </ul>
      <button
        class="btn btn-secondary sync-unreadable-btn"
        disabled={props.disabled}
        onClick={() => props.onConfirm()}
      >
        {props.confirmLabel}
      </button>
    </div>
  )
}
