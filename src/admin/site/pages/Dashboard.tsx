import { type JSX, For } from 'solid-js'
import type { Page, NavigateFn } from '../types'

interface ActionCard {
  id: Page
  title: string
  description: string
  icon: string
}

const actions: ActionCard[] = [
  {
    id: 'deck-editor',
    title: 'Deck Editor',
    description: 'Edit deck contents and cards',
    icon: '✏️',
  },
  {
    id: 'collection-editor',
    title: 'Collection Editor',
    description: 'Edit collection contents and cards',
    icon: '📦',
  },
  {
    id: 'wanted-list-editor',
    title: 'Wanted List Editor',
    description: 'Edit wanted card lists',
    icon: '🎯',
  },
  {
    id: 'list-manager',
    title: 'Manage Lists',
    description: 'Create, rename, and delete decks, collections, and wanted lists',
    icon: '🗂️',
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

interface DashboardProps {
  onNavigate: NavigateFn
}

export function Dashboard(props: DashboardProps): JSX.Element {
  return (
    <div>
      <h2 class="section-heading">Dashboard</h2>
      <div class="admin-grid">
        <For each={actions}>
          {(action) => (
            <button class="admin-card" onClick={() => props.onNavigate(action.id)}>
              <div class="admin-card-icon">{action.icon}</div>
              <h3 class="admin-card-title">{action.title}</h3>
              <p class="admin-card-desc">{action.description}</p>
            </button>
          )}
        </For>
      </div>
    </div>
  )
}
