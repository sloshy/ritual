import { render } from 'solid-js/web'
import {
  createSignal,
  createEffect,
  createMemo,
  For,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
  Match,
  type JSX,
} from 'solid-js'
import type { DeckDetail, CollectionDetail, WantedListDetail } from './data-types'
import type { PriceCurrency } from '../price-currency'
import { IndexPage } from './IndexPage'
import { DeckPage } from './DeckPage'
import { DeckEditView } from './editor/DeckEditView'
import { CollectionEditView } from './editor/CollectionEditView'
import { WantedEditView } from './editor/WantedEditView'
import { CollectionPage } from './CollectionPage'
import { WantedListPage } from './WantedListPage'
import { CombinedListPage } from './CombinedListPage'
import { CombineListModal } from './CombineListModal'
import {
  type CombinedSelection,
  type NamedListRef,
  combinedAllHref,
  encodeCombinedHash,
} from './combined-list'
import type { ListType } from '../list-type'
import type { ListRef } from '../change-event'
import { TradePage } from './TradePage'
import { FindPage } from './FindPage'
import { SearchResultsPage } from './SearchResultsPage'
import { EditChromeProvider, useEditChrome } from './editor/edit-chrome'
import { EditControlsRow } from './editor/EditControlsRow'
import { ExportPanel, type ExportListGroup, type ExportScope } from './editor/ExportPanel'
import {
  CHANGE_BUNDLE_FILENAME,
  COMBINED_BUNDLE_FILENAME,
  buildChangeBundle,
  serializeChangeBundle,
} from '../editor/change-bundle'
import { QuickSwitch, useQuickSwitchShortcut } from './QuickSwitch'
import { useRouting } from './useRouting'
import { useSiteData } from './useSiteData'
import { notifyCurrencyChanged } from './currency-epoch'
import { useFetchJson } from './useFetchJson'
import { tradeToast } from './useTradeState'
import { SelectionMenu } from './SelectionMenu'
import { SelectionModal, isSelectionViewOpen, closeSelectionView } from './SelectionModal'
import { useAllSelections } from './useCardSelection'
import { removeAllSelectedPublic, moveAllSelectedPublic } from './remove-selected'
import {
  clearEditSessions,
  confirmDiscardOnExit,
  listEditSessions,
} from './editor/edit-session-memory'
import { pendingPrintingPrompt } from './printing-prompt'
import { TradePrintingPicker } from './TradePrintingPicker'
import { pendingMovePrompt, closeMovePrompt } from './move-prompt'
import { MoveTargetPicker } from './MoveTargetPicker'
import { createThemeStore, ThemeProvider, useTheme } from './useTheme'
import { syncFaviconToTheme } from './useFavicon'
import { FlameIcon } from './FlameIcon'
import { ThemeEditor } from './ThemeEditor'
import { ThemePicker } from './ThemePicker'
import { MobileTabBar } from './MobileTabBar'
import { NAV_DESTINATIONS, type NavActiveState } from './nav-destinations'
import { useMobileLayout } from '../ui/useMediaQuery'

