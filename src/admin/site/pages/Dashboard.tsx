import { type JSX, For } from 'solid-js'
import { PAGE_DISPLAY, type Page } from '../routing'
import { NavLink } from '../components/NavLink'
import { PageHeading } from '../components/PageHeading'

/** A dashboard tile: the page it opens, and what that page is for. */
type ActionCard = {
  page: Page
  description: string
}

/**
 * The pages worth a tile, in the order they are shown. Titles and icons come
 * from {@link PAGE_DISPLAY} — only the longer description is written here.
 */
const actions: ActionCard[] = [
  { page: 'list-editor', description: 'Edit decks, collections, and wanted lists' },
  { page: 'move-cards', description: 'Move cards between decks, collections, and wanted lists' },
  {
    page: 'list-manager',
    description: 'Create, rename, and delete decks, collections, and wanted lists',
  },
  { page: 'history', description: 'Compact and rewrite a list’s change log' },
  { page: 'import-deck', description: 'Import a deck from a URL or file' },
  { page: 'build-site', description: 'Generate the static website' },
  { page: 'cache-refresh', description: 'Refresh the card data cache' },
  { page: 'deck-sync', description: 'Pull or push deck changes with Archidekt' },
  { page: 'collection-sync', description: 'Pull or push collection changes with Archidekt' },
  { page: 'archidekt-login', description: 'Sign in to Archidekt' },
  { page: 'audit-log', description: 'View login and activity history' },
  { page: 'settings', description: 'Configure admin settings' },
]

export function Dashboard(): JSX.Element {
  return (
    <div>
      <PageHeading page="dashboard" />
      <div class="admin-grid">
        <For each={actions}>
          {(action) => (
            <NavLink page={action.page} class="admin-card">
              <div class="admin-card-icon">{PAGE_DISPLAY[action.page].icon}</div>
              <h3 class="admin-card-title">{PAGE_DISPLAY[action.page].label}</h3>
              <p class="admin-card-desc">{action.description}</p>
            </NavLink>
          )}
        </For>
      </div>
    </div>
  )
}
