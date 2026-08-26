import { type JSX, Show, Switch, Match, For, createSignal, createMemo, onCleanup } from 'solid-js'
import { useNavigationGuard } from '../../../editor/navigation-guard'
import { useT, useTKey } from '../../../ui/i18n'
import { ConfirmDialog } from '../../../ui/ConfirmDialog'
import { useDefaultCurrency } from '../hooks/useDefaultCurrency'
import { useSearchDebounce } from '../hooks/useSearchDebounce'
import type { CardPrintingOptions } from '../../../changes/change-event'
import type { CardContextInfo } from '../../../site/card-context'
import { DeckPage } from '../../../site/DeckPage'
import { CollectionPage } from '../../../site/CollectionPage'
import { WantedListPage } from '../../../site/WantedListPage'
import type { ListInfo } from '../../../list/list-info'
import {
  type TileTarget,
  type MoveDestPrinting,
  type CardGroup,
  needsPrintingFor,
} from '../move-overlay'
import { listInfoId, groupListsByType } from '../list-grouping'
import { listInfosToNamedRefs } from '../move-targets'
import { useMoveSession } from '../hooks/useMoveSession'
import { StatusAlerts } from '../components/StatusAlerts'
import { MoveDestinationMenu } from '../components/MoveDestinationMenu'
import { MoveFiltersPanel } from '../components/MoveFiltersPanel'
import { MovePendingDialog } from '../components/MovePendingDialog'
import { MoveSearchResults } from '../components/MoveSearchResults'
import { QuantityDialog } from '../../../ui/QuantityDialog'
import { CardSearchModal } from '../../../editor/components/CardSearchModal'
import { adminSearch } from '../editor-backend'
import { PageHeading } from '../components/PageHeading'
import { sellModeEnabled } from '../sell-enabled'

/** A navigation held back until the user says whether the queued moves may be dropped. */
type PendingLeave = {
  proceed: () => void
  /** Undoes whatever started the navigation — the router restores a refused Back's URL. */
  cancel?: () => void
}

/** Multi-step state for moving one tile: pick destination → (printing) → (quantity) → queue. */
type MoveFlow = {
  sourceList: ListInfo
  target: TileTarget
  available: number
  anchorRect: DOMRect
  step: 'menu' | 'printing' | 'quantity'
  dest?: ListInfo
  override?: MoveDestPrinting
}

