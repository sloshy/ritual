import { type JSX, For } from 'solid-js'
import type { Page } from '../routing'
import { NavLink } from '../components/NavLink'

interface ActionCard {
  id: Page
  title: string
  description: string
  icon: string
}

const actions: ActionCard[] = [
  {
    id: 'list-editor',
    title: 'Edit Lists',
    description: 'Edit decks, collections, and wanted lists',
    icon: '✏️',
  },
  {
    id: 'move-cards',
    title: 'Move Cards',
    description: 'Move cards between decks, collections, and wanted lists',
    icon: '➡️',
  },
  {
    id: 'list-manager',
    title: 'Manage Lists',
    description: 'Create, rename, and delete decks, collections, and wanted lists',
    icon: '🗂️',
  },
  {
    id: 'history',
    title: 'Change History',
    description: 'Compact and rewrite a list’s change log',
    icon: '🕘',
  },
  {
    id: 'import-deck',
    title: 'Import Deck',
    description: 'Import a deck from a URL or file',
    icon: '📥',
  },
  { id: 'build-site', title: 'Build Site', description: 'Generate the static website', icon: '🔨' },
  {
    id: 'cache-refresh',
    title: 'Refresh Cache',
    description: 'Refresh the card data cache',
    icon: '🔄',
  },
  {
    id: 'deck-sync',
    title: 'Sync Decks',
    description: 'Pull or push deck changes with Archidekt',
    icon: '🔁',
  },
  {
    id: 'archidekt-login',
    title: 'Archidekt Login',
    description: 'Sign in to Archidekt',
    icon: '🔑',
  },
  {
    id: 'audit-log',
    title: 'Audit Log',
    description: 'View login and activity history',
    icon: '📋',
  },
  { id: 'settings', title: 'Settings', description: 'Configure admin settings', icon: '⚙️' },
]

export function Dashboard(): JSX.Element {
  return (
    <div>
      <h2 class="section-heading">Dashboard</h2>
      <div class="admin-grid">
        <For each={actions}>
          {(action) => (
            <NavLink page={action.id} class="admin-card">
              <div class="admin-card-icon">{action.icon}</div>
              <h3 class="admin-card-title">{action.title}</h3>
              <p class="admin-card-desc">{action.description}</p>
            </NavLink>
          )}
        </For>
      </div>
    </div>
  )
}
