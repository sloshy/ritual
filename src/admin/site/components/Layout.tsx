import type { ComponentChildren } from 'preact'
import { useState, useCallback } from 'preact/hooks'
import type { Page } from '../types'

interface NavItem {
  id: Page
  label: string
  icon: string
}

const navItems: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '📊' },
  { id: 'deck-editor', label: 'Deck Editor', icon: '✏️' },
  { id: 'collection-editor', label: 'Collection Editor', icon: '📦' },
  { id: 'import-deck', label: 'Import Deck', icon: '📥' },
  { id: 'build-site', label: 'Build Site', icon: '🔨' },
  { id: 'cache-refresh', label: 'Refresh Cache', icon: '🔄' },
  { id: 'archidekt-login', label: 'Archidekt Login', icon: '🔑' },
  { id: 'audit-log', label: 'Audit Log', icon: '📋' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
]

interface LayoutProps {
  currentPage: Page
  onNavigate: (page: Page) => void
  onLogout?: () => void
  children?: ComponentChildren
  fullWidth?: boolean
}

export function Layout({ currentPage, onNavigate, onLogout, children, fullWidth }: LayoutProps) {
  const [menuOpen, setMenuOpen] = useState(false)

  const handleNav = useCallback(
    (page: Page) => {
      onNavigate(page)
      setMenuOpen(false)
    },
    [onNavigate],
  )

  const navList = navItems.map((item) => (
    <button
      key={item.id}
      class="admin-nav-item"
      data-active={currentPage === item.id ? 'true' : undefined}
      onClick={() => handleNav(item.id)}
    >
      <span class="nav-icon">{item.icon}</span>
      {item.label}
    </button>
  ))

  return (
    <div style="min-height: 100vh; display: flex; flex-direction: column;">
      {/* Header */}
      <header class="admin-header">
        <span class="admin-logo">⚗️ Ritual Admin</span>
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          {onLogout && (
            <button
              class="btn btn-secondary desktop-only"
              onClick={onLogout}
              style="padding: 0.25rem 0.75rem; font-size: 0.75rem;"
            >
              Logout
            </button>
          )}
          <button
            class="mobile-only"
            style="padding: 0.5rem; background: none; border: none; color: var(--text-secondary); cursor: pointer; font-size: 1.25rem;"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Toggle menu"
          >
            {menuOpen ? '✕' : '☰'}
          </button>
        </div>
      </header>
      <div style="display: flex; flex: 1;">
        {/* Desktop sidebar */}
        <nav
          class="admin-sidebar desktop-only"
          style="width: 14rem; min-height: calc(100vh - 3rem); padding-top: 0.5rem;"
        >
          {navList}
          {onLogout && (
            <div style="margin-top: auto; padding-top: 0.5rem; border-top: 1px solid var(--border); margin: 0.5rem 0;" />
          )}
        </nav>
        {/* Mobile nav overlay */}
        {menuOpen && (
          <div>
            <div class="mobile-backdrop mobile-only" onClick={() => setMenuOpen(false)} />
            <nav class="mobile-nav mobile-only">
              <div style="padding: 0.75rem 1rem 0.75rem; font-weight: 700; color: var(--text-accent); font-size: 0.875rem; border-bottom: 1px solid var(--border); margin-bottom: 0.5rem;">
                ⚗️ Ritual Admin
              </div>
              {navList}
              {onLogout && (
                <div style="border-top: 1px solid var(--border); margin-top: 0.5rem; padding-top: 0.5rem;">
                  <button
                    class="admin-nav-item"
                    onClick={() => {
                      setMenuOpen(false)
                      onLogout()
                    }}
                  >
                    <span class="nav-icon">🚪</span>
                    Logout
                  </button>
                </div>
              )}
            </nav>
          </div>
        )}
        {/* Main content */}
        <main style={`flex: 1; padding: 1.5rem;${fullWidth ? '' : ' max-width: 56rem;'}`}>
          {children}
        </main>
      </div>
    </div>
  )
}