export function MoveCards(): JSX.Element {
  const t = useT()
  const tKey = useTKey()
  const defaultCurrency = useDefaultCurrency()
  useSearchDebounce()
  const session = useMoveSession()
  // One conversion for the three list views' share filters, so the array keeps
  // its identity (and downstream option memos stay warm) across re-renders.
  const shareLists = createMemo(() => listInfosToNamedRefs(session.lists()))
  const [filtersOpen, setFiltersOpen] = createSignal(false)
  const [pendingOpen, setPendingOpen] = createSignal(false)
  const [modalKey, setModalKey] = createSignal<string | null>(null)
  const [flow, setFlow] = createSignal<MoveFlow | null>(null)
  const [pendingLeave, setPendingLeave] = createSignal<PendingLeave | null>(null)

  // Queued moves live in this page's session, so leaving throws them away —
  // confirm first, exactly as the editors do with unsaved card changes. Also
  // covers the browser's Back/Forward and the tab-close prompt, both of which
  // go through this guard.
  const guard = useNavigationGuard()
  const guardedNavigate = (proceed: () => void, onCancel?: () => void) => {
    if (session.pendingCount() === 0) {
      proceed()
      return
    }
    // A second attempt supersedes the first, which still has to undo whatever it
    // did to get here.
    pendingLeave()?.cancel?.()
    setPendingLeave({ proceed, cancel: onCancel })
  }
  onCleanup(guard.register({ attempt: guardedNavigate, isDirty: () => session.pendingCount() > 0 }))

  const leaveMessage = createMemo(() =>
    t('admin.move.unsavedWarning', { count: session.pendingCount() }),
  )

  const listNameOf = (type: ListInfo['type'], slug: string): string =>
    session.lists().find((l) => l.type === type && l.slug === slug)?.name ?? slug

  // ── Move flow ────────────────────────────────────────────────────────────────
  const openMoveMenu = (sourceList: ListInfo, target: TileTarget, anchorRect: DOMRect) => {
    const available = session.availableToMove(sourceList, target)
    if (available <= 0) return
    setFlow({ sourceList, target, available, anchorRect, step: 'menu' })
  }

  const cancelFlow = () => setFlow(null)

  const chooseDest = (dest: ListInfo) => {
    const f = flow()
    if (!f) return
    const printing: MoveDestPrinting = {
      set: f.target.set,
      collectorNumber: f.target.collectorNumber,
      finish: f.target.finish,
      condition: f.target.condition,
    }
    // A collection requires a specific printing; prompt for one when the card lacks it.
    if (needsPrintingFor(dest.type, printing)) {
      setFlow({ ...f, step: 'printing', dest })
      return
    }
    afterDest(dest, undefined)
  }

  const onPrintingPicked = (options?: CardPrintingOptions) => {
    const f = flow()
    if (!f || !f.dest) return
    afterDest(f.dest, {
      set: options?.set,
      collectorNumber: options?.collectorNumber,
      finish: options?.finish,
      condition: options?.condition,
    })
  }

  const afterDest = (dest: ListInfo, override: MoveDestPrinting | undefined) => {
    const f = flow()
    if (!f) return
    if (f.available > 1) {
      setFlow({ ...f, step: 'quantity', dest, override })
      return
    }
    doMove(dest, 1, override)
  }

  const onQuantity = (count: number) => {
    const f = flow()
    if (!f || !f.dest) return
    doMove(f.dest, count, f.override)
  }

  const doMove = (dest: ListInfo, count: number, override: MoveDestPrinting | undefined) => {
    const f = flow()
    if (!f) return
    session.requestMove(f.sourceList, f.target, count, dest, override)
    setFlow(null)
  }

  // ── Card → move handlers from the standard list view and from search ─────────
  const handleCardMove = (info: CardContextInfo, rect: DOMRect) => {
    const source = session.viewedList()
    if (!source) return
    openMoveMenu(source, info, rect)
  }

  const handleSearchMove = (group: CardGroup, rect: DOMRect) => {
    const source: ListInfo = {
      type: group.listType,
      slug: group.listSlug,
      name: listNameOf(group.listType, group.listSlug),
    }
    const target: TileTarget = {
      cardName: group.name,
      cardIds: group.cardIds,
      set: group.set,
      collectorNumber: group.collectorNumber,
      finish: group.finish,
      condition: group.condition,
    }
    openMoveMenu(source, target, rect)
  }

  // ── List selector ────────────────────────────────────────────────────────────
  const onSelectorChange = (e: Event) => {
    const value = (e.currentTarget as HTMLSelectElement).value
    session.selectList(value ? value : null)
  }

  const listsByType = createMemo(() => groupListsByType(session.lists()))

  // Read the active move flow once for the quantity prompt's reactive props.
  const quantityTotal = createMemo(() => flow()?.available ?? 1)
  const quantityMessage = createMemo(() => {
    const f = flow()
    if (!f) return ''
    // Two whole sentences rather than one with an optional trailing clause: a
    // destination spliced onto the end of a question does not survive word order.
    return f.dest
      ? t('admin.moveCards.quantityMessageTo', {
          total: f.available,
          name: f.target.cardName,
          dest: f.dest.name,
        })
      : t('admin.moveCards.quantityMessage', { total: f.available, name: f.target.cardName })
  })

  const showSearch = createMemo(() => session.search().trim().length >= 2)
  const isLoadingView = createMemo(
    () => !showSearch() && session.viewedListId() !== null && session.viewedData() === null,
  )

  // Typed, reactive narrowings of the overlaid list data so each page component
  // receives props that update as pending moves change.
  const deckView = createMemo(() => {
    const d = session.viewedData()
    return d && d.type === 'deck' ? d : null
  })
  const collectionView = createMemo(() => {
    const d = session.viewedData()
    return d && d.type === 'collection' ? d : null
  })
  const wantedView = createMemo(() => {
    const d = session.viewedData()
    return d && d.type === 'wanted' ? d : null
  })

  const closeModal = () => setModalKey(null)

  return (
    <div class="move-page">
      <PageHeading page="move-cards" />

      <div class="move-toolbar">
        <div class="deck-selector-container move-toolbar-select">
          <label class="deck-selector-label" for="move-list-select">
            {t('admin.moveCards.selectorLabel')}
          </label>
          <select
            id="move-list-select"
            class="deck-selector"
            value={session.viewedListId() ?? ''}
            onChange={onSelectorChange}
          >
            <option value="">{t('admin.select.chooseList')}</option>
            <For each={listsByType()}>
              {(group) => (
                <optgroup label={tKey(group.labelKey)}>
                  <For each={group.lists}>
                    {(list) => <option value={listInfoId(list)}>{list.name}</option>}
                  </For>
                </optgroup>
              )}
            </For>
          </select>
        </div>

        <div class="move-search-field">
          <label class="deck-selector-label" for="move-search-input">
            {t('admin.moveCards.searchLabel')}
          </label>
          <input
            id="move-search-input"
            class="form-input move-search-input"
            type="text"
            placeholder={t('admin.moveCards.searchPlaceholder')}
            value={session.search()}
            onInput={(e) => session.setSearch(e.currentTarget.value)}
          />
        </div>

        <div class="move-toolbar-actions">
          <button
            type="button"
            class="btn-defaults"
            aria-expanded={filtersOpen()}
            onClick={() => setFiltersOpen((v) => !v)}
          >
            <span class="btn-defaults-caret">{filtersOpen() ? '▾' : '▴'}</span>
            {t('admin.moveCards.filters')}
          </button>
          <button type="button" class="btn-changes" onClick={() => setPendingOpen(true)}>
            {t('admin.moveCards.pending')}
            <Show when={session.pendingCount() > 0}>
              <span class="changes-badge">{session.pendingCount()}</span>
            </Show>
          </button>
          <button
            type="button"
            class="btn-save"
            disabled={session.pendingCount() === 0 || session.saving()}
            onClick={() => void session.commit()}
          >
            {session.saving() ? t('admin.moveCards.saving') : t('admin.moveCards.save')}
          </button>
          <button
            type="button"
            class="btn btn-danger"
            disabled={session.pendingCount() === 0}
            onClick={() => session.discardAll()}
          >
            {t('admin.moveCards.discard')}
          </button>
        </div>
      </div>

      <Show when={filtersOpen()}>
        <div class="editor-action-defaults move-filters-dock">
          <MoveFiltersPanel
            lists={session.lists()}
            sourceEnabled={session.sourceEnabled}
            destEnabled={session.destEnabled}
            toggleSource={session.toggleSource}
            toggleDest={session.toggleDest}
            setAllSources={session.setAllSources}
            setAllDests={session.setAllDests}
          />
        </div>
      </Show>

      <StatusAlerts status={session.status()} error={session.error()} />

      <Show
        when={session.loaded()}
        fallback={<p class="text-muted">{t('admin.moveCards.loadingLists')}</p>}
      >
        <Switch fallback={<p class="text-muted move-empty">{t('admin.moveCards.empty')}</p>}>
          <Match when={showSearch()}>
            <MoveSearchResults
              query={session.search().trim()}
              results={session.searchResults()}
              cards={session.cardData.cards}
              listName={listNameOf}
              onMove={handleSearchMove}
            />
          </Match>
          <Match when={isLoadingView()}>
            <p class="text-muted">
              {t('admin.moveCards.loadingList', { name: session.viewedList()?.name ?? '' })}
            </p>
          </Match>
          <Match when={deckView()}>
            {(view) => (
              <DeckPage
                enableSellMode={sellModeEnabled()}
                deck={view().deck}
                cards={session.cardData.cards}
                printings={session.cardData.printings}
                symbolMap={session.cardData.symbolMap}
                slug={session.viewedList()?.slug ?? ''}
                useScryfallImgUrls={true}
                modalCardName={modalKey()}
                onOpenModal={setModalKey}
                onCloseModal={closeModal}
                currency={defaultCurrency()}
                onCardMove={handleCardMove}
                shareLists={shareLists()}
              />
            )}
          </Match>
          <Match when={collectionView()}>
            {(view) => (
              <CollectionPage
                enableSellMode={sellModeEnabled()}
                name={view().name}
                slug={session.viewedList()?.slug}
                entries={view().entries}
                sectionOrder={view().sectionOrder}
                cards={session.cardData.cards}
                printings={session.cardData.printings}
                symbolMap={session.cardData.symbolMap}
                useScryfallImgUrls={true}
                totalPrice={0}
                modalCardKey={modalKey()}
                onOpenModal={setModalKey}
                onCloseModal={closeModal}
                currency={defaultCurrency()}
                onCardMove={handleCardMove}
                shareLists={shareLists()}
              />
            )}
          </Match>
          <Match when={wantedView()}>
            {(view) => (
              <WantedListPage
                enableSellMode={sellModeEnabled()}
                name={view().name}
                slug={session.viewedList()?.slug}
                entries={view().entries}
                sectionOrder={view().sectionOrder}
                cards={session.cardData.cards}
                printings={session.cardData.printings}
                symbolMap={session.cardData.symbolMap}
                useScryfallImgUrls={true}
                totalPrice={0}
                modalCardKey={modalKey()}
                onOpenModal={setModalKey}
                onCloseModal={closeModal}
                currency={defaultCurrency()}
                onCardMove={handleCardMove}
                shareLists={shareLists()}
              />
            )}
          </Match>
        </Switch>
      </Show>

      {/* Move destination menu */}
      <Show when={flow()?.step === 'menu' ? flow() : null}>
        {(f) => (
          <MoveDestinationMenu
            cardName={f().target.cardName}
            anchorRect={f().anchorRect}
            destinations={session.destinationsFor(listInfoId(f().sourceList))}
            onSelect={chooseDest}
            onClose={cancelFlow}
          />
        )}
      </Show>

      {/* Printing picker for printing-less cards moving into a collection */}
      <CardSearchModal
        open={flow()?.step === 'printing'}
        initialCardName={flow()?.target.cardName}
        onClose={cancelFlow}
        onAddCard={(_name, options) => onPrintingPicked(options)}
        search={adminSearch}
        requirePrinting={true}
        defaults={{ kind: 'collection', sets: [] }}
      />

      {/* Quantity prompt for multi-copy moves */}
      <QuantityDialog
        open={flow()?.step === 'quantity'}
        title={t('admin.moveCards.quantityTitle')}
        message={quantityMessage()}
        total={quantityTotal()}
        confirmLabel={t('admin.moveCards.moveConfirm')}
        inputId="move-qty"
        onConfirm={onQuantity}
        onCancel={cancelFlow}
      />

      <MovePendingDialog
        open={pendingOpen()}
        pending={session.pending()}
        onRemove={session.removePending}
        onDiscardAll={() => {
          session.discardAll()
          setPendingOpen(false)
        }}
        onClose={() => setPendingOpen(false)}
      />

      {/* Leaving the page with moves still queued. The queue lives in this page's
          session, so navigating away is what discards it. */}
      <Show when={pendingLeave()}>
        {(leave) => (
          <ConfirmDialog
            open={true}
            title={t('admin.moveCards.leaveTitle')}
            message={leaveMessage()}
            confirmLabel={t('admin.moveCards.leaveConfirm')}
            destructive
            onConfirm={() => {
              const { proceed } = leave()
              setPendingLeave(null)
              proceed()
            }}
            onCancel={() => {
              const { cancel } = leave()
              setPendingLeave(null)
              cancel?.()
            }}
          />
        )}
      </Show>
    </div>
  )
}
