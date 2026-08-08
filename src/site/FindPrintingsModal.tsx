import type { Accessor, Component } from 'solid-js'
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  untrack,
  For,
  Show,
} from 'solid-js'
import { Modal } from '../ui/Modal'
import { useT } from '../ui/i18n'
import type { PriceCurrency } from '../price-currency'
import { LIST_TYPE_DISPLAY } from '../list-type'
import { CardItem } from './CardItem'
import { CARD_SIZE_WIDTHS } from './card-sorting'
import { seedCards, seedPrintings, sessionCacheVersion } from './session-cache'
import { TooltipOverlay } from './TooltipOverlay'
import { useTooltip } from './useTooltip'
import { requestCardNav } from './card-nav'
import {
  type FindPrintingsCopy,
  type FindPrintingsGroup,
  buildFindPrintingsGroups,
  closeFindPrintings,
  countFindPrintingsCopies,
  findPrintingsRequest,
  setFindPrintingsAvailable,
} from './find-printings'
import {
  type LoadedListDetail,
  type NamedListRef,
  buildCombinedCards,
  listHref,
  loadCombinedDetails,
  mergeCardMaps,
  mergePrintingMaps,
  mergeSymbolMaps,
} from './combined-list'

/** How the found copies are displayed: card-art grid or compact text rows. */
type FindPrintingsViewMode = 'binder' | 'list'

// Module-level so the chosen view survives closing and reopening the modal
// within a session (matching how the toolbar remembers its view per page).
const [viewMode, setViewMode] = createSignal<FindPrintingsViewMode>('binder')

export interface FindPrintingsModalProps {
  /** Every list known to the site index, in display order. */
  lists: Accessor<NamedListRef[]>
  /** The single list currently in view, if any — clicks on it skip navigation. */
  current: Accessor<NamedListRef | undefined>
  currency: PriceCurrency
  useScryfallImgUrls: boolean
}

/**
 * The "Find Other Printings" dialog: every copy of one card across every list,
 * grouped by list, viewable as a binder grid or a list with hover previews.
 * Clicking a copy closes the dialog and navigates to that copy in its list.
 * Rendered once at the app root and driven by {@link findPrintingsRequest}.
 */
