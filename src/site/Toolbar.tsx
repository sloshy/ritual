import type { FunctionalComponent } from 'preact'
import type { ViewMode, CardSize, SortBy, PriceGroupStrategy } from './card-sorting'
import { capitalize } from './utils'

type SelectOption = { value: string; label: string }

type ExtraCheckbox = {
  label: string
  checked: boolean
  onChange: () => void
}

interface ToolbarProps {
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  cardSize: CardSize
  onCardSizeChange: (size: CardSize) => void
  groupBy: string
  groupByOptions: SelectOption[]
  onGroupByChange: (value: string) => void
  sortBy: SortBy
  sortByOptions: SelectOption[]
  onSortByChange: (value: SortBy) => void
  priceGroupStrategy: PriceGroupStrategy
  onPriceGroupStrategyChange: (value: PriceGroupStrategy) => void
  reverse: boolean
  onReverseChange: () => void
  hideLands: boolean
  onHideLandsChange: () => void
  extraCheckboxes?: ExtraCheckbox[]
}

const VIEW_MODE_ICONS: Record<ViewMode, string> = {
  binder: '▦',
  list: '☰',
  overlap: '⧗',
  stack: '▥',
}

const CARD_SIZE_LABELS: Record<CardSize, string> = {
  large: 'L',
  medium: 'M',
  small: 'S',
}

export const Toolbar: FunctionalComponent<ToolbarProps> = ({
  viewMode,
  onViewModeChange,
  cardSize,
  onCardSizeChange,
  groupBy,
  groupByOptions,
  onGroupByChange,
  sortBy,
  sortByOptions,
  onSortByChange,
  priceGroupStrategy,
  onPriceGroupStrategyChange,
  reverse,
  onReverseChange,
  hideLands,
  onHideLandsChange,
  extraCheckboxes,
}) => {
  return (
    <div className="mb-4 flex flex-wrap gap-3 items-center text-xs">
      <div className="view-toggle">
        {(['binder', 'list', 'overlap', 'stack'] as ViewMode[]).map((mode) => (
          <button
            key={mode}
            data-view={mode}
            className={viewMode === mode ? 'active' : ''}
            title={`${capitalize(mode)} View`}
            onClick={() => onViewModeChange(mode)}
          >
            {VIEW_MODE_ICONS[mode]}
          </button>
        ))}
      </div>
      {viewMode !== 'list' && (
        <div className="view-toggle">
          {(['large', 'medium', 'small'] as CardSize[]).map((size) => (
            <button
              key={size}
              className={cardSize === size ? 'active' : ''}
              title={`${capitalize(size)} cards`}
              onClick={() => onCardSizeChange(size)}
            >
              {CARD_SIZE_LABELS[size]}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <label className="text-gray-500">Group:</label>
        <select
          className="bg-gray-800 text-gray-200 rounded px-2 py-1 border border-gray-700 focus:border-blue-500 outline-none"
          value={groupBy}
          onChange={(e) => onGroupByChange((e.target as HTMLSelectElement).value)}
        >
          {groupByOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      {groupBy === 'price' && (
        <div className="flex items-center gap-1.5">
          <label className="text-gray-500">Brackets:</label>
          <select
            className="bg-gray-800 text-gray-200 rounded px-2 py-1 border border-gray-700 focus:border-blue-500 outline-none"
            value={priceGroupStrategy}
            onChange={(e) =>
              onPriceGroupStrategyChange(
                (e.target as HTMLSelectElement).value as PriceGroupStrategy,
              )
            }
          >
            <option value="archidekt">Archidekt</option>
            <option value="five">Every $5</option>
            <option value="ten">Every $10</option>
          </select>
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <label className="text-gray-500">Sort:</label>
        <select
          className="bg-gray-800 text-gray-200 rounded px-2 py-1 border border-gray-700 focus:border-blue-500 outline-none"
          value={sortBy}
          onChange={(e) => onSortByChange((e.target as HTMLSelectElement).value as SortBy)}
        >
          {sortByOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      <label className="flex items-center gap-1 text-gray-400 cursor-pointer select-none">
        <input type="checkbox" className="rounded" checked={reverse} onChange={onReverseChange} />
        Reverse
      </label>
      <label className="flex items-center gap-1 text-gray-400 cursor-pointer select-none">
        <input
          type="checkbox"
          className="rounded"
          checked={hideLands}
          onChange={onHideLandsChange}
        />
        Hide Lands
      </label>
      {extraCheckboxes?.map((cb) => (
        <label
          key={cb.label}
          className="flex items-center gap-1 text-gray-400 cursor-pointer select-none"
        >
          <input type="checkbox" className="rounded" checked={cb.checked} onChange={cb.onChange} />
          {cb.label}
        </label>
      ))}
    </div>
  )
}
