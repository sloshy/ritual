import type { Component } from 'solid-js'
import { createSignal, createMemo, createEffect, on, onCleanup, For, Show } from 'solid-js'
import { seedCards, seedPrintings, sessionCacheVersion } from './session-cache'
import { apiBase } from './api-base'
import type { PriceCurrency } from '../price-currency'
import { LIST_TYPE_DISPLAY, type ListType } from '../list-type'
import { CombinedCardsView } from './CombinedCardsView'
import type { SelectionListId } from './useCardSelection'
import {
  type CombinedCardData,
  type LoadedListDetail,
  type NamedListRef,
  buildCombinedCards,
  listHref,
  loadCombinedDetails,
  mergeSymbolMaps,
  mergeCardMaps,
  mergePrintingMaps,
} from './combined-list'

interface CombinedListPageProps {
  /** True when viewing every list ("All" was chosen in the modal or navbar). */
  all: boolean
  /** When `all`, restricts the view to a single list type (e.g. "all decks"). */
  allType?: ListType
  /** The resolved lists being combined (every matching list when `all`), in selection order. */
  lists: NamedListRef[]
  currency: PriceCurrency
  useScryfallImgUrls: boolean
  /** Offer "Add to Trade" in the multi-select menu (public site only). */
  enableTrade?: boolean
  /** Offer sell mode; true only on a server-backed site with `site.sellMode` on. */
  enableSellMode?: boolean
}

export const CombinedListPage: Component<CombinedListPageProps> = (props) => {
  const [loaded, setLoaded] = createSignal<LoadedListDetail[] | null>(null)
  const [error, setError] = createSignal(false)

  // Fetch every selected list's detail JSON whenever the selection changes. The key
  // string keeps the effect from re-firing when the array identity changes but the
  // contents don't. The API base is tracked too, so resolving or degrading the
  // live backend reloads from the right source.
  const listsKey = createMemo(() => props.lists.map((l) => `${l.type}:${l.slug}`).join(','))
  createEffect(
    on([listsKey, apiBase], () => {
      const refs = props.lists
      setLoaded(null)
      setError(false)
      if (refs.length === 0) {
        setLoaded([])
        return
      }
      const controller = new AbortController()
      onCleanup(() => controller.abort())
      void (async () => {
        try {
          const result = await loadCombinedDetails(refs, controller.signal)
          // Seed the shared session cache so the trade page reuses this data.
          seedCards(mergeCardMaps(result))
          seedPrintings(mergePrintingMaps(result))
          setLoaded(result)
        } catch (e) {
          if ((e as Error).name === 'AbortError') return
          console.error('Combined view: load failed', e)
          setError(true)
          setLoaded([])
        }
      })()
    }),
  )

  // Header description for an "all" view: every list, or every list of one type.
  // `null` for an explicit selection, which enumerates its lists instead.
  const allLabel = createMemo<string | null>(() => {
    if (!props.all) return null
    return props.allType
      ? `Viewing all ${LIST_TYPE_DISPLAY[props.allType].label.toLowerCase()}`
      : 'Viewing all cards from all lists'
  })

  // Page title: "All Decks"/"All Collections"/"All Wanted Lists" for a single-type
  // "all" view, "All Cards" for every list (equivalent to all cards across types),
  // and "Combined List" for an explicit multi-list selection.
  const pageTitle = createMemo<string>(() => {
    if (!props.all) return 'Combined List'
    return props.allType ? `All ${LIST_TYPE_DISPLAY[props.allType].label}` : 'All Cards'
  })

  const symbolMap = createMemo(() => mergeSymbolMaps(loaded() ?? []))

  const combinedCards = createMemo((): CombinedCardData[] => {
    sessionCacheVersion() // re-price after an in-session "Update Prices"
    const l = loaded()
    if (!l) return []
    return buildCombinedCards(l, props.currency, props.useScryfallImgUrls)
  })

  const selectionLists = createMemo<SelectionListId[]>(() =>
    props.lists.map((l) => ({ kind: l.type, name: l.name })),
  )

  return (
    <CombinedCardsView
      cards={combinedCards()}
      symbolMap={symbolMap()}
      selectionLists={selectionLists()}
      currency={props.currency}
      useScryfallImgUrls={props.useScryfallImgUrls}
      enableTrade={props.enableTrade}
      enableSellMode={props.enableSellMode}
      enableUrlState
      title={pageTitle()}
      loading={loaded() === null}
      error={error() ? 'Failed to load one or more lists.' : undefined}
      header={
        <Show
          when={allLabel()}
          fallback={
            <p class="combined-sources">
              Combining:{' '}
              <For each={props.lists}>
                {(l, i) => (
                  <>
                    <Show when={i() > 0}>{', '}</Show>
                    <a class="combined-source-name" href={listHref(l.type, l.slug)}>
                      {l.name}
                    </a>
                  </>
                )}
              </For>
            </p>
          }
        >
          {(label) => <p class="combined-sources">{label()}</p>}
        </Show>
      }
    />
  )
}