export const FindPrintingsModal: Component<FindPrintingsModalProps> = (props) => {
  const t = useT()
  const [loaded, setLoaded] = createSignal<LoadedListDetail[] | null>(null)
  const [loading, setLoading] = createSignal(false)

  onMount(() => setFindPrintingsAvailable(true))
  onCleanup(() => setFindPrintingsAvailable(false))

  // Lazily load every list's detail JSON on the first lookup, then keep it for
  // the session (the component outlives page navigation). Waits until the site
  // index has produced the list refs so an early open can't cache an empty set.
  let loadController: AbortController | null = null
  onCleanup(() => loadController?.abort())

  createEffect(() => {
    // `loading` is untracked: the effect only guards on it, and tracking it
    // would schedule a pointless re-run when setLoading(true) fires below.
    if (!findPrintingsRequest() || loaded() || untrack(loading)) return
    const refs = props.lists()
    if (refs.length === 0) return
    setLoading(true)
    loadController = new AbortController()
    loadCombinedDetails(refs, loadController.signal)
      .then((result) => {
        loadController = null
        seedCards(mergeCardMaps(result))
        seedPrintings(mergePrintingMaps(result))
        setLoaded(result)
        setLoading(false)
      })
      .catch((e) => {
        setLoading(false)
        if ((e as Error).name !== 'AbortError') throw e
      })
  })

  const symbolMap = createMemo(() => mergeSymbolMaps(loaded() ?? []))

  // Rebuilt reactively so prices follow the currency selector and an
  // in-session "Update Prices" (sessionCacheVersion).
  const allCards = createMemo(() => {
    sessionCacheVersion()
    const l = loaded()
    if (!l) return []
    return buildCombinedCards(l, props.currency, props.useScryfallImgUrls)
  })

  const groups = createMemo<FindPrintingsGroup[]>(() => {
    const req = findPrintingsRequest()
    if (!req) return []
    return buildFindPrintingsGroups(allCards(), req.cardName, props.current())
  })

  const copyCount = createMemo(() => countFindPrintingsCopies(groups()))

  // Hover preview for the list view, rendered in the Modal's overlay slot so it
  // escapes the panel's overflow clipping (same pattern as SelectionModal).
  const { tooltip, tooltipPos, tooltipRef, setTooltip } = useTooltip()
  createEffect(() => {
    if (!findPrintingsRequest()) setTooltip(null)
  })

  const handlePick = (group: FindPrintingsGroup, copy: FindPrintingsCopy): void => {
    const tile = copy.tile
    requestCardNav({
      type: group.kind,
      slug: group.slug,
      cardId: tile.selectedTile.cardIds[0],
      name: tile.name,
    })
    closeFindPrintings()
    // Already viewing the list: the pending nav is consumed in place.
    if (!group.isCurrent) window.location.hash = listHref(group.kind, group.slug)
  }

  return (
    <Modal
      open={Boolean(findPrintingsRequest())}
      onClose={closeFindPrintings}
      size="xl"
      panelClass="find-printings-modal"
      aria-label={t('site.findPrintings.aria', {
        name: findPrintingsRequest()?.cardName ?? t('site.findPrintings.unknownCard'),
      })}
      overlay={
        <TooltipOverlay
          tooltip={tooltip()}
          pos={tooltipPos()}
          tooltipRef={tooltipRef}
          class="find-printings-tooltip"
        />
      }
    >
      <div class="find-printings-header">
        <div class="find-printings-heading">
          <span class="find-printings-title">{t('site.findPrintings.title')}</span>
          <span class="find-printings-card-name">{findPrintingsRequest()?.cardName}</span>
        </div>
        <button
          type="button"
          class="find-printings-close"
          aria-label={t('ui.dialog.close')}
          onClick={closeFindPrintings}
        >
          ×
        </button>
      </div>

      <div class="find-printings-controls">
        <span class="find-printings-summary" role="status">
          <Show when={!loading()} fallback={t('site.findPrintings.searching')}>
            {t('site.findPrintings.summary', {
              count: copyCount(),
              lists: t('ui.count.lists', { count: groups().length }),
            })}
          </Show>
        </span>
        <div class="view-toggle">
          <button
            type="button"
            classList={{ active: viewMode() === 'binder' }}
            onClick={() => setViewMode('binder')}
          >
            {t('site.findPrintings.viewBinder')}
          </button>
          <button
            type="button"
            classList={{ active: viewMode() === 'list' }}
            onClick={() => setViewMode('list')}
          >
            {t('site.findPrintings.viewList')}
          </button>
        </div>
      </div>

      <div
        class={`find-printings-results card-sections view-${viewMode()}`}
        style={`--card-width:${CARD_SIZE_WIDTHS.small}px`}
      >
        <Show
          when={groups().length > 0}
          fallback={
            <Show when={!loading()}>
              <div class="find-printings-empty">{t('site.findPrintings.empty')}</div>
            </Show>
          }
        >
          <For each={groups()}>
            {(group) => (
              <div class="find-printings-group">
                <div class="find-printings-group-header">
                  <span class="find-printings-group-kind" aria-hidden="true">
                    {LIST_TYPE_DISPLAY[group.kind].icon}
                  </span>
                  <span class="find-printings-group-name">
                    <Show when={group.isCurrent}>
                      <span class="find-printings-group-current">
                        {t('site.findPrintings.currentList')}{' '}
                      </span>
                    </Show>
                    {group.name}
                  </span>
                  <span class="find-printings-group-count">{group.copies.length}</span>
                </div>
                <div class="binder-grid">
                  <For each={group.copies}>
                    {(copy) => (
                      <CardItem
                        name={copy.tile.name}
                        quantity={1}
                        hideCount
                        card={copy.tile.card}
                        symbolMap={symbolMap()}
                        viewMode={viewMode()}
                        useScryfallImgUrls={props.useScryfallImgUrls}
                        onCardClick={() => handlePick(group, copy)}
                        onTooltipEnter={(src, sideways) => setTooltip({ src, sideways })}
                        onTooltipLeave={() => setTooltip(null)}
                        collectionFinish={copy.tile.selectedTile.finish}
                        collectionCondition={copy.tile.selectedTile.condition}
                        collectionLanguage={copy.tile.selectedTile.language}
                        collectionSetCN={
                          copy.tile.hasPrinting && copy.tile.selectedTile.set
                            ? `${copy.tile.selectedTile.set.toUpperCase()}:${copy.tile.selectedTile.collectorNumber}`
                            : undefined
                        }
                        collectionPrice={copy.tile.price}
                        currency={props.currency}
                        cardId={copy.tile.selectedTile.cardIds[0]}
                      />
                    )}
                  </For>
                </div>
              </div>
            )}
          </For>
        </Show>
      </div>
    </Modal>
  )
}
