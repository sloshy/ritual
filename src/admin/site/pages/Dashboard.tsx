import { type JSX, For } from 'solid-js'
import { useTKey } from '../../../ui/i18n'
import { PAGE_DISPLAY, type Page } from '../routing'
import { NavLink } from '../components/NavLink'
import { PageHeading } from '../components/PageHeading'
import type { ParameterlessKey } from '../../../i18n/t'

/**
 * A dashboard tile: the page it opens, and what that page is for.
 *
 * `descriptionKey` is a {@link MessageKey} rather than rendered text — the table
 * below is evaluated once at module load, so a string would leave every tile in
 * the boot-time language after a locale switch.
 */
type ActionCard = {
  page: Page
  descriptionKey: ParameterlessKey
}

/**
 * The pages worth a tile, in the order they are shown. Titles and icons come
 * from {@link PAGE_DISPLAY} — only the longer description is written here.
 */
const actions: ActionCard[] = [
  { page: 'list-editor', descriptionKey: 'admin.dashboard.listEditor' },
  { page: 'move-cards', descriptionKey: 'admin.dashboard.moveCards' },
  { page: 'list-manager', descriptionKey: 'admin.dashboard.listManager' },
  { page: 'history', descriptionKey: 'admin.dashboard.history' },
  { page: 'import-deck', descriptionKey: 'admin.dashboard.importDeck' },
  { page: 'build-site', descriptionKey: 'admin.dashboard.buildSite' },
  { page: 'cache-refresh', descriptionKey: 'admin.dashboard.cacheRefresh' },
  { page: 'deck-sync', descriptionKey: 'admin.dashboard.deckSync' },
  { page: 'collection-sync', descriptionKey: 'admin.dashboard.collectionSync' },
  { page: 'archidekt-login', descriptionKey: 'admin.dashboard.archidektLogin' },
  { page: 'audit-log', descriptionKey: 'admin.dashboard.auditLog' },
  { page: 'settings', descriptionKey: 'admin.dashboard.settings' },
]

export function Dashboard(): JSX.Element {
  const tKey = useTKey()
  return (
    <div>
      <PageHeading page="dashboard" />
      <div class="admin-grid">
        <For each={actions}>
          {(action) => (
            <NavLink page={action.page} class="admin-card">
              <div class="admin-card-icon">{PAGE_DISPLAY[action.page].icon}</div>
              <h3 class="admin-card-title">{tKey(PAGE_DISPLAY[action.page].label)}</h3>
              <p class="admin-card-desc">{tKey(action.descriptionKey)}</p>
            </NavLink>
          )}
        </For>
      </div>
    </div>
  )
}
