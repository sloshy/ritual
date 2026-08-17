import type { Component, Accessor } from 'solid-js'
import { createSignal, createMemo, onCleanup, For, Show } from 'solid-js'
import type { DeckSummary, CollectionSummary, WantedListSummary } from './data-types'
import type { PriceCurrency } from '../price-currency'
import { formatPrice } from '../price-currency'
import { cardPriceText, cardPricelessReason } from './priceless'
import { useT } from '../ui/i18n'
import { LIST_TYPE_DISPLAY, listTypeTitle, type ListType } from '../list-type'
import { CardItem } from './CardItem'
import { CardModal } from './CardModal'
import { finishName, rarityName } from './printing-display'
import { seedCards, seedPrintings, sessionCacheVersion } from './session-cache'
import { TooltipOverlay } from './TooltipOverlay'
import { useTooltip } from './useTooltip'
import { CARD_SIZE_WIDTHS, groupTotalPrice } from './card-sorting'
import { addSelectionToTrade } from './useSelectionTrade'
import type { SelectionState } from './useCardSelection'
import type { MetaEntry } from './meta-entry'
import {
  type CombinedCardData,
  type LoadedListDetail,
  type NamedListRef,
  buildCombinedCards,
  listHref,
  loadCombinedDetails,
  mergeCardMaps,
  mergePrintingMaps,
  mergeSymbolMaps,
} from './combined-list'
import { cardMatchKey, findMatchKey, parseSearchLines, partitionSearch } from './find-search'
import { setSearchResultsData } from './search-results-state'

/** Whether a search replaces the current results or merges into them. */
type SearchMode = 'replace' | 'add'

interface FindPageProps {
  decks: Accessor<DeckSummary[] | null>
  collections: Accessor<CollectionSummary[] | null>
  wantedLists: Accessor<WantedListSummary[] | null>
  currency: PriceCurrency
  useScryfallImgUrls: boolean
}

/** A run of matched cards sharing one source list, for the by-source results listing. */
interface FindResultGroup {
  kind: ListType
  slug: string
  name: string
  cards: CombinedCardData[]
}

