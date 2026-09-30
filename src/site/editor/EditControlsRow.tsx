import { type Component, For, Show, createMemo } from 'solid-js'
import { useT, useTSegments } from '../../ui/i18n'
import { MenuButton, type MenuButtonItem } from '../../ui/MenuButton'
import { useMobileLayout } from '../../ui/useMediaQuery'
import type { EditChrome } from './edit-chrome'

/** The row's actions, in visual order. */
type EditRowAction = 'swap-printings' | 'discard' | 'load-changes' | 'export'

/** A row action: always named, since its id picks the inline button's class. */
type EditRowItem = MenuButtonItem<EditRowAction> & { action: EditRowAction }

/** An action's inline button class: Export is the row's primary action. */
function inlineClass(action: EditRowAction): string {
  return action === 'export' ? 'btn btn-export' : `btn btn-secondary btn-${action}`
}

type EditControlsRowProps = {
  chrome: EditChrome
}

/**
 * The editor control row shown as a second row of the navbar while editing a list.
 * Hosts the "local copy" notice, the Original/Edited toggle, Swap Printings, Discard,
 * Load Changes, and Export — the last four behind a "⋯" menu in the phone layout.
 * Exit lives in the navbar's top-right Edit/Done toggle, not here.
 */
export const EditControlsRow: Component<EditControlsRowProps> = (props) => {
  const t = useT()
  const tSegments = useTSegments()
  const count = () => props.chrome.changeCount()
  // The phone layout keeps the row short: the notice and the view toggle stay
  // inline, and the actions move into a "⋯" menu.
  const compact = useMobileLayout()
  // Built once: the fields that change are getters, so neither the inline
  // buttons nor the menu rows remount (and lose focus) on every edit.
  const swapPrintings: EditRowItem = {
    action: 'swap-printings',
    get label() {
      return t('site.editor.swapPrintings')
    },
    onSelect: () => props.chrome.onSwapPrintings?.(),
  }
  const always: EditRowItem[] = [
    {
      action: 'discard',
      get label() {
        return t('site.editor.discard')
      },
      onSelect: () => props.chrome.onDiscard(),
      get disabled() {
        return count() === 0
      },
    },
    {
      action: 'load-changes',
      get label() {
        return t('site.editor.loadChanges')
      },
      onSelect: () => props.chrome.onLoadChanges(),
    },
    {
      action: 'export',
      get label() {
        return t('site.editor.export')
      },
      onSelect: () => props.chrome.onExport(),
    },
  ]
  const actions = createMemo(() =>
    props.chrome.onSwapPrintings ? [swapPrintings, ...always] : always,
  )
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

        <Show
          when={compact()}
          fallback={
            <For each={actions()}>
              {(action) => (
                <button
                  type="button"
                  class={inlineClass(action.action)}
                  disabled={action.disabled}
                  onClick={action.onSelect}
                >
                  {action.label}
                </button>
              )}
            </For>
          }
        >
          <MenuButton
            items={actions()}
            buttonClass="btn btn-secondary edit-banner-more"
            trigger={() => <span aria-hidden="true">⋯</span>}
            title={t('site.editor.moreActions')}
            ariaLabel={t('site.editor.moreActions')}
          />
        </Show>
      </div>
    </div>
  )
}
