import type { JSX, ParentComponent } from 'solid-js'
import { useDefaultCurrency } from '../hooks/useDefaultCurrency'
import { useDefaultLanguage } from '../hooks/useDefaultLanguage'
import { createMemo, createSignal, For, Show } from 'solid-js'
import { useT, useTKey } from '../../../ui/i18n'
import { PAGE_DISPLAY, type Page, useRouting } from '../routing'
import { NavLink } from './NavLink'
import { FlameIcon } from '../../../site/FlameIcon'
import { Modal } from '../../../ui/Modal'
import { ConfirmDialog } from '../../../ui/ConfirmDialog'
import { LanguageSwitcher } from '../../../site/LanguageSwitcher'
import { availableLocales, switchAdminLocale, useAdminLocale } from '../hooks/useAdminLocale'
import { SelectionMenu } from '../../../site/SelectionMenu'
import {
  SelectionModal,
  isSelectionViewOpen,
  closeSelectionView,
} from '../../../site/SelectionModal'
import type { NamedListRef } from '../../../list-view/combined-list'
import { useAllSelections, type RemoveAllTarget } from '../../../list-view/useCardSelection'
import { moveSelectedAdmin, removeSelectedAdmin } from '../remove-selected'
import { useAdminLists, listInfosToNamedRefs } from '../move-targets'
import type { DroppedNote } from '../../../list/move-staging'
import { formatPrunedCategoriesSuffix } from '../../../editor/save-notices'

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

/**
 * Something the shell has to tell the user after the fact — a refused move, a
 * note that could not travel. Held as data rather than passed to `window.alert`,
 * which cannot be styled, cannot be translated by the app, and blocks the whole
 * tab.
 */
type LayoutNotice = {
  title: string
  message: string
  /** Extra lines listed under the message, one per row. */
  details?: string[]
}

type NoticeDialogProps = {
  notice: LayoutNotice
  onClose: () => void
}

/**
 * The acknowledge-only counterpart of {@link ConfirmDialog}, built from the same
 * `Modal` primitive. A confirmation's two buttons would both do the same thing
 * here, and "Cancel" on a message that has already happened reads as an offer to
 * undo it.
 */
function NoticeDialog(props: NoticeDialogProps): JSX.Element {
  const t = useT()
  return (
    <Modal open onClose={props.onClose} size="md" panelClass="modal-panel--prompt">
      <h3>{props.notice.title}</h3>
      <p class="dialog-message">{props.notice.message}</p>
      {/* Reuses the editor's scrolling change-list chrome, so a long list of
          dropped notes is bounded rather than pushing the buttons off screen. */}
      <Show when={props.notice.details}>
        {(details) => (
          <div class="changes-dialog changes-list-box">
            <For each={details()}>{(line) => <div class="change-item">{line}</div>}</For>
          </div>
        )}
      </Show>
      <div class="confirm-dialog-actions">
        <button type="button" class="btn btn-primary" onClick={props.onClose}>
          {t('ui.dialog.close')}
        </button>
      </div>
    </Modal>
  )
}

