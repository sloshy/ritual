import type { ParentComponent } from 'solid-js'
import { createMemo, createSignal, For, Show } from 'solid-js'
import { type Page, useRouting } from '../routing'
import { NavLink } from './NavLink'
import { FlameIcon } from '../../../site/FlameIcon'
import { SelectionMenu } from '../../../site/SelectionMenu'
import {
  SelectionModal,
  isSelectionViewOpen,
  closeSelectionView,
} from '../../../site/SelectionModal'
import type { NamedListRef } from '../../../site/combined-list'
import { useAllSelections } from '../../../site/useCardSelection'
import { moveSelectedAdmin, removeSelectedAdmin } from '../remove-selected'
import { useAdminLists, listInfosToNamedRefs } from '../move-targets'

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
  { id: 'import-changes', label: 'Import Changes', icon: '📩' },
  { id: 'build-site', label: 'Build Site', icon: '🔨' },
  { id: 'cache-refresh', label: 'Refresh Cache', icon: '🔄' },
  { id: 'deck-sync', label: 'Sync Decks', icon: '🔁' },
  { id: 'archidekt-login', label: 'Archidekt Login', icon: '🔑' },
  { id: 'audit-log', label: 'Audit Log', icon: '📋' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
]

/** Pages whose content spans the full window rather than the reading-width column. */
const FULL_WIDTH_PAGES: readonly Page[] = ['list-editor', 'move-cards']

interface LayoutProps {
  onLogout?: () => void
}

export const Layout: ParentComponent<LayoutProps> = (props) => {
  const [menuOpen, setMenuOpen] = createSignal(false)
  const routing = useRouting()
  // Memoized: the editor rewrites the route as its list selection changes, which
  // must not re-run the active state of all 14 nav links.
  const currentPage = createMemo((): Page => routing.route().page)

  // Cross-list selection button: always present (self-hides when nothing is
  // selected). The admin site has no trade page, so it offers copy/clear plus a
  // server-backed "Remove all selected" that deletes the cards from their lists.
  const allSelections = useAllSelections()
  const lists = useAdminLists()

  const handleRemoveAll = () => {
    const cards = allSelections.selected()
    const count = cards.reduce((sum, c) => sum + c.quantity, 0)
    if (!window.confirm(`Remove ${count} selected card${count === 1 ? '' : 's'} from their lists?`))
      return
    void removeSelectedAdmin(cards).then((res) => {
      if (res.success) allSelections.clear()
      else window.alert(res.message)
    })
  }

  const handleMoveAll = (dest: NamedListRef) => {
    const cards = allSelections.selected()
    void moveSelectedAdmin(cards, dest).then((res) => {
      if (!res.success) {
        window.alert(res.message)
        return
      }
      allSelections.clear()
      // The navbar move has no status surface; a dropped note is silent data
      // loss without this alert.
      if (res.droppedNotes.length > 0) {
        const lines = res.droppedNotes.map((d) => `${d.cardName}: "${d.note}"`)
        window.alert(
          `Moved, but ${lines.length} note(s) could not travel (merged onto existing lines):\n${lines.join('\n')}`,
        )
      }
    })
  }

  const moveAllTargets = (): NamedListRef[] => listInfosToNamedRefs(lists())

  const navList = () => (
    <For each={navItems}>
      {(item) => (
        <NavLink
          page={item.id}
          class="admin-nav-item"
          active={currentPage() === item.id}
          onNavigate={() => setMenuOpen(false)}
        >
          <span class="nav-icon">{item.icon}</span>
          {item.label}
        </NavLink>
      )}
    </For>
  )

  return (
    <div class="layout-root">
      {/* Header */}
      <header class="admin-header">
        <span class="admin-logo">
          <FlameIcon class="admin-logo-icon" />
          Ritual Admin
        </span>
        <div class="admin-header-actions">
          <SelectionMenu
            selection={allSelections}
            currency="usd"
            label="All Selected"
            clearLabel="Clear all selections"
            buttonClass="selection-menu-btn--navbar"
            showViewAll
            onRemoveAll={handleRemoveAll}
            onMoveAll={handleMoveAll}
            moveAllTargets={moveAllTargets}
          />
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
              <div class="mobile-nav-header">
                <FlameIcon class="admin-logo-icon" />
                Ritual Admin
              </div>
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
        <main
          class={
            FULL_WIDTH_PAGES.includes(currentPage()) ? 'main-content' : 'main-content-constrained'
          }
        >
          {props.children}
        </main>
      </div>
      <SelectionModal
        open={isSelectionViewOpen()}
        selection={allSelections}
        onClose={closeSelectionView}
        onRemoveAll={handleRemoveAll}
        onMoveAll={handleMoveAll}
        moveAllTargets={moveAllTargets}
      />
    </div>
  )
}
