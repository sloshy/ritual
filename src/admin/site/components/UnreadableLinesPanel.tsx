import { type JSX, For } from 'solid-js'
import { useT } from '../../../ui/i18n'
import type { UnreadableSource } from '../../../sync-common'

/**
 * The lead sentence, which names the kind of file the run refused. A message
 * key rather than a noun to splice into one sentence: "N decks contain lines…"
 * inflects the noun *and* the verb, and only the catalog can express that.
 */
export type UnreadableLeadKey = 'admin.sync.unreadableDecks' | 'admin.sync.unreadableLists'

/**
 * The browser's stand-in for the CLI's confirmation prompt: the run refused
 * these files because the parser could not read some of their lines, and
 * pressing the button is the explicit yes.
 *
 * Shared by both sync pages so the sentence a user reads before agreeing to lose
 * lines — and the markup the e2e specs assert against — cannot drift between
 * them. Only the lead, the consequence, and the button label differ.
 */
export type UnreadableLinesPanelProps = {
  sources: readonly UnreadableSource[]
  /** Which lead sentence to render — one per synced file kind. */
  leadKey: UnreadableLeadKey
  /** What syncing anyway would do to the listed lines. */
  consequence: string
  confirmLabel: string
  disabled: boolean
  onConfirm: () => void
}

export function UnreadableLinesPanel(props: UnreadableLinesPanelProps): JSX.Element {
  const t = useT()
  return (
    <div class="sync-unreadable">
      <p class="sync-unreadable-lead">
        {t(props.leadKey, { count: props.sources.length })} {props.consequence}
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
