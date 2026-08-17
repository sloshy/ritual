import { render } from 'solid-js/web'
import {
  batch,
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
import { formatDateTime } from '../ui/format'
import { IndexPage } from './IndexPage'
import { DeckPage } from './DeckPage'
import { DeckEditView } from './editor/DeckEditView'
import { CollectionEditView } from './editor/CollectionEditView'
import { WantedEditView } from './editor/WantedEditView'
import { CollectionPage } from './CollectionPage'
import { WantedListPage } from './WantedListPage'
import { CombinedListPage } from './CombinedListPage'
import { CombineListModal } from './CombineListModal'
import { type CombinedSelection, type NamedListRef, encodeCombinedHash } from './combined-list'
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
import { apiActive, apiDegraded, detailUrl } from './api-base'
import { notifyCurrencyChanged } from './currency-epoch'
import { useFetchJson } from './useFetchJson'
import { tradeToast } from './useTradeState'
import { SelectionMenu } from './SelectionMenu'
import { SelectionModal, isSelectionViewOpen, closeSelectionView } from './SelectionModal'
import { useAllSelections, type RemoveAllTarget } from './useCardSelection'
import { removeAllSelectedPublic, moveAllSelectedPublic } from './remove-selected'
import {
  clearEditSessions,
  confirmDiscardOnExit,
  listEditSessions,
} from './editor/edit-session-memory'
import { pendingPrintingPrompt } from './printing-prompt'
import { pendingKeepTradePrompt } from './keep-trade-prompt'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { TradePrintingPicker } from './TradePrintingPicker'
import { closeFindPrintings } from './find-printings'
import { FindPrintingsModal } from './FindPrintingsModal'
import { pendingMovePrompt, closeMovePrompt } from './move-prompt'
import { MoveTargetPicker } from './MoveTargetPicker'
import { createThemeStore, ThemeProvider } from './useTheme'
import { syncFaviconToTheme } from './useFavicon'
import { FlameIcon } from './FlameIcon'
import { ThemeEditor } from './ThemeEditor'
import { MobileTabBar } from './MobileTabBar'
import { CurrencySelector, EditModeButton, ThemeHeaderControls } from './HeaderControls'
import { LanguageSwitcher } from './LanguageSwitcher'
import { NAV_DESTINATIONS, type NavActiveState } from './nav-destinations'
import { createI18nStore, I18nProvider, useI18n } from '../ui/i18n'
import { registerSiteMessages } from '../i18n/register/site'
import type { LocaleTag } from '../i18n/types'
import { useMobileLayout } from '../ui/useMediaQuery'

// The English catalog is registered per surface, not imported by the runtime
// (plan §4.2): this is what keeps the CLI's `cli.*` / `help.*` inventory —
// half the catalog — out of this bundle. Module scope, before anything renders.
registerSiteMessages()

function App() {
  const { t, tSegments, setLocale: publishLocale } = useI18n()
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
    sellMode: sellModeAvailable,
    uiLocale,
    availableLocales,
    switchLocale,
    refetch: refetchSiteData,
  } = useSiteData()

  // Card modal state
  const [modalCard, setModalCard] = createSignal<string | null>(null)

  // Quick switch dialog state
  const [quickSwitchOpen, setQuickSwitchOpen] = createSignal(false)

  // Phone layout only: the collapsible header row holding currency, edit, and
  // theme. Deliberately not reset on navigation — it's a display preference for
  // the session, not a transient dialog.
  const [headerUtilityOpen, setHeaderUtilityOpen] = createSignal(false)

  // Batched so the currency and the epoch counter that invalidates cached
  // prices land together, rather than as two separate notifications.
  const changeCurrency = (next: PriceCurrency) => {
    batch(() => {
      setCurrency(next)
      notifyCurrencyChanged()
    })
  }

  // Switching the UI language loads the target dictionary before it takes
  // effect, so the switch is fire-and-forget from the control's point of view:
  // `switchLocale` resolves to whatever was actually applied (English, if the
  // fetch failed) and updates the signals the header reads.
  const changeLocale = (tag: LocaleTag) => {
    void switchLocale(tag)
  }

  // `useSiteData` owns locale resolution — boot precedence and the dictionary
  // fetch both live there — but it writes plain module state, which Solid
  // cannot observe. Mirroring what it applied into the i18n store is what makes
  // every `t()` in the tree re-render, for the boot resolution and for a
  // runtime switch alike.
  createEffect(() => publishLocale(uiLocale()))

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

  // Cross-list removal is destructive and irreversible from here, so it goes
  // through the in-app ConfirmDialog rather than `window.confirm` — a native
  // dialog cannot be styled, cannot be localized, and blocks the whole tab.
  //
  // The *cards* are snapshotted alongside the count, not just the count:
  // `window.confirm` blocked the tab, so re-reading the selection afterwards was
  // safe. A non-blocking dialog is not — the title would name the selection as
  // it was when the dialog opened while the removal acted on whatever is
  // selected when it is confirmed.
  const [removeAllTarget, setRemoveAllTarget] = createSignal<RemoveAllTarget | null>(null)

  const handleRemoveAll = () => {
    const cards = allSelections.selected()
    const count = cards.reduce((sum, c) => sum + c.quantity, 0)
    if (count === 0) return
    setRemoveAllTarget({ cards, count })
  }

  const confirmRemoveAll = () => {
    const target = removeAllTarget()
    setRemoveAllTarget(null)
    if (target === null) return
    removeAllSelectedPublic(target.cards)
    allSelections.clear()
  }

  const handleMoveAll = (dest: NamedListRef) => {
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
        closeFindPrintings()
      },
      { defer: true },
    ),
  )

  // With a live backend, moving to a different page refreshes the index
  // summaries. Keyed on page identity — not the whole route object — so
  // intra-page hash changes (e.g. primer TOC anchors) don't refetch.
  const routePageKey = createMemo(() => {
    const r = route()
    return r.page === 'deck' || r.page === 'collection' || r.page === 'wanted'
      ? `${r.page}:${r.slug}`
      : r.page
  })
  createEffect(on(routePageKey, () => refetchSiteData(), { defer: true }))

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
  const moveAllTargets = (): NamedListRef[] => allNamedLists()

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

  // Fetch deck/collection data (auto-cleared when navigating away). The URL
  // accessors read the API base reactively, so resolving or degrading the live
  // backend refetches from the right source.
  const {
    data: deckDetail,
    loading: deckLoading,
    error: deckError,
  } = useFetchJson<DeckDetail>(() => (deckSlug() ? detailUrl('deck', deckSlug()!) : null))
  const {
    data: collectionDetail,
    loading: collectionLoading,
    error: collectionError,
  } = useFetchJson<CollectionDetail>(() =>
    collectionSlug() ? detailUrl('collection', collectionSlug()!) : null,
  )
  const {
    data: wantedListDetail,
    loading: wantedListLoading,
    error: wantedListError,
  } = useFetchJson<WantedListDetail>(() =>
    wantedListSlug() ? detailUrl('wanted', wantedListSlug()!) : null,
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
            {/* i18n-exempt: the program's own name, never translated. */}
            <span class="site-logo-text">Ritual</span>
          </a>
          <Show when={apiActive() || apiDegraded()}>
            <span
              class="site-live-badge"
              classList={{ 'site-live-badge--offline': apiDegraded() }}
              title={apiDegraded() ? t('site.app.offlineTitle') : t('site.app.liveTitle')}
            >
              {apiDegraded() ? t('site.app.offline') : t('site.app.live')}
            </span>
          </Show>
          <span class="site-nav-sep">|</span>
          {/* Destinations come from the shared NAV_DESTINATIONS list, which the
              mobile tab bar renders from too. */}
          <nav class="site-nav">
            <For each={NAV_DESTINATIONS}>
              {(d) => (
                <NavLink href={d.href} active={navActive()[d.key]}>
                  {t(d.label)}
                </NavLink>
              )}
            </For>
          </nav>
          <button
            type="button"
            class="quick-switch-trigger"
            aria-label={t('site.app.quickSwitchAria')}
            title={t('site.app.quickSwitchTitle')}
            onClick={() => setQuickSwitchOpen(true)}
          >
            <span class="quick-switch-trigger-icon" aria-hidden="true">
              ⌕
            </span>
            <span class="quick-switch-trigger-label">{t('site.app.quickSwitch')}</span>
            <span class="quick-switch-trigger-kbd" aria-hidden="true">
              {/* i18n-exempt: physical key names, printed on the keyboard. */}
              <kbd>Ctrl</kbd>
              {/* i18n-exempt: physical key names, printed on the keyboard. */}
              <kbd>K</kbd>
            </span>
          </button>
          {/* Desktop keeps these inline; the phone layout moves them into the
              collapsible utility row below. */}
          <Show when={!mobileLayout()}>
            <CurrencySelector
              currency={currency()}
              available={availableCurrencies()}
              onChange={changeCurrency}
            />
            <LanguageSwitcher
              locale={uiLocale()}
              available={availableLocales()}
              onChange={changeLocale}
            />
            <EditModeButton
              editMode={editMode()}
              editableListInView={editableListInView()}
              onToggle={toggleEdit}
            />
          </Show>
          <SelectionMenu
            selection={allSelections}
            currency={currency()}
            enableTrade
            useScryfallImgUrls={useScryfallImgUrls()}
            label={t('site.app.allSelected')}
            clearLabel={t('site.app.clearAllSelections')}
            buttonClass="selection-menu-btn--navbar"
            showViewAll
            onRemoveAll={editMode() ? handleRemoveAll : undefined}
            onMoveAll={editMode() ? handleMoveAll : undefined}
            moveAllTargets={editMode() ? moveAllTargets : undefined}
          />
          <Show when={!mobileLayout()}>
            <ThemeHeaderControls />
          </Show>
          <Show when={mobileLayout()}>
            <button
              type="button"
              class="header-utility-toggle"
              classList={{ 'header-utility-toggle--open': headerUtilityOpen() }}
              aria-label={
                headerUtilityOpen()
                  ? t('site.app.hideDisplayOptions')
                  : t('site.app.showDisplayOptions')
              }
              aria-expanded={headerUtilityOpen()}
              title={t('site.app.displayOptions')}
              onClick={() => setHeaderUtilityOpen((v) => !v)}
            >
              <span aria-hidden="true">⚙</span>
            </button>
          </Show>
        </div>

        {/* Edit/Done keeps this one home in every state — the ⚙ toggle stays in
            the main row, so reopening the row is always one tap away. */}
        <Show when={mobileLayout() && headerUtilityOpen()}>
          <div class="site-header-utility">
            <CurrencySelector
              currency={currency()}
              available={availableCurrencies()}
              onChange={changeCurrency}
            />
            <LanguageSwitcher
              locale={uiLocale()}
              available={availableLocales()}
              onChange={changeLocale}
            />
            <EditModeButton
              editMode={editMode()}
              editableListInView={editableListInView()}
              onToggle={toggleEdit}
            />
            <ThemeHeaderControls />
          </div>
        </Show>

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
                    <span class="edit-mode-hint">{t('site.app.editModeHint')}</span>
                  </div>
                  <div class="edit-banner-controls">
                    <button
                      type="button"
                      class="btn btn-export"
                      onClick={() => setOffListExportOpen(true)}
                    >
                      {t('site.app.export')}
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
          {t('site.app.pricesDate', {
            date: formatDateTime(pricesDate()!, {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            }),
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
              {/* Gated on the index having loaded, not just this list's detail:
                  `sellModeAvailable` resolves from index.json, and
                  `useListViewUrlSync` reads the page's sell support once at
                  construction. Mounting before the index landed would drop a
                  shared `?sell=1` link's parameters and then strip them from
                  the URL for the life of the page. */}
              <Show when={deckList()} fallback={<LoadingSpinner />}>
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
                          enableSellMode={sellModeAvailable()}
                          bakedBuylist={() => wantedListDetail()?.buylist}
                          onCombine={openCombine}
                        />
                      }
                    >
                      <WantedEditView
                        enableSellMode={sellModeAvailable()}
                        detail={wantedListDetail()!}
                        slug={wantedListSlug() ?? ''}
                        currency={currency()}
                        onExit={exitEditMode}
                        moveTargets={moveTargetsFor('wanted', wantedListSlug)}
                      />
                    </Show>
                  </Show>
                </Show>
              </Show>
            </Match>
            <Match when={route().page === 'collection'}>
              {/* Gated on the index having loaded, not just this list's detail:
                  `sellModeAvailable` resolves from index.json, and
                  `useListViewUrlSync` reads the page's sell support once at
                  construction. Mounting before the index landed would drop a
                  shared `?sell=1` link's parameters and then strip them from
                  the URL for the life of the page. */}
              <Show when={deckList()} fallback={<LoadingSpinner />}>
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
                          listLabels={collectionDetail()!.labels}
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
                          enableSellMode={sellModeAvailable()}
                          bakedBuylist={() => collectionDetail()?.buylist}
                          onCombine={openCombine}
                        />
                      }
                    >
                      <CollectionEditView
                        enableSellMode={sellModeAvailable()}
                        detail={collectionDetail()!}
                        slug={collectionSlug() ?? ''}
                        currency={currency()}
                        onExit={exitEditMode}
                        moveTargets={moveTargetsFor('collection', collectionSlug)}
                      />
                    </Show>
                  </Show>
                </Show>
              </Show>
            </Match>
            <Match when={route().page === 'deck'}>
              {/* Gated on the index having loaded, not just this list's detail:
                  `sellModeAvailable` resolves from index.json, and
                  `useListViewUrlSync` reads the page's sell support once at
                  construction. Mounting before the index landed would drop a
                  shared `?sell=1` link's parameters and then strip them from
                  the URL for the life of the page. */}
              <Show when={deckList()} fallback={<LoadingSpinner />}>
                <Show when={!deckError()} fallback={<ErrorMessage message={deckError()!} />}>
                  <Show when={!deckLoading() && deckDetail()} fallback={<LoadingSpinner />}>
                    <Show
                      when={editMode()}
                      fallback={
                        <DeckPage
                          deck={deckDetail()!.deck}
                          listLabels={deckDetail()!.labels}
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
                          enableSellMode={sellModeAvailable()}
                          bakedBuylist={() => deckDetail()?.buylist}
                          onCombine={openCombine}
                        />
                      }
                    >
                      <DeckEditView
                        enableSellMode={sellModeAvailable()}
                        detail={deckDetail()!}
                        slug={deckSlug() ?? ''}
                        currency={currency()}
                        onExit={exitEditMode}
                        moveTargets={moveTargetsFor('deck', deckSlug)}
                      />
                    </Show>
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
                  enableSellMode={sellModeAvailable()}
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
                  lists={allNamedLists}
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
        {/* Segments, not concatenation: the link sits mid-sentence and a
            translator must be free to move it. */}
        <p>
          <For each={tSegments('site.app.generatedBy', { tool: 'ritual' })}>
            {(segment) =>
              segment.kind === 'param' ? (
                <a href="https://github.com/sloshy/ritual">{segment.value}</a>
              ) : (
                segment.value
              )
            }
          </For>
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
        {(toast) => (
          <div class="trade-add-toast" aria-live="polite">
            <Show when={toast().imageUrl}>
              {(url) => <img class="trade-add-toast-thumb" src={url()} alt="" />}
            </Show>
            {t('site.app.tradeToastAdded', { name: toast().name })}
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
        currency={currency()}
        onClose={closeSelectionView}
        onRemoveAll={editMode() ? handleRemoveAll : undefined}
        onMoveAll={editMode() ? handleMoveAll : undefined}
        moveAllTargets={editMode() ? moveAllTargets : undefined}
      />

      {/* Cross-list "Find Other Printings" lookup, opened from the card modal or
          the editor context menu. Mounting it also flags the entry points on. */}
      <FindPrintingsModal
        lists={allNamedLists}
        current={currentListRef}
        currency={currency()}
        useScryfallImgUrls={useScryfallImgUrls()}
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

      {/* One-time confirmation before a keep-labeled card enters a trade. */}
      <Show when={pendingKeepTradePrompt()}>
        {(prompt) => (
          <ConfirmDialog
            open
            title={t('site.app.keepTradeTitle', { name: prompt().cardName })}
            message={t('site.app.keepTradeMessage')}
            confirmLabel={t('site.app.keepTradeConfirm')}
            onConfirm={() => prompt().onConfirm()}
            onCancel={() => prompt().onCancel()}
          />
        )}
      </Show>

      {/* Cross-list "remove every selected card" confirmation (was window.confirm). */}
      <Show when={removeAllTarget()}>
        {(target) => (
          <ConfirmDialog
            open
            title={t('ui.selection.confirmRemoveAll', { count: target().count })}
            confirmLabel={t('site.app.removeSelectedConfirm')}
            destructive
            onConfirm={confirmRemoveAll}
            onCancel={() => setRemoveAllTarget(null)}
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

function Root() {
  const themeStore = createThemeStore()
  syncFaviconToTheme(themeStore)
  // The i18n store wraps everything, exactly like the theme store: `useT()`
  // reads its locale signal on every call, so a language switch re-renders the
  // whole tree rather than only the components that happen to remount.
  const i18nStore = createI18nStore()
  return (
    <I18nProvider store={i18nStore}>
      <ThemeProvider store={themeStore}>
        <EditChromeProvider>
          <Show when={themeStore.editorOpen()}>
            <ThemeEditor />
          </Show>
          <App />
        </EditChromeProvider>
      </ThemeProvider>
    </I18nProvider>
  )
}

render(() => <Root />, document.getElementById('app')!)
