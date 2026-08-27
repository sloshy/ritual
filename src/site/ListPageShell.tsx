/**
 * The chrome half of the shared list-page frame: everything the deck, collection
 * and wanted-list pages draw identically around their own cards. What differs
 * arrives through the `JSX.Element` slots below.
 *
 * Deliberately not generic: it reads {@link ListPageChrome}, which has the
 * page's group-by union already erased, so its slots need no render callback.
 */
import { Show, type JSX } from 'solid-js'
import type { ChangelogPage } from '../changes/changelog-parser'
import type { ScryfallCard } from '../scryfall/types'
import { useT } from '../ui/i18n'
import { TooltipOverlay } from '../ui/TooltipOverlay'
import { ChangelogModal } from './ChangelogModal'
import { ExportMenu, type ExportFormat } from './ExportMenu'
import { ListPageStats, SellModeNotice } from './PageStats'
import { UpdatePricesButton } from './PriceControls'
import { PriceStalenessNotice } from './PriceStalenessNotice'
import { SelectionMenu } from './SelectionMenu'
import { TagFilterWarning } from './TagFilterWarning'
import { Toolbar, type ExtraToggle } from './Toolbar'
import type { ListPageCommonProps } from './list-page-props'
import type { ListPageChrome } from './useListPage'

/** The header's export menu: present exactly when the page offers exporting. */
export type ListPageExport = { serialize: (format: ExportFormat) => string }

/** The "View changes" button and its modal, grouped with the data it renders with. */
export type ListPageChangelog = {
  pages: ChangelogPage[]
  cards: Record<string, ScryfallCard | null>
  printings: Record<string, ScryfallCard[]>
}

/**
 * Correlated options are grouped, not left as independent optionals, so "export
 * is on but nothing serializes it" is unrepresentable rather than a `!`.
 *
 * Every `JSX.Element` slot below must be read at **exactly one** site in the
 * body: they arrive as prop getters, and reading one twice builds it twice.
 */
export type ListPageShellProps = Pick<
  ListPageCommonProps,
  | 'currency'
  | 'symbolMap'
  | 'useScryfallImgUrls'
  | 'enableTrade'
  | 'onCombine'
  | 'enablePriceRefresh'
> & {
  page: ListPageChrome
  /** The page heading, and the base name an export file takes. */
  title: string
  /** Wide layout (the editors, Move Cards) rather than the centered one. */
  fullWidth: boolean
  /** Figures rendered inside `.page-stats` before {@link ListPageStats}. */
  statsLead?: JSX.Element
  /** Extra header content under the sell-mode notice (a deck's source link). */
  headerExtra?: JSX.Element
  /** When provided, shows the export menu. */
  export?: ListPageExport
  /** When provided and non-empty, shows the "View changes" button and modal. */
  changelog?: ListPageChangelog
  /** Show the "Hide Extras" filter toggle (deck pages only). */
  showHideExtras?: boolean
  extraToggles?: ExtraToggle[]
  /** Content between the notices and the card grid: description, primer, banners. */
  beforeCards?: JSX.Element
  /** The card grid's contents. */
  sections: JSX.Element
  /** Modals and pickers rendered after the read-mode menu. */
  overlays?: JSX.Element
}