export const Layout: ParentComponent<LayoutProps> = (props) => {
  const t = useT()
  const tKey = useTKey()
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
  const uiLocale = useAdminLocale()
  const routing = useRouting()
  // Memoized: the editor rewrites the route as its list selection changes, which
  // must not re-run the active state of all 14 nav links.
  const currentPage = createMemo((): Page => routing.route().page)

  // Cross-list selection button: always present (self-hides when nothing is
  // selected). The admin site has no trade page, so it offers copy/clear plus a
  // server-backed "Remove all selected" that deletes the cards from their lists.
  const allSelections = useAllSelections()
  const lists = useAdminLists()

  // Both prompts were `window.confirm`/`window.alert`, which cannot be
  // translated by the app (the browser supplies the button words in the *OS*
  // language) and block the tab while open.
  //
  // The dialog holds the *cards* as well as the count: it does not block the
  // tab the way `window.confirm` did, so re-reading the selection at confirm
  // time would let the removal act on something other than what the title named.
  const [removeConfirm, setRemoveConfirm] = createSignal<RemoveAllTarget | null>(null)
  const [notice, setNotice] = createSignal<LayoutNotice | null>(null)

  const handleRemoveAll = () => {
    const cards = allSelections.selected()
    setRemoveConfirm({ cards, count: cards.reduce((sum, c) => sum + c.quantity, 0) })
  }

  /**
   * Say what a navbar move/remove did beyond moving cards. Neither action has a
   * status surface, so a dropped note — or a set of categories dropped because
   * the list lost its last line of that name — would otherwise be silent data
   * loss. The CLI warns about both (`ritual move`), and so does the editor's
   * save tail; this is the third client of the same channel.
   */
  const reportSideEffects = (
    droppedNotes: readonly DroppedNote[],
    prunedCategories: readonly string[] | undefined,
  ) => {
    const pruned = formatPrunedCategoriesSuffix(prunedCategories ?? []).trim()
    if (droppedNotes.length > 0) {
      setNotice({
        title: t('admin.layout.notesDroppedTitle'),
        message: t('admin.layout.notesDropped', { count: droppedNotes.length }),
        details: [
          ...droppedNotes.map((d) =>
            t('admin.layout.droppedNote', { name: d.cardName, note: d.note }),
          ),
          ...(pruned ? [pruned] : []),
        ],
      })
      return
    }
    if (pruned) setNotice({ title: t('admin.layout.categoriesPrunedTitle'), message: pruned })
  }

  const confirmRemoveAll = () => {
    const target = removeConfirm()
    setRemoveConfirm(null)
    if (target === null) return
    void removeSelectedAdmin(target.cards).then((res) => {
      if (!res.success) {
        setNotice({ title: t('admin.layout.actionFailedTitle'), message: res.message })
        return
      }
      allSelections.clear()
      reportSideEffects([], res.prunedCategories)
    })
  }

  const handleMoveAll = (dest: NamedListRef) => {
    const cards = allSelections.selected()
    void moveSelectedAdmin(cards, dest).then((res) => {
      if (!res.success) {
        setNotice({ title: t('admin.layout.actionFailedTitle'), message: res.message })
        return
      }
      allSelections.clear()
      reportSideEffects(res.droppedNotes, res.prunedCategories)
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
          {tKey(PAGE_DISPLAY[page].label)}
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
          {t('admin.layout.title')}
        </span>
        <div class="admin-header-actions">
          {/* Beside the other header controls, exactly as on the public site.
              Hides itself when this build ships a single locale. */}
          <LanguageSwitcher
            locale={uiLocale()}
            available={availableLocales()}
            onChange={switchAdminLocale}
          />
          <SelectionMenu
            selection={allSelections}
            currency={defaultCurrency()}
            label={t('admin.layout.allSelected')}
            clearLabel={t('admin.layout.clearSelections')}
            buttonClass="selection-menu-btn--navbar"
            showViewAll
            onRemoveAll={handleRemoveAll}
            onMoveAll={handleMoveAll}
            moveAllTargets={moveAllTargets}
          />
          <Show when={props.onLogout}>
            {(logout) => (
              <button class="btn btn-secondary btn-xs desktop-only" onClick={() => logout()()}>
                {t('admin.layout.logout')}
              </button>
            )}
          </Show>
          <button
            class="btn-mobile-menu mobile-only"
            onClick={() => setMenuOpen(!menuOpen())}
            aria-label={t('admin.layout.toggleMenu')}
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
                {t('admin.layout.title')}
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
                      {t('admin.layout.logout')}
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
      {/* `!== null` rather than a truthiness test: a zero count is a real state. */}
      <Show when={removeConfirm() !== null}>
        <ConfirmDialog
          open
          title={t('admin.layout.removeSelectedTitle')}
          message={t('ui.selection.confirmRemoveAll', { count: removeConfirm()?.count ?? 0 })}
          confirmLabel={t('admin.layout.removeSelectedConfirm')}
          destructive
          onConfirm={confirmRemoveAll}
          onCancel={() => setRemoveConfirm(null)}
        />
      </Show>
      <Show when={notice()}>
        {(current) => <NoticeDialog notice={current()} onClose={() => setNotice(null)} />}
      </Show>
    </div>
  )
}
