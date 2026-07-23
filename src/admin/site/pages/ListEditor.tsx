import { type JSX, createSignal, Switch, Match, For } from 'solid-js'
import { type ListType, LIST_TYPES, LIST_TYPE_DISPLAY } from '../../../list-type'
import { useNavigationGuard } from '../../../editor/navigation-guard'
import { useSearchDebounce } from '../hooks/useSearchDebounce'
import { DeckEditor } from './DeckEditor'
import { CollectionEditor } from './CollectionEditor'
import { WantedListEditor } from './WantedListEditor'

type ListEditorProps = {
  /** List type whose tab opens first (defaults to decks). */
  initialType?: ListType | null
  /** Slug to pre-select, valid only for the initially active type. */
  initialSlug?: string | null
}

/**
 * Single "Edit Lists" page hosting all three list editors. A type tab selects
 * which editor mounts; each editor supplies its own type-specific behavior
 * (commander sections, condition tracking, printing requirements, etc.).
 */
export function ListEditor(props: ListEditorProps): JSX.Element {
  const [activeType, setActiveType] = createSignal<ListType>(props.initialType ?? 'deck')
  // A deep-linked slug only applies to the editor open on mount; switching tabs
  // clears it so the newly opened editor starts from its empty selector.
  const [deepLinkSlug, setDeepLinkSlug] = createSignal<string | null>(props.initialSlug ?? null)
  const navigationGuard = useNavigationGuard()
  useSearchDebounce()

  const selectType = (type: ListType) => {
    if (type === activeType()) return
    // Switching tabs unmounts the active editor; route through the guard so any
    // unsaved changes prompt for confirmation before they are dropped.
    navigationGuard.attempt(() => {
      setDeepLinkSlug(null)
      setActiveType(type)
    })
  }

  return (
    <div>
      <h2 class="section-heading">✏️ Edit Lists</h2>

      <div class="list-type-tabs">
        <For each={LIST_TYPES}>
          {(type) => (
            <button
              class="list-type-tab"
              data-active={activeType() === type ? 'true' : undefined}
              onClick={() => selectType(type)}
            >
              <span class="nav-icon">{LIST_TYPE_DISPLAY[type].icon}</span>
              {LIST_TYPE_DISPLAY[type].label}
            </button>
          )}
        </For>
      </div>

      <Switch>
        <Match when={activeType() === 'deck'}>
          <DeckEditor initialSlug={deepLinkSlug()} />
        </Match>
        <Match when={activeType() === 'collection'}>
          <CollectionEditor initialSlug={deepLinkSlug()} />
        </Match>
        <Match when={activeType() === 'wanted'}>
          <WantedListEditor initialSlug={deepLinkSlug()} />
        </Match>
      </Switch>
    </div>
  )
}