export function ListPageShell(props: ListPageShellProps): JSX.Element {
  const t = useT()
  const page = (): ListPageChrome => props.page
  const toolbar = (): ListPageChrome['toolbar'] => props.page.toolbar
  // An empty changelog reads exactly as a missing one: no button, no modal.
  const changelog = (): ListPageChangelog | undefined =>
    props.changelog && props.changelog.pages.length > 0 ? props.changelog : undefined

  return (
    <div class={props.fullWidth ? 'page-full-width' : 'page-container'}>
      {/* Header */}
      <div class="page-header">
        <div>
          <h1 class="page-title">{props.title}</h1>
          <p class="page-stats">
            {props.statsLead}
            <ListPageStats
              filters={page().filters}
              currency={props.currency}
              filteredAmount={page().filteredTotalPrice()}
              selectedCount={page().selection.count()}
              selectedAmount={page().selection.value(props.currency)}
              sellMode={page().sell.active()}
              buylistSummary={page().filteredSellSummary()}
              selectionSummary={page().sell.summary()}
            />
          </p>
          <SellModeNotice sellMode={page().sell.active()} />
          {props.headerExtra}
        </div>
        <Show when={props.onCombine || props.export || changelog() || props.enablePriceRefresh}>
          <div class="btn-group">
            <Show when={props.onCombine}>
              <button onClick={() => props.onCombine?.()} class="btn btn-secondary">
                {t('site.page.combineWithList')}
              </button>
            </Show>
            <Show when={changelog()}>
              <button
                onClick={() => page().setShowChangelog(true)}
                class="btn btn-secondary btn-view-changes"
              >
                {t('site.page.viewChanges')}
              </button>
            </Show>
            <Show when={props.export}>
              {(exportMenu) => (
                <ExportMenu
                  serialize={exportMenu().serialize}
                  name={props.title}
                  extraFormats={page().cartExportFormats()}
                />
              )}
            </Show>
            <Show when={props.enablePriceRefresh}>
              <UpdatePricesButton prices={page().prices} />
            </Show>
          </div>
        </Show>
      </div>

      {/* Toolbar */}
      <Toolbar
        viewMode={toolbar().viewMode()}
        onViewModeChange={toolbar().setViewMode}
        cardSize={toolbar().cardSize()}
        onCardSizeChange={toolbar().setCardSize}
        groupBy={toolbar().groupBy()}
        groupByOptions={toolbar().groupByOptions()}
        onGroupByChange={toolbar().setGroupBy}
        sortLayers={toolbar().sortLayers()}
        sortByOptions={toolbar().sortByOptions()}
        onSortLayersChange={toolbar().setSortLayers}
        priceGroupStrategy={toolbar().priceGroupStrategy()}
        onPriceGroupStrategyChange={toolbar().setPriceGroupStrategy}
        reverseGroups={toolbar().reverseGroups()}
        onReverseGroupsChange={() => toolbar().setReverseGroups((prev) => !prev)}
        sell={page().sell.control()}
        filters={page().filters}
        symbolMap={props.symbolMap}
        currency={props.currency}
        setCodeOptions={toolbar().setCodeOptions()}
        cardTypeOptions={toolbar().cardTypeOptions()}
        oracleTagOptions={toolbar().oracleTagOptions()}
        artTagOptions={toolbar().artTagOptions()}
        showHideExtras={props.showHideExtras}
        showLabelsFilter={toolbar().availableLabels.length > 0}
        availableLabels={toolbar().availableLabels}
        shareLists={toolbar().shareLists()}
        extraToggles={props.extraToggles}
        selectionMenu={
          <SelectionMenu
            selection={page().selection}
            currency={props.currency}
            enableTrade={props.enableTrade}
            useScryfallImgUrls={props.useScryfallImgUrls}
            editActions={page().editActions()}
            dockOnTouch
          />
        }
      />

      <Show when={props.enablePriceRefresh}>
        <PriceStalenessNotice outdatedNames={page().prices.outdatedNames()} />
      </Show>
      <TagFilterWarning untaggedCardNames={page().untaggedAddedNames()} />

      {props.beforeCards}

      {/* Card sections */}
      <div
        class={`card-sections view-${toolbar().viewMode()}`}
        style={`--card-width:${toolbar().cardWidth()}px`}
      >
        {props.sections}
      </div>

      {/* List-view hover tooltip */}
      <TooltipOverlay
        tooltip={page().tooltip.tooltip()}
        pos={page().tooltip.tooltipPos()}
        tooltipRef={page().tooltip.tooltipRef}
      />

      {/* Read-mode card ⋯ menu */}
      {page().readMenu.element()}

      {props.overlays}

      {/* Changelog modal */}
      <Show when={changelog()}>
        {(log) => (
          <ChangelogModal
            open={page().showChangelog()}
            changelog={log().pages}
            cards={log().cards}
            printings={log().printings}
            symbolMap={props.symbolMap}
            useScryfallImgUrls={props.useScryfallImgUrls}
            currency={props.currency}
            onClose={() => page().setShowChangelog(false)}
          />
        )}
      </Show>
    </div>
  )
}