function App() {
  const { route, visible } = useRouting()
  const {
    deckList,
    collectionList,
    wantedListList,
    useScryfallImgUrls,
    currency,
    setCurrency,
    availableCurrencies,
    pricesDate,
  } = useSiteData()

  // Card modal state
  const [modalCard, setModalCard] = createSignal<string | null>(null)

  // Quick switch dialog state
  const [quickSwitchOpen, setQuickSwitchOpen] = createSignal(false)

  // Site-wide edit mode: a single toggle that persists across navigation. While
  // on, the list in view (if any) is shown in its editor, and moving to another
  // list keeps edit mode on so you can edit across lists in one session. Non-list
  // pages (index, combined, trade) simply have nothing to edit.
  const [editMode, setEditMode] = createSignal(false)

  // "Combine with list" modal — opened from any single list view, lets the user
  // pick other lists to view together as one synthetic "Combined List".
  const [combineOpen, setCombineOpen] = createSignal(false)
  const openCombine = () => setCombineOpen(true)

  // Off-list export panel: shown from the navbar edit row on combined views and
  // directory pages, where no single-list editor is mounted. Reset on navigation
  // alongside the other transient modals (see the route-change effect below).
  const [offListExportOpen, setOffListExportOpen] = createSignal(false)

  // The editor publishes its controls here while editing; the navbar renders them.
  const editChrome = useEditChrome()

  // Cross-list selection: the navbar button is always present (it self-hides
  // when nothing is selected) and acts on the whole selection across every list.
  const allSelections = useAllSelections()

  const handleRemoveAll = () => {
    const cards = allSelections.selected()
    const count = cards.reduce((sum, c) => sum + c.quantity, 0)
    if (!window.confirm(`Remove ${count} selected card${count === 1 ? '' : 's'} from their lists?`))
      return
    removeAllSelectedPublic(cards)
    allSelections.clear()
  }

  const handleMoveAll = (dest: ListRef) => {
    const cards = allSelections.selected()
    void moveAllSelectedPublic(cards, dest).then(() => allSelections.clear())
  }

  useQuickSwitchShortcut(() => setQuickSwitchOpen((v) => !v))

  // Reset the modal, quick switch, and combine dialog on route changes. Edit mode
  // is intentionally left alone here so it persists across lists (see editMode).
  createEffect(
    on(
      route,
      () => {
        setModalCard(null)
        setQuickSwitchOpen(false)
        setCombineOpen(false)
        setOffListExportOpen(false)
      },
      { defer: true },
    ),
  )

  // Every list known to the site index, as named refs — backs the combine modal
  // and the combined-view resolution of `all` / individual refs.
  const allNamedLists = createMemo<NamedListRef[]>(() => {
    const out: NamedListRef[] = []
    for (const d of deckList() ?? []) out.push({ type: 'deck', slug: d.slug, name: d.name })
    for (const c of collectionList() ?? [])
      out.push({ type: 'collection', slug: c.slug, name: c.name })
    for (const w of wantedListList() ?? []) out.push({ type: 'wanted', slug: w.slug, name: w.name })
    return out
  })

  // Every list as a move destination (all are offered; per-card self-moves are skipped).
  const moveAllTargets = (): ListRef[] =>
    allNamedLists().map((l) => ({ type: l.type, name: l.name }))

  // The other lists a single editor's cards can move to (excludes the current list).
  const moveTargetsFor = (type: ListRef['type'], slug: () => string | null) => (): ListRef[] =>
    allNamedLists()
      .filter((l) => !(l.type === type && l.slug === slug()))
      .map((l) => ({ type: l.type, name: l.name }))

  // The list currently in view (deck/collection/wanted), passed to the combine
  // modal as the list always included in the combination.
  const currentListRef = createMemo<NamedListRef | undefined>(() => {
    const r = route()
    if (r.page !== 'deck' && r.page !== 'collection' && r.page !== 'wanted') return undefined
    const type: ListType = r.page
    const slug = r.slug
    return (
      allNamedLists().find((l) => l.type === type && l.slug === slug) ?? { type, slug, name: slug }
    )
  })

  // Resolve the combined-view route into named lists (every list when `all`).
  const combinedAll = createMemo(() => {
    const r = route()
    return r.page === 'combined' ? r.all : false
  })
  // The list type a combined-`all` view is restricted to (e.g. "all decks"), or
  // undefined for plain `all` (every list) and non-combined routes.
  const combinedAllType = createMemo<ListType | undefined>(() => {
    const r = route()
    return r.page === 'combined' && r.all ? r.allType : undefined
  })
  const combinedLists = createMemo<NamedListRef[]>(() => {
    const r = route()
    if (r.page !== 'combined') return []
    if (r.all) {
      const all = allNamedLists()
      return r.allType ? all.filter((l) => l.type === r.allType) : all
    }
    return r.refs
      .map((ref) => allNamedLists().find((l) => l.type === ref.type && l.slug === ref.slug))
      .filter((l): l is NamedListRef => l !== undefined)
  })

  const handleCombineView = (selection: CombinedSelection) => {
    setCombineOpen(false)
    window.location.hash = encodeCombinedHash(selection)
  }

  // Off-list export (see the offListExportOpen signal above): while edit mode is
  // on but no single-list editor is mounted (a combined view or a directory page),
  // the navbar still offers Export. It draws its data from the in-memory edit
  // sessions rather than a live editor, defaults to the all-lists scope, and — on
  // a combined view — offers a "current lists" scope covering just that view's
  // member lists. The session snapshots are structurally an ExportListGroup, so
  // they pass straight through.
  const allEditedGroups = (): ExportListGroup[] => listEditSessions()

  const combinedEditedGroups = (): ExportListGroup[] | null => {
    if (route().page !== 'combined') return null
    const members = combinedLists()
    return allEditedGroups().filter((g) =>
      members.some((m) => m.type === g.kind && m.slug === g.slug),
    )
  }

  const buildOffListJson = (scope: ExportScope): string => {
    const lists = scope === 'combined' ? (combinedEditedGroups() ?? []) : allEditedGroups()
    return serializeChangeBundle(buildChangeBundle({ lists, exportedAt: new Date().toISOString() }))
  }

  const activeTab = createMemo(() => {
    const r = route()
    return r.page === 'index' ? (r.tab ?? 'decks') : undefined
  })

  // Which navbar link is highlighted. A per-type combined-`all` view ("all decks")
  // keeps its own type's tab lit; a plain `all` view lights the dedicated "All" link.
  const navActive = createMemo<NavActiveState>(() => {
    const r = route()
    const tab = activeTab()
    const allType = combinedAllType()
    const isAll = r.page === 'combined' && r.all
    return {
      decks:
        (r.page === 'index' && (!tab || tab === 'decks')) ||
        r.page === 'deck' ||
        allType === 'deck',
      collections:
        (r.page === 'index' && tab === 'collections') ||
        r.page === 'collection' ||
        allType === 'collection',
      wanted:
        (r.page === 'index' && tab === 'wanted') || r.page === 'wanted' || allType === 'wanted',
      all: isAll && !allType,
      trade: r.page === 'trade',
      find: r.page === 'find' || r.page === 'search-results',
    }
  })

  const deckSlug = createMemo(() => {
    const r = route()
    return r.page === 'deck' ? r.slug : null
  })
  const deckPrimerOpen = createMemo(() => {
    const r = route()
    return r.page === 'deck' ? (r.primerOpen ?? false) : false
  })
  const deckSectionId = createMemo(() => {
    const r = route()
    return r.page === 'deck' ? r.sectionId : undefined
  })
  const collectionSlug = createMemo(() => {
    const r = route()
    return r.page === 'collection' ? r.slug : null
  })
  const wantedListSlug = createMemo(() => {
    const r = route()
    return r.page === 'wanted' ? r.slug : null
  })

  // Fetch deck/collection data (auto-cleared when navigating away)
  const {
    data: deckDetail,
    loading: deckLoading,
    error: deckError,
  } = useFetchJson<DeckDetail>(() => (deckSlug() ? `decks/${deckSlug()}.json` : null))
  const {
    data: collectionDetail,
    loading: collectionLoading,
    error: collectionError,
  } = useFetchJson<CollectionDetail>(() =>
    collectionSlug() ? `collections/${collectionSlug()}.json` : null,
  )
  const {
    data: wantedListDetail,
    loading: wantedListLoading,
    error: wantedListError,
  } = useFetchJson<WantedListDetail>(() =>
    wantedListSlug() ? `wanted/${wantedListSlug()}.json` : null,
  )

  // Whether an editable list (deck/collection/wanted) is currently in view. Edit
  // mode is site-wide and can be toggled from any page; on a non-list page it is
  // simply "armed" until a list is opened (see the header hint below).
  const editableListInView = createMemo(() => {
    const page = route().page
    return page === 'deck' || page === 'collection' || page === 'wanted'
  })

  const toggleEdit = () => {
    if (!editMode()) {
      setEditMode(true)
      return
    }
    // Leaving edit mode: a mounted list editor runs its own discard confirmation;
    // off a list page (no editor mounted), confirm here if any session still has
    // pending edits, then tear them all down.
    const chrome = editChrome.current()
    if (chrome) chrome.onExit()
    else if (confirmDiscardOnExit(0)) exitEditMode()
  }

  // Leave edit mode entirely: discard every list's in-memory session (the edits
  // that were surviving navigation) and drop back to the read-only views.
  const exitEditMode = () => {
    clearEditSessions()
    setEditMode(false)
  }

  const openModal = (cardName: string) => {
    setModalCard(cardName)
  }

  const closeModal = () => {
    setModalCard(null)
  }

  // The bottom tab bar replaces the header nav links on phone-width viewports;
  // in edit mode the editor's bottom action dock owns that edge instead (Quick
  // Switch still covers navigation while editing).
  const mobileLayout = useMobileLayout()
  const showTabBar = () => mobileLayout() && !editMode()

  let headerRef: HTMLElement | undefined
  onMount(() => {
    if (!headerRef) return
    const el = headerRef
    const update = () => {
      document.documentElement.style.setProperty('--site-header-h', `${el.offsetHeight}px`)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    onCleanup(() => ro.disconnect())
  })

  return (
    <div class="site-app app-padding" classList={{ 'has-tabbar': showTabBar() }}>
      <header ref={headerRef} class="site-header">
        <div class="site-header-main">
          <a href="#/" class="site-logo">
            <FlameIcon class="site-logo-icon" />
            <span class="site-logo-text">Ritual</span>
          </a>
          <span class="site-nav-sep">|</span>
          {/* Destinations come from the shared NAV_DESTINATIONS list (also the
              tab bar's source); "All" is header-only with its computed href,
              slotted between Wanted and Trade. */}
          <nav class="site-nav">
            <For each={NAV_DESTINATIONS.slice(0, 3)}>
              {(d) => (
                <NavLink href={d.href} active={navActive()[d.key]}>
                  {d.label}
                </NavLink>
              )}
            </For>
            <NavLink href={combinedAllHref()} active={navActive().all}>
              All
            </NavLink>
            <For each={NAV_DESTINATIONS.slice(3)}>
              {(d) => (
                <NavLink href={d.href} active={navActive()[d.key]}>
                  {d.label}
                </NavLink>
              )}
            </For>
          </nav>
          <button
            type="button"
            class="quick-switch-trigger"
            aria-label="Open quick switch (Ctrl+K)"
            title="Quick switch (Ctrl+K)"
            onClick={() => setQuickSwitchOpen(true)}
          >
            <span class="quick-switch-trigger-icon" aria-hidden="true">
              ⌕
            </span>
            <span class="quick-switch-trigger-label">Quick switch</span>
            <span class="quick-switch-trigger-kbd" aria-hidden="true">
              <kbd>Ctrl</kbd>
              <kbd>K</kbd>
            </span>
          </button>
          <div class="currency-selector">
            <label class="currency-label">Prices:</label>
            <select
              class="currency-select"
              value={currency()}
              onChange={(e) => {
                setCurrency(e.target.value as PriceCurrency)
                notifyCurrencyChanged()
              }}
            >
              <Show when={availableCurrencies().includes('usd')}>
                <option value="usd">USD ($)</option>
              </Show>
              <Show when={availableCurrencies().includes('eur')}>
                <option value="eur">EUR (€)</option>
              </Show>
              <Show when={availableCurrencies().includes('tix')}>
                <option value="tix">TIX</option>
              </Show>
            </select>
          </div>
          <button
            type="button"
            class="btn btn-secondary btn-edit"
            classList={{ 'btn-edit--active': editMode() }}
            title={
              editMode()
                ? 'Leave edit mode'
                : editableListInView()
                  ? 'Edit this list locally'
                  : 'Enter edit mode, then open a list to edit'
            }
            onClick={toggleEdit}
          >
            <span class="btn-edit-icon" aria-hidden="true">
              {editMode() ? '✓' : '✏️'}
            </span>
            <span class="btn-edit-label">{editMode() ? 'Done' : 'Edit'}</span>
          </button>
          <SelectionMenu
            selection={allSelections}
            currency={currency()}
            enableTrade
            useScryfallImgUrls={useScryfallImgUrls()}
            label="All Selected"
            clearLabel="Clear all selections"
            buttonClass="selection-menu-btn--navbar"
            showViewAll
            onRemoveAll={editMode() ? handleRemoveAll : undefined}
            onMoveAll={editMode() ? handleMoveAll : undefined}
            moveAllTargets={editMode() ? moveAllTargets : undefined}
          />
          <ThemeHeaderControls />
        </div>

        <Show
          when={editChrome.current()}
          fallback={
            <Show when={editMode()}>
              <div class="site-header-edit-row">
                <div class="edit-banner" role="status">
                  <div class="edit-banner-label">
                    <span class="edit-banner-icon" aria-hidden="true">
                      ✎
                    </span>
                    <span class="edit-mode-hint">
                      Edit mode is on — open a single deck, collection, or wanted list to edit.
                    </span>
                  </div>
                  <div class="edit-banner-controls">
                    <button
                      type="button"
                      class="btn btn-export"
                      onClick={() => setOffListExportOpen(true)}
                    >
                      Export…
                    </button>
                  </div>
                </div>
              </div>
            </Show>
          }
        >
          {(chrome) => (
            <div class="site-header-edit-row">
              <EditControlsRow chrome={chrome()} />
            </div>
          )}
        </Show>
      </header>

      <Show when={pricesDate()}>
        <div class="prices-date">
          Prices accurate as of{' '}
          {new Date(pricesDate()!).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </div>
      </Show>

      <main class="site-main">
        <div
          class="page-transition"
          classList={{ 'page-visible': visible(), 'page-hidden': !visible() }}
        >
          <Switch>
            <Match when={route().page === 'index'}>
              <Show when={deckList()} fallback={<LoadingSpinner />}>
                <IndexPage
                  decks={deckList()!}
                  collections={collectionList() || []}
                  wantedLists={wantedListList() || []}
                  useScryfallImgUrls={useScryfallImgUrls()}
                  activeTab={activeTab() ?? 'decks'}
                  currency={currency()}
                />
              </Show>
            </Match>
            <Match when={route().page === 'wanted'}>
              <Show
                when={!wantedListError()}
                fallback={<ErrorMessage message={wantedListError()!} />}
              >
                <Show
                  when={!wantedListLoading() && wantedListDetail()}
                  fallback={<LoadingSpinner />}
                >
                  <Show
                    when={editMode()}
                    fallback={
                      <WantedListPage
                        name={wantedListDetail()!.name}
                        slug={wantedListSlug() ?? undefined}
                        entries={wantedListDetail()!.entries}
                        sectionOrder={wantedListDetail()!.sectionOrder}
                        cards={wantedListDetail()!.cards}
                        printings={wantedListDetail()!.printings ?? {}}
                        symbolMap={wantedListDetail()!.symbolMap}
                        useScryfallImgUrls={wantedListDetail()!.useScryfallImgUrls}
                        totalPrice={wantedListDetail()!.totalPrice}
                        enableExport={true}
                        pricesDate={wantedListDetail()!.pricesDate}
                        modalCardKey={modalCard()}
                        onOpenModal={openModal}
                        onCloseModal={closeModal}
                        currency={currency()}
                        changelog={wantedListDetail()!.changelog}
                        enablePriceRefresh={true}
                        enableTrade={true}
                        enableUrlState={true}
                        onCombine={openCombine}
                      />
                    }
                  >
                    <WantedEditView
                      detail={wantedListDetail()!}
                      slug={wantedListSlug() ?? ''}
                      currency={currency()}
                      onExit={exitEditMode}
                      moveTargets={moveTargetsFor('wanted', wantedListSlug)}
                    />
                  </Show>
                </Show>
              </Show>
            </Match>
            <Match when={route().page === 'collection'}>
              <Show
                when={!collectionError()}
                fallback={<ErrorMessage message={collectionError()!} />}
              >
                <Show
                  when={!collectionLoading() && collectionDetail()}
                  fallback={<LoadingSpinner />}
                >
                  <Show
                    when={editMode()}
                    fallback={
                      <CollectionPage
                        name={collectionDetail()!.name}
                        slug={collectionSlug() ?? undefined}
                        entries={collectionDetail()!.entries}
                        sectionOrder={collectionDetail()!.sectionOrder}
                        cards={collectionDetail()!.cards}
                        printings={collectionDetail()!.printings ?? {}}
                        symbolMap={collectionDetail()!.symbolMap}
                        useScryfallImgUrls={collectionDetail()!.useScryfallImgUrls}
                        totalPrice={collectionDetail()!.totalPrice}
                        enableExport={true}
                        pricesDate={collectionDetail()!.pricesDate}
                        modalCardKey={modalCard()}
                        onOpenModal={openModal}
                        onCloseModal={closeModal}
                        currency={currency()}
                        changelog={collectionDetail()!.changelog}
                        enablePriceRefresh={true}
                        enableTrade={true}
                        enableUrlState={true}
                        onCombine={openCombine}
                      />
                    }
                  >
                    <CollectionEditView
                      detail={collectionDetail()!}
                      slug={collectionSlug() ?? ''}
                      currency={currency()}
                      onExit={exitEditMode}
                      moveTargets={moveTargetsFor('collection', collectionSlug)}
                    />
                  </Show>
                </Show>
              </Show>
            </Match>
            <Match when={route().page === 'deck'}>
              <Show when={!deckError()} fallback={<ErrorMessage message={deckError()!} />}>
                <Show when={!deckLoading() && deckDetail()} fallback={<LoadingSpinner />}>
                  <Show
                    when={editMode()}
                    fallback={
                      <DeckPage
                        deck={deckDetail()!.deck}
                        cards={deckDetail()!.cards}
                        printings={deckDetail()!.printings ?? {}}
                        lowestPriceCards={deckDetail()!.lowestPriceCards}
                        lowestPriceCardsEur={deckDetail()!.lowestPriceCardsEur}
                        lowestPriceCardsTix={deckDetail()!.lowestPriceCardsTix}
                        symbolMap={deckDetail()!.symbolMap}
                        enableExport={true}
                        useScryfallImgUrls={deckDetail()!.useScryfallImgUrls}
                        modalCardName={modalCard()}
                        onOpenModal={openModal}
                        onCloseModal={closeModal}
                        currency={currency()}
                        missingCards={deckDetail()!.missingCards}
                        pricesDate={deckDetail()!.pricesDate}
                        slug={deckSlug() ?? ''}
                        primerOpen={deckPrimerOpen()}
                        sectionId={deckSectionId()}
                        changelog={deckDetail()!.changelog}
                        enablePriceRefresh={true}
                        enableTrade={true}
                        enableUrlState={true}
                        onCombine={openCombine}
                      />
                    }
                  >
                    <DeckEditView
                      detail={deckDetail()!}
                      slug={deckSlug() ?? ''}
                      currency={currency()}
                      onExit={exitEditMode}
                      moveTargets={moveTargetsFor('deck', deckSlug)}
                    />
                  </Show>
                </Show>
              </Show>
            </Match>
            <Match when={route().page === 'combined'}>
              <Show when={deckList()} fallback={<LoadingSpinner />}>
                <CombinedListPage
                  all={combinedAll()}
                  allType={combinedAllType()}
                  lists={combinedLists()}
                  currency={currency()}
                  useScryfallImgUrls={useScryfallImgUrls()}
                  enableTrade
                />
              </Show>
            </Match>
            <Match when={route().page === 'trade'}>
              <TradePage
                useScryfallImgUrls={useScryfallImgUrls()}
                currency={currency()}
                collections={collectionList}
                decks={deckList}
                wantedLists={wantedListList}
              />
            </Match>
            <Match when={route().page === 'find'}>
              <Show when={deckList()} fallback={<LoadingSpinner />}>
                <FindPage
                  decks={deckList}
                  collections={collectionList}
                  wantedLists={wantedListList}
                  currency={currency()}
                  useScryfallImgUrls={useScryfallImgUrls()}
                />
              </Show>
            </Match>
            <Match when={route().page === 'search-results'}>
              <SearchResultsPage currency={currency()} useScryfallImgUrls={useScryfallImgUrls()} />
            </Match>
          </Switch>
        </div>
      </main>

      <footer class="site-footer">
        <p>
          Generated by <a href="https://github.com/sloshy/ritual">ritual</a>
        </p>
      </footer>

      <Show when={showTabBar()}>
        <MobileTabBar active={navActive()} />
      </Show>

      <QuickSwitch
        open={quickSwitchOpen()}
        onClose={() => setQuickSwitchOpen(false)}
        decks={deckList}
        collections={collectionList}
        wantedLists={wantedListList}
        currency={currency}
        useScryfallImgUrls={useScryfallImgUrls}
      />

      <Show when={tradeToast()}>
        {(t) => (
          <div class="trade-add-toast" aria-live="polite">
            <Show when={t().imageUrl}>
              {(url) => <img class="trade-add-toast-thumb" src={url()} alt="" />}
            </Show>
            {t().name} added to Trade
          </div>
        )}
      </Show>

      {/* "Combine with list" modal, opened from any single list view. */}
      <CombineListModal
        open={combineOpen()}
        onClose={() => setCombineOpen(false)}
        current={currentListRef()}
        decks={deckList() ?? []}
        collections={collectionList() ?? []}
        wantedLists={wantedListList() ?? []}
        currency={currency()}
        onView={handleCombineView}
      />

      {/* Off-list export: available in edit mode on combined views and directory
          pages, where no single-list editor is mounted. */}
      <ExportPanel
        open={offListExportOpen()}
        onClose={() => setOffListExportOpen(false)}
        current={null}
        allGroups={allEditedGroups}
        combinedGroups={combinedEditedGroups}
        bundleFilename={CHANGE_BUNDLE_FILENAME}
        combinedFilename={COMBINED_BUNDLE_FILENAME}
        buildJson={buildOffListJson}
      />

      {/* Cross-list "view all selections" modal. */}
      <SelectionModal
        open={isSelectionViewOpen()}
        selection={allSelections}
        onClose={closeSelectionView}
        onRemoveAll={editMode() ? handleRemoveAll : undefined}
        onMoveAll={editMode() ? handleMoveAll : undefined}
        moveAllTargets={editMode() ? moveAllTargets : undefined}
      />

      {/* Shared picker for choosing a move destination (section or list). */}
      <Show when={pendingMovePrompt()}>
        {(prompt) => <MoveTargetPicker prompt={prompt()} onClose={closeMovePrompt} />}
      </Show>

      {/* Sequential printing picker for bulk "Add to Trade" of name-only cards. */}
      <Show when={pendingPrintingPrompt()}>
        {(prompt) => (
          <TradePrintingPicker
            cardName={prompt().cardName}
            printings={prompt().printings}
            loading={false}
            useScryfallImgUrls={useScryfallImgUrls()}
            currency={currency()}
            onSelect={(printing, finish) => prompt().onSelect(printing, finish)}
            onClose={() => prompt().onSkip()}
          />
        )}
      </Show>
    </div>
  )
}

interface NavLinkProps {
  href: string
  active: boolean
  children: JSX.Element
}

function NavLink(props: NavLinkProps) {
  return (
    <a
      href={props.href}
      class="site-nav-link"
      classList={{
        'site-nav-link-active': props.active,
        'site-nav-link-inactive': !props.active,
      }}
    >
      {props.children}
    </a>
  )
}

function LoadingSpinner() {
  return (
    <div class="loading-container">
      <div class="loading-spinner" />
    </div>
  )
}

interface ErrorMessageProps {
  message: string
}

function ErrorMessage(props: ErrorMessageProps) {
  return <div class="error-container">{props.message}</div>
}

function ThemeHeaderControls() {
  const theme = useTheme()
  const [pickerOpen, setPickerOpen] = createSignal(false)
  let wrapperRef: HTMLDivElement | undefined

  // Click-outside dismisses the popover. Use mousedown (not click) so a
  // press on the trigger's toggling its own state doesn't get followed by a
  // close fired from the bubbled click — Solid's click handler runs after
  // mousedown.
  createEffect(() => {
    if (!pickerOpen()) return
    const onMouseDown = (e: MouseEvent) => {
      if (wrapperRef && !wrapperRef.contains(e.target as Node)) {
        setPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    onCleanup(() => document.removeEventListener('mousedown', onMouseDown))
  })

  return (
    <div ref={wrapperRef} class="theme-picker-wrapper">
      <button
        type="button"
        class="theme-customize-btn"
        classList={{ 'theme-customize-btn-active': pickerOpen() || theme.editorOpen() }}
        onClick={() => setPickerOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={pickerOpen()}
        title={theme.editorOpen() ? 'Theme menu (editor open)' : 'Theme menu'}
      >
        <span class="theme-customize-btn-icon" aria-hidden="true">
          🎨
        </span>
        <span class="theme-customize-btn-label">
          {theme.editorOpen() ? 'Editing theme' : 'Theme'}
        </span>
      </button>
      <ThemePicker open={pickerOpen()} onClose={() => setPickerOpen(false)} />
    </div>
  )
}

function Root() {
  const themeStore = createThemeStore()
  syncFaviconToTheme(themeStore)
  return (
    <ThemeProvider store={themeStore}>
      <EditChromeProvider>
        <Show when={themeStore.editorOpen()}>
          <ThemeEditor />
        </Show>
        <App />
      </EditChromeProvider>
    </ThemeProvider>
  )
}

render(() => <Root />, document.getElementById('app')!)
