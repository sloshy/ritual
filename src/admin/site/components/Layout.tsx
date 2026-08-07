import type { ParentComponent } from 'solid-js'
import { useDefaultCurrency } from '../hooks/useDefaultCurrency'
import { useDefaultLanguage } from '../hooks/useDefaultLanguage'
import { createMemo, createSignal, For, Show } from 'solid-js'
import { PAGE_DISPLAY, type Page, useRouting } from '../routing'
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

/** Sidebar order. Names and icons come from {@link PAGE_DISPLAY}. */
const NAV_PAGES: readonly Page[] = [
  'dashboard',
  'list-editor',
  'move-cards',
  'list-manager',
  'history',
  'import-deck',
  'import-csv',
  'import-changes',
  'build-site',
  'cache-refresh',
  'deck-sync',
  'collection-sync',
  'archidekt-login',
  'audit-log',
  'settings',
]

/** Pages whose content spans the full window rather than the reading-width column. */
const FULL_WIDTH_PAGES: readonly Page[] = ['list-editor', 'move-cards']

interface LayoutProps {
  onLogout?: () => void
}

export const Layout: ParentComponent<LayoutProps> = (props) => {
  const [menuOpen, setMenuOpen] = createSignal(false)
  // The navbar selection surfaces show prices, so they must use the workspace's
  // configured currency rather than assuming USD.
  const defaultCurrency = useDefaultCurrency()
  // Deliberately wired here rather than per page: Layout is the logged-in shell
  // (`/api/config` requires auth, so the app root would fetch too early), it
  // mounts before any editor page, and the editors' shared add/printing dialogs
  // read the non-reactive runtime holder this hook primes. Settings pushes
  // later changes directly, so a once-only fetch at the shell is enough.
  useDefaultLanguage()
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
    <For each={NAV_PAGES}>
      {(page) => (
        <NavLink
          page={page}
          class="admin-nav-item"
          active={currentPage() === page}
          onNavigate={() => setMenuOpen(false)}
        >
          <span class="nav-icon">{PAGE_DISPLAY[page].icon}</span>
          {PAGE_DISPLAY[page].label}
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
            currency={defaultCurrency()}
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
        currency={defaultCurrency()}
        onClose={closeSelectionView}
        onRemoveAll={handleRemoveAll}
        onMoveAll={handleMoveAll}
        moveAllTargets={moveAllTargets}
      />
    </div>
  )
}
