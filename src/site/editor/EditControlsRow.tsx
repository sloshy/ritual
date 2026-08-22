import { type Component, For, Show } from 'solid-js'
import { useT, useTSegments } from '../../ui/i18n'
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
  const t = useT()
  const tSegments = useTSegments()
  const count = () => props.chrome.changeCount()
  // The stressed phrase is a parameter, not hard-coded markup, so a translator
  // can put it anywhere in the sentence (plan §4.6).
  const notice = () =>
    tSegments('site.editor.localCopy', { emphasis: t('site.editor.localCopyEmphasis') })
  return (
    <div class="edit-banner" role="status">
      <div class="edit-banner-label">
        <span class="edit-banner-icon" aria-hidden="true">
          ✎
        </span>
        <span>
          <For each={notice()}>
            {(segment) =>
              segment.kind === 'param' ? <strong>{segment.value}</strong> : segment.value
            }
          </For>
          <Show when={count() > 0}> ({t('ui.count.changes', { count: count() })})</Show>
        </span>
      </div>

      <div class="edit-banner-controls">
        <div class="edit-banner-toggle" role="group" aria-label={t('site.editor.viewToggle')}>
          <button
            type="button"
            class="edit-banner-toggle-btn"
            classList={{ 'edit-banner-toggle-btn--active': props.chrome.view() === 'original' }}
            aria-pressed={props.chrome.view() === 'original'}
            onClick={() => props.chrome.setView('original')}
          >
            {t('site.editor.viewOriginal')}
          </button>
          <button
            type="button"
            class="edit-banner-toggle-btn"
            classList={{ 'edit-banner-toggle-btn--active': props.chrome.view() === 'edited' }}
            aria-pressed={props.chrome.view() === 'edited'}
            onClick={() => props.chrome.setView('edited')}
          >
            {t('site.editor.viewEdited')}
          </button>
        </div>

        <Show when={props.chrome.onSwapPrintings}>
          {(swapPrintings) => (
            <button
              type="button"
              class="btn btn-secondary btn-swap-printings"
              onClick={() => swapPrintings()()}
            >
              {t('site.editor.swapPrintings')}
            </button>
          )}
        </Show>
        <button
          type="button"
          class="btn btn-secondary"
          disabled={count() === 0}
          onClick={props.chrome.onDiscard}
        >
          {t('site.editor.discard')}
        </button>
        <button type="button" class="btn btn-secondary" onClick={props.chrome.onLoadChanges}>
          {t('site.editor.loadChanges')}
        </button>
        <button type="button" class="btn btn-export" onClick={props.chrome.onExport}>
          {t('site.editor.export')}
        </button>
      </div>
    </div>
  )
}
