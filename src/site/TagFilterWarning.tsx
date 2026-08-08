import { type Component, Show, For, createSignal } from 'solid-js'
import { useT } from '../ui/i18n'

type TagFilterWarningProps = {
  /**
   * Names of cards added during this edit session that have no tag data, so the
   * active Oracle/Art tag filter cannot match them.
   */
  untaggedCardNames: string[]
}

/**
 * Warning shown while editing a list and filtering by tags, when one or more cards
 * added this session have no tag data. Cards added via the in-browser editor come
 * from the Scryfall search API, which doesn't return Tagger tags — so a tag filter
 * silently excludes them even if they would otherwise match. Collapsed by default;
 * expands to name the affected cards.
 */
export const TagFilterWarning: Component<TagFilterWarningProps> = (props) => {
  const t = useT()
  const [open, setOpen] = createSignal(false)
  const count = () => props.untaggedCardNames.length

  return (
    <Show when={count() > 0}>
      <div class="tag-filter-warning">
        <button
          type="button"
          class="tag-filter-warning-toggle"
          aria-expanded={open()}
          onClick={() => setOpen((o) => !o)}
        >
          <span class="tag-filter-warning-icon" aria-hidden="true">
            ⚠
          </span>
          <span>{t('site.tagFilter.untagged', { count: count() })}</span>
          <span class="tag-filter-warning-caret" aria-hidden="true">
            {open() ? '▾' : '▸'}
          </span>
        </button>
        <Show when={open()}>
          <ul class="tag-filter-warning-list">
            <For each={props.untaggedCardNames}>{(name) => <li>{name}</li>}</For>
          </ul>
        </Show>
      </div>
    </Show>
  )
}