export const FindPage: Component<FindPageProps> = (props) => {
  const t = useT()
  const [text, setText] = createSignal('')
  const [loaded, setLoaded] = createSignal<LoadedListDetail[] | null>(null)
  const [searching, setSearching] = createSignal(false)
  const [searched, setSearched] = createSignal(false)
  const [matchedKeys, setMatchedKeys] = createSignal<Set<string>>(new Set<string>())
  const [notFoundCount, setNotFoundCount] = createSignal(0)
  const [modalTile, setModalTile] = createSignal<CombinedCardData | null>(null)

  // Page-local multi-selection (a set of select-keys). Deliberately NOT backed by
  // the global selection store — picks here are scoped to this page only.
  const [selectedKeys, setSelectedKeys] = createSignal<Set<string>>(new Set<string>())

  const { tooltip, tooltipPos, tooltipRef, setTooltip } = useTooltip()

  const allRefs = createMemo<NamedListRef[]>(() => {
    const out: NamedListRef[] = []
    for (const d of props.decks() ?? []) out.push({ type: 'deck', slug: d.slug, name: d.name })
    for (const c of props.collections() ?? [])
      out.push({ type: 'collection', slug: c.slug, name: c.name })
    for (const w of props.wantedLists() ?? [])
      out.push({ type: 'wanted', slug: w.slug, name: w.name })
    return out
  })

  const symbolMap = createMemo(() => mergeSymbolMaps(loaded() ?? []))

  // Every card across every loaded list, rebuilt reactively so prices follow the
  // currency selector and in-session "Update Prices".
  const allCards = createMemo<CombinedCardData[]>(() => {
    sessionCacheVersion()
    const l = loaded()
    if (!l) return []
    return buildCombinedCards(l, props.currency, props.useScryfallImgUrls)
  })

  const matchedCards = createMemo<CombinedCardData[]>(() => {
    const keys = matchedKeys()
    if (keys.size === 0) return []
    return allCards().filter((c) => keys.has(c.selectKey))
  })

  const resultGroups = createMemo<FindResultGroup[]>(() => {
    const index = new Map<string, FindResultGroup>()
    const out: FindResultGroup[] = []
    for (const c of matchedCards()) {
      const key = `${c.sourceKind}:${c.sourceSlug}`
      let group = index.get(key)
      if (!group) {
        group = { kind: c.sourceKind, slug: c.sourceSlug, name: c.sourceName, cards: [] }
        index.set(key, group)
        out.push(group)
      }
      group.cards.push(c)
    }
    return out
  })

  // Lazily load every list's detail once, on the first search. The controller is
  // hoisted so an in-flight load is aborted if the page unmounts mid-fetch.
  let loadController: AbortController | null = null
  onCleanup(() => loadController?.abort())

  const ensureLoaded = async (): Promise<void> => {
    if (loaded()) return
    loadController = new AbortController()
    const result = await loadCombinedDetails(allRefs(), loadController.signal)
    loadController = null
    seedCards(mergeCardMaps(result))
    seedPrintings(mergePrintingMaps(result))
    setLoaded(result)
  }

  const runSearch = async (mode: SearchMode): Promise<void> => {
    const lines = parseSearchLines(text())
    setSearching(true)
    try {
      await ensureLoaded()
      // Read the reactive build (rebuilt by `allCards` once `loaded` is set) rather
      // than rebuilding here — keeps prices following the currency selector.
      const cards = allCards()
      const querySet = new Set(lines.map(findMatchKey).filter((k) => k.length > 0))
      const matched = cards.filter((c) => querySet.has(cardMatchKey(c)))
      const presentKeys = new Set(matched.map(cardMatchKey))
      const { notFound } = partitionSearch(lines, presentKeys)
      const newKeys = matched.map((c) => c.selectKey)
      const resultingKeys =
        mode === 'add' ? new Set([...matchedKeys(), ...newKeys]) : new Set(newKeys)
      setMatchedKeys(resultingKeys)
      // Drop any page-local selections for cards no longer in the results.
      setSelectedKeys((prev) => new Set([...prev].filter((k) => resultingKeys.has(k))))
      // Leave only the unmatched names behind for the user to revise or re-search.
      setText(notFound.join('\n'))
      setNotFoundCount(notFound.length)
      setSearched(true)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') throw e
    } finally {
      setSearching(false)
    }
  }

  // ----- Page-local selection -----

  const isSelected = (key: string): boolean => selectedKeys().has(key)

  const toggleSelect = (key: string): void => {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const groupState = (group: FindResultGroup): SelectionState => {
    const selected = group.cards.filter((c) => isSelected(c.selectKey)).length
    if (selected === 0) return 'none'
    return selected === group.cards.length ? 'all' : 'partial'
  }

  // Toggle every card in a source-list group: clear them all if all are selected,
  // otherwise select the whole group (filling a partial group up to full).
  const toggleGroup = (group: FindResultGroup): void => {
    const allSelected = groupState(group) === 'all'
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      for (const c of group.cards) {
        if (allSelected) next.delete(c.selectKey)
        else next.add(c.selectKey)
      }
      return next
    })
  }

  const selectedCards = createMemo<CombinedCardData[]>(() =>
    matchedCards().filter((c) => isSelected(c.selectKey)),
  )
  const selectedCopies = createMemo(() => selectedCards().reduce((sum, c) => sum + c.quantity, 0))
  const allSelected = createMemo(
    () => matchedCards().length > 0 && selectedCards().length === matchedCards().length,
  )

  const selectAll = (): void => {
    setSelectedKeys(new Set(matchedCards().map((c) => c.selectKey)))
  }

  const addSelectedToTrade = async (): Promise<void> => {
    const tiles = selectedCards().map((c) => c.selectedTile)
    setSelectedKeys(new Set<string>())
    await addSelectionToTrade(tiles, props.currency, props.useScryfallImgUrls)
  }

  const viewSelectedAsList = (): void => {
    const keys = selectedKeys()
    const usedLists = new Set(selectedCards().map((c) => `${c.sourceKind}:${c.sourceSlug}`))
    const subset = (loaded() ?? []).filter((l) => usedLists.has(`${l.kind}:${l.ref.slug}`))
    setSearchResultsData({ loaded: subset, matchedKeys: new Set(keys) })
    window.location.hash = '#/search-results'
  }

  const canSearch = createMemo(() => parseSearchLines(text()).length > 0 && !searching())
  const matchedCount = createMemo(() => matchedCards().reduce((sum, c) => sum + c.quantity, 0))

  const modalMeta = createMemo((): MetaEntry[] | undefined => {
    const card = modalTile()
    if (!card) return undefined
    const tile = card.selectedTile
    const parts: MetaEntry[] = [
      { label: 'price', value: cardPriceText(t, card, card.price, props.currency) },
      { label: 'list', value: card.sourceName },
    ]
    if (card.hasPrinting && tile.set) {
      parts.push({ label: 'set', value: `${tile.set.toUpperCase()}:${tile.collectorNumber}` })
    }
    if (tile.finish) parts.push({ label: 'finish', value: finishName(t, tile.finish) })
    if (tile.condition) parts.push({ label: 'condition', value: tile.condition })
    if (card.card) parts.push({ label: 'rarity', value: rarityName(t, card.card.rarity) })
    return parts
  })

  const renderRow = (c: CombinedCardData) => (
    <CardItem
      name={c.name}
      quantity={c.quantity}
      card={c.card}
      customArt={c.customArt}
      priceless={cardPricelessReason(c)}
      symbolMap={symbolMap()}
      viewMode="list"
      hideCount={c.quantity <= 1}
      useScryfallImgUrls={props.useScryfallImgUrls}
      onCardClick={() => setModalTile(c)}
      onTooltipEnter={(src, sideways) => setTooltip({ src, sideways })}
      onTooltipLeave={() => setTooltip(null)}
      collectionFinish={c.selectedTile.finish}
      collectionCondition={c.selectedTile.condition}
      collectionSetCN={
        c.hasPrinting && c.selectedTile.set
          ? `${c.selectedTile.set.toUpperCase()}:${c.selectedTile.collectorNumber}`
          : undefined
      }
      collectionPrice={c.price}
      currency={props.currency}
      selectable
      selectState={isSelected(c.selectKey) ? 'all' : 'none'}
      onToggleSelect={() => toggleSelect(c.selectKey)}
    />
  )

  return (
    <div class="page-container find-page">
      <div class="page-header">
        <div>
          <h1 class="page-title">{t('site.find.title')}</h1>
          <p class="page-stats">{t('site.find.subtitle')}</p>
        </div>
      </div>

      <textarea
        class="find-input"
        placeholder={t('site.find.placeholder')}
        rows={8}
        value={text()}
        onInput={(e) => setText(e.currentTarget.value)}
        autocomplete="off"
        autocorrect="off"
        autocapitalize="off"
        spellcheck={false}
      />

      <div class="find-controls">
        <button
          type="button"
          class="btn btn-export"
          disabled={!canSearch()}
          onClick={() => void runSearch('replace')}
        >
          {searching() ? t('site.find.searching') : t('site.find.search')}
        </button>
        <Show when={searched()}>
          <button
            type="button"
            class="btn btn-secondary"
            disabled={!canSearch()}
            onClick={() => void runSearch('add')}
          >
            {t('site.find.addCards')}
          </button>
        </Show>
      </div>

      <Show when={searched() && notFoundCount() > 0}>
        <div class="find-warning" role="status">
          {t('site.find.notFound', { count: notFoundCount() })}
        </div>
      </Show>

      <Show when={searched()}>
        <Show
          when={matchedCards().length > 0}
          fallback={<div class="find-empty">{t('site.find.noMatches')}</div>}
        >
          <p class="find-summary">
            {t('site.find.summary', {
              cards: t('ui.count.cards', { count: matchedCount() }),
              lists: t('ui.count.lists', { count: resultGroups().length }),
            })}
          </p>

          <div class="find-selection-bar" role="status">
            <span class="find-selection-count">
              {t('site.find.selected', { count: selectedCopies() })}
            </span>
            <button
              type="button"
              class="btn btn-secondary"
              disabled={allSelected()}
              onClick={selectAll}
            >
              {t('site.find.selectAll')}
            </button>
            <button
              type="button"
              class="btn btn-secondary"
              disabled={selectedCards().length === 0}
              onClick={() => void addSelectedToTrade()}
            >
              {t('site.find.addSelectedToTrade')}
            </button>
            <button
              type="button"
              class="btn btn-secondary"
              disabled={selectedCards().length === 0}
              onClick={viewSelectedAsList}
            >
              {t('site.find.viewSelectedAsList')}
            </button>
            <button
              type="button"
              class="btn btn-secondary"
              disabled={selectedCards().length === 0}
              onClick={() => setSelectedKeys(new Set<string>())}
            >
              {t('site.find.clearSelection')}
            </button>
          </div>

          <div
            class="find-results card-sections view-list"
            style={`--card-width:${CARD_SIZE_WIDTHS.medium}px`}
          >
            <For each={resultGroups()}>
              {(group) => {
                const state = (): SelectionState => groupState(group)
                return (
                  <div data-section={group.name}>
                    <div class="section-divider find-result-divider">
                      <button
                        type="button"
                        class="card-select-checkbox card-select-checkbox--list"
                        classList={{
                          selected: state() === 'all',
                          partial: state() === 'partial',
                        }}
                        aria-pressed={
                          state() === 'all' ? true : state() === 'partial' ? 'mixed' : false
                        }
                        aria-label={t('site.find.selectGroupAria', { name: group.name })}
                        onClick={() => toggleGroup(group)}
                      >
                        <span class="card-select-check" aria-hidden="true">
                          {state() === 'partial' ? '–' : '✓'}
                        </span>
                      </button>
                      <h2>
                        <a class="combined-source-name" href={listHref(group.kind, group.slug)}>
                          {group.name}
                        </a>
                      </h2>
                      <span class="find-result-kind">
                        <span aria-hidden="true">{LIST_TYPE_DISPLAY[group.kind].icon}</span>{' '}
                        {listTypeTitle(group.kind)}
                      </span>
                      <span class="section-count">
                        {group.cards.reduce((sum, c) => sum + c.quantity, 0)}
                      </span>
                      <span class="section-price">
                        {formatPrice(groupTotalPrice(group.cards), props.currency)}
                      </span>
                    </div>
                    <div class="binder-grid">
                      <For each={group.cards}>{(c) => renderRow(c)}</For>
                    </div>
                  </div>
                )
              }}
            </For>
          </div>
        </Show>
      </Show>

      {/* List-view hover tooltip */}
      <TooltipOverlay tooltip={tooltip()} pos={tooltipPos()} tooltipRef={tooltipRef} />

      <CardModal
        open={Boolean(modalTile())}
        card={modalTile()?.card ?? null}
        customArt={modalTile()?.customArt}
        hasCustomArt={modalTile()?.hasCustomArt}
        cardName={modalTile()?.name ?? null}
        symbolMap={symbolMap()}
        useScryfallImgUrls={props.useScryfallImgUrls}
        currency={props.currency}
        printings={modalTile()?.printings ?? []}
        onClose={() => setModalTile(null)}
        meta={modalMeta()}
        note={modalTile()?.selectedTile.note}
      />
    </div>
  )
}
