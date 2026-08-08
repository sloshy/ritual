import { type JSX, batch, createSignal, untrack, Switch, Match, For } from 'solid-js'
import { type ListType, LIST_TYPES, LIST_TYPE_DISPLAY } from '../../../list-type'
import { useTKey } from '../../../ui/i18n'
import { useNavigationGuard } from '../../../editor/navigation-guard'
import { useRouting } from '../routing'
import { useSearchDebounce } from '../hooks/useSearchDebounce'
import { DeckEditor } from './DeckEditor'
import { CollectionEditor } from './CollectionEditor'
import { WantedListEditor } from './WantedListEditor'
import { PageHeading } from '../components/PageHeading'

/**
 * Single "Edit Lists" page hosting all three list editors. A type tab selects
 * which editor mounts; each editor supplies its own type-specific behavior
 * (commander sections, condition tracking, printing requirements, etc.).
 *
 * The open tab and the list being edited come from the page URL
 * (`#/edit/<type>/<slug>`) and are written back to it as they change, so the
 * address bar always names what is on screen and the link can be shared.
 */
export function ListEditor(): JSX.Element {
  const tKey = useTKey()
  const routing = useRouting()
  // A snapshot of where the URL pointed when this page mounted — arriving
  // anywhere else remounts it, so it never needs to track the route.
  const initial = untrack(routing.route)
  const editing = initial.page === 'list-editor' ? initial.editing : undefined
  const [activeType, setActiveType] = createSignal<ListType>(editing?.listType ?? 'deck')
  // A deep-linked slug only applies to the editor open on mount; switching tabs
  // clears it so the newly opened editor starts from its empty selector.
  const [deepLinkSlug, setDeepLinkSlug] = createSignal<string | null>(editing?.slug ?? null)
  const navigationGuard = useNavigationGuard()
  useSearchDebounce()

  // Selections made on this page rewrite the current history entry rather than
  // adding one, so Back leaves the editor instead of stepping through the lists
  // that were opened in it.
  const trackInUrl = (listType: ListType, slug: string | null) =>
    routing.replace({ page: 'list-editor', editing: { listType, slug: slug ?? undefined } })

  const selectType = (type: ListType) => {
    if (type === activeType()) return
    // Switching tabs unmounts the active editor; route through the guard so any
    // unsaved changes prompt for confirmation before they are dropped.
    navigationGuard.attempt(() => {
      batch(() => {
        setDeepLinkSlug(null)
        setActiveType(type)
      })
      trackInUrl(type, null)
    })
  }

  return (
    <div>
      <PageHeading page="list-editor" />

      <div class="list-type-tabs">
        <For each={LIST_TYPES}>
          {(type) => (
            <button
              class="list-type-tab"
              data-active={activeType() === type ? 'true' : undefined}
              onClick={() => selectType(type)}
            >
              <span class="nav-icon">{LIST_TYPE_DISPLAY[type].icon}</span>
              {tKey(LIST_TYPE_DISPLAY[type].label)}
            </button>
          )}
        </For>
      </div>

      <Switch>
        <Match when={activeType() === 'deck'}>
          <DeckEditor
            initialSlug={deepLinkSlug()}
            onSlugChange={(slug) => trackInUrl('deck', slug)}
          />
        </Match>
        <Match when={activeType() === 'collection'}>
          <CollectionEditor
            initialSlug={deepLinkSlug()}
            onSlugChange={(slug) => trackInUrl('collection', slug)}
          />
        </Match>
        <Match when={activeType() === 'wanted'}>
          <WantedListEditor
            initialSlug={deepLinkSlug()}
            onSlugChange={(slug) => trackInUrl('wanted', slug)}
          />
        </Match>
      </Switch>
    </div>
  )
}
