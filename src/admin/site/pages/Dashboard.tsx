import type { Page } from '../types'

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
    id: 'deck-manager',
    title: 'Deck Manager',
    description: 'Create, rename, and delete decks',
    icon: '🗂️',
  },
  {
    id: 'collection-editor',
    title: 'Collection Editor',
    description: 'Edit collection contents and cards',
    icon: '📦',
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
  { id: 'settings', title: 'Settings', description: 'Configure admin settings', icon: '⚙️' },
]

interface DashboardProps {
  onNavigate: (page: Page) => void
}

export function Dashboard({ onNavigate }: DashboardProps) {
  return (
    <div>
      <h2 class="section-heading">Dashboard</h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {actions.map((action) => (
          <button key={action.id} class="admin-card" onClick={() => onNavigate(action.id)}>
            <div class="admin-card-icon">{action.icon}</div>
            <h3 class="admin-card-title">{action.title}</h3>
            <p class="admin-card-desc">{action.description}</p>
          </button>
        ))}
      </div>
    </div>
  )
}
