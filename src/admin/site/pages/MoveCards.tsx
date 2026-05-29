import { type JSX, Show, Switch, Match, For, createSignal, createMemo } from 'solid-js'
import { DEFAULT_CURRENCY } from '../../../price-currency'
import type { CardPrintingOptions } from '../../../change-event'
import type { CardContextInfo } from '../../../site/card-context'
import { DeckPage } from '../../../site/DeckPage'
import { CollectionPage } from '../../../site/CollectionPage'
import { WantedListPage } from '../../../site/WantedListPage'
import type { MoveListInfo } from '../../api/move'
import {
  type TileTarget,
  type MoveDestPrinting,
  type CardGroup,
  listInfoId,
  needsPrintingFor,
  groupListsByType,
} from '../move-overlay'
import { useMoveSession } from '../hooks/useMoveSession'
import { StatusAlerts } from '../components/StatusAlerts'
import { MoveDestinationMenu } from '../components/MoveDestinationMenu'
import { MoveFiltersPanel } from '../components/MoveFiltersPanel'
import { MovePendingDialog } from '../components/MovePendingDialog'
import { MoveSearchResults } from '../components/MoveSearchResults'
import { QuantityDialog } from '../components/QuantityDialog'
import { CardSearchModal } from '../components/CardSearchModal'

/** Multi-step state for moving one tile: pick destination → (printing) → (quantity) → queue. */
type MoveFlow = {
  sourceList: MoveListInfo
  target: TileTarget
  available: number
  anchorRect: DOMRect
  step: 'menu' | 'printing' | 'quantity'
  dest?: MoveListInfo
  override?: MoveDestPrinting
}

export function MoveCards(): JSX.Element {
  const session = useMoveSession()
  const [filtersOpen, setFiltersOpen] = createSignal(false)
  const [pendingOpen, setPendingOpen] = createSignal(false)
  const [modalKey, setModalKey] = createSignal<string | null>(null)
  const [flow, setFlow] = createSignal<MoveFlow | null>(null)

  const listNameOf = (type: MoveListInfo['type'], slug: string): string =>
    session.lists().find((l) => l.type === type && l.slug === slug)?.name ?? slug

  // ── Move flow ────────────────────────────────────────────────────────────────
  const openMoveMenu = (sourceList: MoveListInfo, target: TileTarget, anchorRect: DOMRect) => {
    const available = session.availableToMove(sourceList, target)
    if (available <= 0) return
    setFlow({ sourceList, target, available, anchorRect, step: 'menu' })
  }

  const cancelFlow = () => setFlow(null)

  const chooseDest = (dest: MoveListInfo) => {
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

  const afterDest = (dest: MoveListInfo, override: MoveDestPrinting | undefined) => {
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

  const doMove = (dest: MoveListInfo, count: number, override: MoveDestPrinting | undefined) => {
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
    const source: MoveListInfo = {
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
    const dest = f.dest ? ` to ${f.dest.name}` : ''
    return `How many of the ${f.available} copies of ${f.target.cardName} do you want to move${dest}?`
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
      <h2 class="section-heading">Move Cards</h2>

      <div class="move-toolbar">
        <div class="deck-selector-container move-toolbar-select">
          <label class="deck-selector-label" for="move-list-select">
            Browse list
          </label>
          <select
            id="move-list-select"
            class="deck-selector"
            value={session.viewedListId() ?? ''}
            onChange={onSelectorChange}
          >
            <option value="">— Choose a list —</option>
            <For each={listsByType()}>
              {(group) => (
                <optgroup label={group.label}>
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
            Search cards
          </label>
          <input
            id="move-search-input"
            class="form-input move-search-input"
            type="text"
            placeholder="Type a card name to search every list…"
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
            Filters
          </button>
          <button type="button" class="btn-changes" onClick={() => setPendingOpen(true)}>
            Pending
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
            {session.saving() ? 'Saving...' : 'Save Moves'}
          </button>
          <button
            type="button"
            class="btn-discard"
            disabled={session.pendingCount() === 0}
            onClick={() => session.discardAll()}
          >
            Discard
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

      <Show when={session.loaded()} fallback={<p class="text-muted">Loading lists…</p>}>
        <Switch
          fallback={
            <p class="text-muted move-empty">
              Choose a list to browse, or search for a card to move.
            </p>
          }
        >
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
            <p class="text-muted">Loading {session.viewedList()?.name}…</p>
          </Match>
          <Match when={deckView()}>
            {(view) => (
              <DeckPage
                deck={view().deck}
                cards={session.cardData.cards}
                printings={session.cardData.printings}
                symbolMap={session.cardData.symbolMap}
                slug={session.viewedList()?.slug ?? ''}
                useScryfallImgUrls={true}
                modalCardName={modalKey()}
                onOpenModal={setModalKey}
                onCloseModal={closeModal}
                currency={DEFAULT_CURRENCY}
                onCardMove={handleCardMove}
              />
            )}
          </Match>
          <Match when={collectionView()}>
            {(view) => (
              <CollectionPage
                name={view().name}
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
                currency={DEFAULT_CURRENCY}
                onCardMove={handleCardMove}
              />
            )}
          </Match>
          <Match when={wantedView()}>
            {(view) => (
              <WantedListPage
                name={view().name}
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
                currency={DEFAULT_CURRENCY}
                onCardMove={handleCardMove}
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
        requirePrinting={true}
        defaults={{ kind: 'collection', sets: [] }}
      />

      {/* Quantity prompt for multi-copy moves */}
      <QuantityDialog
        open={flow()?.step === 'quantity'}
        title="Move cards"
        message={quantityMessage()}
        total={quantityTotal()}
        confirmLabel="Move"
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
    </div>
  )
}
