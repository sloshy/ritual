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
  { id: 'deck-manager', label: 'Deck Manager', icon: '🗂️' },
  { id: 'collection-editor', label: 'Collection Editor', icon: '📦' },
  { id: 'wanted-list-editor', label: 'Wanted List Editor', icon: '🎯' },
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
    <div class="layout-root">
      {/* Header */}
      <header class="admin-header">
        <span class="admin-logo">⚗️ Ritual Admin</span>
        <div class="admin-header-actions">
          {onLogout && (
            <button class="btn btn-secondary btn-xs desktop-only" onClick={onLogout}>
              Logout
            </button>
          )}
          <button
            class="btn-mobile-menu mobile-only"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Toggle menu"
          >
            {menuOpen ? '✕' : '☰'}
          </button>
        </div>
      </header>
      <div class="layout-body">
        {/* Desktop sidebar */}
        <nav class="admin-sidebar admin-sidebar-panel desktop-only">
          {navList}
          {onLogout && <div class="sidebar-divider" />}
        </nav>
        {/* Mobile nav overlay */}
        {menuOpen && (
          <div>
            <div class="mobile-backdrop mobile-only" onClick={() => setMenuOpen(false)} />
            <nav class="mobile-nav mobile-only">
              <div class="mobile-nav-header">⚗️ Ritual Admin</div>
              {navList}
              {onLogout && (
                <div class="nav-divider">
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
        <main class={fullWidth ? 'main-content' : 'main-content-constrained'}>{children}</main>
      </div>
    </div>
  )
}
