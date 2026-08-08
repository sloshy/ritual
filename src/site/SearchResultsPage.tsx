import type { Component } from 'solid-js'
import { createMemo, For, Show } from 'solid-js'
import type { PriceCurrency } from '../price-currency'
import { sessionCacheVersion } from './session-cache'
import { CombinedCardsView } from './CombinedCardsView'
import type { ListType } from '../list-type'
import type { SelectionListId } from './useCardSelection'
import {
  type CombinedCardData,
  buildCombinedCards,
  listHref,
  mergeSymbolMaps,
} from './combined-list'
import { searchResults } from './search-results-state'
import { useI18n } from '../ui/i18n'

interface SearchResultsPageProps {
  currency: PriceCurrency
  useScryfallImgUrls: boolean
}

/** A source list contributing matches, for the header line that links back to each. */
interface SourceLink {
  type: ListType
  slug: string
  name: string
}

/**
 * "View As List" target for the Find page: renders the matched cards through the
 * shared combined-cards view as a synthetic list named "Search Results". Reads
 * the matched subset from the module-level hand-off; a direct visit with no
 * pending search shows an empty state pointing back to Find.
 */
export const SearchResultsPage: Component<SearchResultsPageProps> = (props) => {
  const { t, tSegments } = useI18n()
  const symbolMap = createMemo(() => mergeSymbolMaps(searchResults()?.loaded ?? []))

  const cards = createMemo((): CombinedCardData[] => {
    sessionCacheVersion() // re-price after an in-session "Update Prices"
    const data = searchResults()
    if (!data) return []
    return buildCombinedCards(data.loaded, props.currency, props.useScryfallImgUrls).filter((c) =>
      data.matchedKeys.has(c.selectKey),
    )
  })

  // Distinct source lists among the matched cards, scoping the multi-select menu.
  const selectionLists = createMemo<SelectionListId[]>(() => {
    const seen = new Set<string>()
    const out: SelectionListId[] = []
    for (const c of cards()) {
      const key = `${c.sourceKind} ${c.sourceName}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ kind: c.sourceKind, name: c.sourceName })
    }
    return out
  })

  // The source lists contributing matches, for the header line (links back to each).
  const sources = createMemo<SourceLink[]>(() => {
    const seen = new Set<string>()
    const out: SourceLink[] = []
    for (const c of cards()) {
      const key = `${c.sourceKind}:${c.sourceSlug}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ type: c.sourceKind, slug: c.sourceSlug, name: c.sourceName })
    }
    return out
  })

  return (
    <Show
      when={searchResults()}
      fallback={
        <div class="page-container">
          {/* Segments, not concatenation: the link sits mid-sentence and a
              translator must be free to move it. */}
          <div class="combined-empty">
            <For
              each={tSegments('site.searchResults.none', {
                link: t('site.searchResults.goToFind'),
              })}
            >
              {(segment) =>
                segment.kind === 'param' ? <a href="#/find">{segment.value}</a> : segment.value
              }
            </For>
          </div>
        </div>
      }
    >
      <CombinedCardsView
        cards={cards()}
        symbolMap={symbolMap()}
        selectionLists={selectionLists()}
        currency={props.currency}
        useScryfallImgUrls={props.useScryfallImgUrls}
        enableTrade
        title={t('site.searchResults.title')}
        emptyMessage={t('site.searchResults.empty')}
        header={
          <Show when={sources().length > 0}>
            <p class="combined-sources">
              {t('site.searchResults.from')}{' '}
              <For each={sources()}>
                {(s, i) => (
                  <>
                    <Show when={i() > 0}>{', '}</Show>
                    <a class="combined-source-name" href={listHref(s.type, s.slug)}>
                      {s.name}
                    </a>
                  </>
                )}
              </For>
            </p>
          </Show>
        }
      />
    </Show>
  )
}
