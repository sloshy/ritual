import type { ParentComponent } from 'solid-js'
import { createSignal, For, Show } from 'solid-js'
import type { Page, NavigateFn } from '../types'

interface NavItem {
  id: Page
  label: string
  icon: string
}

const navItems: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '📊' },
  { id: 'list-editor', label: 'Edit Lists', icon: '✏️' },
  { id: 'move-cards', label: 'Move Cards', icon: '➡️' },
  { id: 'list-manager', label: 'Manage Lists', icon: '🗂️' },
  { id: 'history', label: 'Change History', icon: '🕘' },
  { id: 'import-deck', label: 'Import Deck', icon: '📥' },
  { id: 'import-csv', label: 'Import CSV', icon: '📄' },
  { id: 'build-site', label: 'Build Site', icon: '🔨' },
  { id: 'cache-refresh', label: 'Refresh Cache', icon: '🔄' },
  { id: 'archidekt-login', label: 'Archidekt Login', icon: '🔑' },
  { id: 'audit-log', label: 'Audit Log', icon: '📋' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
]

interface LayoutProps {
  currentPage: Page
  onNavigate: NavigateFn
  onLogout?: () => void
  fullWidth?: boolean
}

export const Layout: ParentComponent<LayoutProps> = (props) => {
  const [menuOpen, setMenuOpen] = createSignal(false)

  const handleNav = (page: Page) => {
    props.onNavigate(page)
    setMenuOpen(false)
  }

  const navList = () => (
    <For each={navItems}>
      {(item) => (
        <button
          class="admin-nav-item"
          data-active={props.currentPage === item.id ? 'true' : undefined}
          onClick={() => handleNav(item.id)}
        >
          <span class="nav-icon">{item.icon}</span>
          {item.label}
        </button>
      )}
    </For>
  )

  return (
    <div class="layout-root">
      {/* Header */}
      <header class="admin-header">
        <span class="admin-logo">⚗️ Ritual Admin</span>
        <div class="admin-header-actions">
          <Show when={props.onLogout}>
            {(logout) => (
              <button class="btn btn-secondary btn-xs desktop-only" onClick={() => logout()()}>
                Logout
              </button>
            )}
          </Show>
          <button
            class="btn-mobile-menu mobile-only"
            onClick={() => setMenuOpen(!menuOpen())}
            aria-label="Toggle menu"
          >
            {menuOpen() ? '✕' : '☰'}
          </button>
        </div>
      </header>
      <div class="layout-body">
        {/* Desktop sidebar */}
        <nav class="admin-sidebar admin-sidebar-panel desktop-only">
          {navList()}
          <Show when={props.onLogout}>
            <div class="sidebar-divider" />
          </Show>
        </nav>
        {/* Mobile nav overlay */}
        <Show when={menuOpen()}>
          <div>
            <div class="mobile-backdrop mobile-only" onClick={() => setMenuOpen(false)} />
            <nav class="mobile-nav mobile-only">
              <div class="mobile-nav-header">⚗️ Ritual Admin</div>
              {navList()}
              <Show when={props.onLogout}>
                {(logout) => (
                  <div class="nav-divider">
                    <button
                      class="admin-nav-item"
                      onClick={() => {
                        setMenuOpen(false)
                        logout()()
                      }}
                    >
                      <span class="nav-icon">🚪</span>
                      Logout
                    </button>
                  </div>
                )}
              </Show>
            </nav>
          </div>
        </Show>
        {/* Main content */}
        <main class={props.fullWidth ? 'main-content' : 'main-content-constrained'}>
          {props.children}
        </main>
      </div>
    </div>
  )
}
