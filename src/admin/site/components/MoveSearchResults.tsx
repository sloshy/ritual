import { type Component, For, Show } from 'solid-js'
import { LIST_TYPE_DISPLAY } from '../../../list-type'
import { formatPrintingAnnotation } from '../../../change-event'
import type { ScryfallCard } from '../../../types'
import { resolveCardImageSources, isCardSideways } from '../../../site/image-sources'
import { useTooltip } from '../../../site/useTooltip'
import type { CardGroup } from '../move-overlay'
import { printingKey } from '../../../printing-key'

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
  const { tooltip, tooltipPos, tooltipRef, setTooltip } = useTooltip()

  // Resolve the specific printing's card (falling back to the by-name representative).
  const cardFor = (group: CardGroup): ScryfallCard | null => {
    if (group.set && group.collectorNumber) {
      return (
        props.cards[printingKey(group.set, group.collectorNumber)] ??
        props.cards[group.name] ??
        null
      )
    }
    return props.cards[group.name] ?? null
  }

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
            No cards match “{props.query}” in the enabled source lists.
          </p>
        }
      >
        <p class="page-stats">
          {props.results.length} match{props.results.length === 1 ? '' : 'es'}
        </p>
        <ul class="move-search-list">
          <For each={props.results}>
            {(group) => (
              <li>
                <button
                  type="button"
                  class="move-search-row"
                  aria-label={`Move ${group.name} to another list`}
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
      <div
        ref={tooltipRef}
        class={`list-tooltip ${tooltip() ? 'visible' : ''} ${tooltip()?.sideways ? 'list-tooltip-sideways' : ''}`}
        style={`left:${tooltipPos().left}px;top:${tooltipPos().top}px;`}
      >
        <Show when={tooltip()}>
          <img src={tooltip()!.src} alt="" class={tooltip()!.sideways ? 'tooltip-rotated' : ''} />
        </Show>
      </div>
    </div>
  )
}
