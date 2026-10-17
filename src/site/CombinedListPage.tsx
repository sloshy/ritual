import type { Component } from 'solid-js'
import { createSignal, createMemo, createEffect, on, onCleanup, For, Show } from 'solid-js'
import { seedCards, seedPrintings, sessionCacheVersion } from '../list-view/session-cache'
import { apiBase } from '../list-view/api-base'
import type { PriceCurrency } from '../pricing/price-currency'
import type { ListType } from '../list/list-type'
import { useI18n } from '../ui/i18n'
import { formatUnitListParts } from '../i18n/format'
import { isAbortError } from '../util/errors'
import { CombinedCardsView } from './CombinedCardsView'
import type { SelectionListId } from '../list-view/useCardSelection'
import {
  type CombinedCardData,
  type LoadedListDetail,
  type NamedListRef,
  buildCombinedCards,
  listHref,
  listRefKey,
  loadCombinedDetails,
  mergeBakedBuylists,
  mergeSymbolMaps,
  mergeCardMaps,
  mergePrintingMaps,
} from '../list-view/combined-list'

/**
 * One piece of the "Combining:" line: a source list (rendered as a link to it)
 * or the locale's separator text between two of them.
 */
type SourcePart = { kind: 'list'; list: NamedListRef } | { kind: 'separator'; text: string }

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
  /** Offer sell mode; true only on a site built with `site.sellMode` on. */
  enableSellMode?: boolean
  /** Every list on the site, for the share filters (member lists stay offered). */
  allLists?: NamedListRef[]
}

export const CombinedListPage: Component<CombinedListPageProps> = (props) => {
  const { t, locale } = useI18n()
  const [loaded, setLoaded] = createSignal<LoadedListDetail[] | null>(null)
  const [error, setError] = createSignal(false)

  // Fetch every selected list's detail JSON whenever the selection changes. The key
  // string keeps the effect from re-firing when the array identity changes but the
  // contents don't. The API base is tracked too, so resolving or degrading the
  // live backend reloads from the right source.
  const listsKey = createMemo(() => props.lists.map(listRefKey).join(','))
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
          if (isAbortError(e)) return
          console.error(t('site.combined.viewFailedLog'), e)
          setError(true)
          setLoaded([])
        }
      })()
    }),
  )

  // The source lists as the reader's locale lists them, each name a link: the
  // locale places the separators, so the line is never hand-joined in English.
  const sourceParts = createMemo<SourcePart[]>(() => {
    const lists = props.lists
    let next = 0
    return formatUnitListParts(
      locale(),
      lists.map((l) => l.name),
    ).map((part): SourcePart => {
      if (part.type === 'literal') return { kind: 'separator', text: part.value }
      const list = lists[next++]
      return list ? { kind: 'list', list } : { kind: 'separator', text: part.value }
    })
  })

  // Header description for an "all" view: every list, or every list of one type.
  // `null` for an explicit selection, which enumerates its lists instead.
  // A `$select` branch per list type rather than a verb spliced onto a
  // lowercased noun: that concatenation only ever worked in English.
  const allLabel = createMemo<string | null>(() => {
    if (!props.all) return null
    return props.allType
      ? t('site.combined.viewingAllOfType', { listType: props.allType })
      : t('site.combined.viewingAll')
  })

  // Page title: "All Decks"/"All Collections"/"All Wanted Lists" for a single-type
  // "all" view, "All Cards" for every list (equivalent to all cards across types),
  // and "Combined List" for an explicit multi-list selection.
  const pageTitle = createMemo<string>(() => {
    if (!props.all) return t('site.combined.title')
    return props.allType
      ? t('site.combined.allOfType', { listType: props.allType })
      : t('site.combined.allCards')
  })

  const symbolMap = createMemo(() => mergeSymbolMaps(loaded() ?? []))

  // The baked quotes of every list in the view, merged. Undefined while the
  // details are still loading as well as when none of them carries quotes —
  // both are "nothing to seed yet", and the seeding effect re-runs on arrival.
  const bakedBuylist = createMemo(() => mergeBakedBuylists(loaded() ?? []))

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
      bakedBuylist={bakedBuylist}
      shareLists={props.allLists}
      enableUrlState
      title={pageTitle()}
      loading={loaded() === null}
      error={error() ? t('site.combined.loadFailed') : undefined}
      header={
        <Show
          when={allLabel()}
          fallback={
            <p class="combined-sources">
              {t('site.combined.combining')}{' '}
              <For each={sourceParts()}>
                {(part) =>
                  part.kind === 'separator' ? (
                    part.text
                  ) : (
                    <a class="combined-source-name" href={listHref(part.list.type, part.list.slug)}>
                      {part.list.name}
                    </a>
                  )
                }
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
