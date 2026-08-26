import { type Component, For, Show } from 'solid-js'
import { LIST_TYPE_DISPLAY } from '../../../list/list-type'
import { useT } from '../../../ui/i18n'
import { formatPrintingAnnotation } from '../../../changes/change-event'
import type { ScryfallCard } from '../../../scryfall/types'
import { resolveCardImageSources, isCardSideways } from '../../../card/image-sources'
import { TooltipOverlay } from '../../../ui/TooltipOverlay'
import { useTooltip } from '../../../ui/useTooltip'
import type { CardGroup } from '../move-overlay'
import { lookupPrintingCard } from '../../../card/printing-key'

interface MoveSearchResultsProps {
  query: string
  results: CardGroup[]
  /** Merged Scryfall card data (keyed by name and `set:collector_number`) for hover previews. */
  cards: Record<string, ScryfallCard | null>
  /** Resolve a list's display name from its type + slug. */
  listName: (type: CardGroup['listType'], slug: string) => string
  onMove: (group: CardGroup, rect: DOMRect) => void
}

/** A printing/finish annotation for a search row, e.g. ` (LEA:161) [foil]`. */
function annotation(group: CardGroup): string {
  return formatPrintingAnnotation({
    set: group.set,
    collectorNumber: group.collectorNumber,
    finish: group.finish,
    condition: group.condition,
  })
}

/**
 * Flat, cross-list results for the card-name search. Each row is a group of
 * identical copies in one list, tagged with its source list. The whole row is a
 * button that opens the destination menu, and hovering it shows the card-image
 * preview (the same hover behaviour as the list views on other pages).
 */
export const MoveSearchResults: Component<MoveSearchResultsProps> = (props) => {
  const t = useT()
  const { tooltip, tooltipPos, tooltipRef, setTooltip } = useTooltip()

  // Resolve the specific printing's card (falling back to the by-name representative).
  const cardFor = (group: CardGroup): ScryfallCard | null => lookupPrintingCard(props.cards, group)

  const showPreview = (group: CardGroup) => {
    const card = cardFor(group)
    if (!card) return
    const { frontImage } = resolveCardImageSources(card, true)
    if (frontImage) setTooltip({ src: frontImage, sideways: isCardSideways(card) })
  }

  return (
    <div class="move-search-results">
      <Show
        when={props.results.length > 0}
        fallback={
          <p class="text-muted move-search-empty">
            {t('admin.moveSearch.empty', { query: props.query })}
          </p>
        }
      >
        <p class="page-stats">{t('admin.move.matches', { count: props.results.length })}</p>
        <ul class="move-search-list">
          <For each={props.results}>
            {(group) => (
              <li>
                <button
                  type="button"
                  class="move-search-row"
                  aria-label={t('admin.moveSearch.moveLabel', { name: group.name })}
                  // Anchor the menu at the click point, not the full-width row, so it
                  // opens next to the cursor rather than at the screen edge.
                  onClick={(e) => props.onMove(group, new DOMRect(e.clientX, e.clientY, 0, 0))}
                  onMouseEnter={() => showPreview(group)}
                  onMouseLeave={() => setTooltip(null)}
                >
                  <Show when={group.keys.length > 1}>
                    <span class="move-search-qty">{group.keys.length}</span>
                  </Show>
                  <span class="move-search-name">
                    {group.name}
                    <span class="move-search-annotation">{annotation(group)}</span>
                  </span>
                  <span class="move-search-source">
                    {LIST_TYPE_DISPLAY[group.listType].icon}{' '}
                    {props.listName(group.listType, group.listSlug)}
                  </span>
                  <span class="move-search-move" aria-hidden="true">
                    →
                  </span>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>

      {/* Hover card-image preview, matching the list views on other pages. */}
      <TooltipOverlay tooltip={tooltip()} pos={tooltipPos()} tooltipRef={tooltipRef} />
    </div>
  )
}
