import { type Component, Show } from 'solid-js'
import type { EditChrome } from './edit-chrome'

type EditControlsRowProps = {
  chrome: EditChrome
}

/**
 * The editor control row shown as a second row of the navbar while editing a list.
 * Hosts the "local copy" notice, the Original/Edited toggle, Discard, Export, and
 * Load Changes. Exit lives in the navbar's top-right Edit/Done toggle, not here.
 */
export const EditControlsRow: Component<EditControlsRowProps> = (props) => {
  const count = () => props.chrome.changeCount()
  return (
    <div class="edit-banner" role="status">
      <div class="edit-banner-label">
        <span class="edit-banner-icon" aria-hidden="true">
          ✎
        </span>
        <span>
          Editing a local copy — <strong>not the published version</strong>
          <Show when={count() > 0}>
            {' '}
            ({count()} {count() === 1 ? 'change' : 'changes'})
          </Show>
        </span>
      </div>

      <div class="edit-banner-controls">
        <div class="edit-banner-toggle" role="group" aria-label="View original or edited">
          <button
            type="button"
            class="edit-banner-toggle-btn"
            classList={{ 'edit-banner-toggle-btn--active': props.chrome.view() === 'original' }}
            aria-pressed={props.chrome.view() === 'original'}
            onClick={() => props.chrome.setView('original')}
          >
            Original
          </button>
          <button
            type="button"
            class="edit-banner-toggle-btn"
            classList={{ 'edit-banner-toggle-btn--active': props.chrome.view() === 'edited' }}
            aria-pressed={props.chrome.view() === 'edited'}
            onClick={() => props.chrome.setView('edited')}
          >
            Edited
          </button>
        </div>

        <button
          type="button"
          class="btn btn-secondary"
          disabled={count() === 0}
          onClick={props.chrome.onDiscard}
        >
          Discard
        </button>
        <button type="button" class="btn btn-secondary" onClick={props.chrome.onLoadChanges}>
          Load Changes…
        </button>
        <button type="button" class="btn btn-export" onClick={props.chrome.onExport}>
          Export…
        </button>
      </div>
    </div>
  )
}
