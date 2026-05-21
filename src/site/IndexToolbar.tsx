import type { Component } from 'solid-js'
import { For, Show } from 'solid-js'
import { useStuck } from './useStuck'
import {
  INDEX_GROUP_OPTIONS,
  parseIndexGroup,
  parseIndexSort,
  type IndexGroup,
  type IndexSort,
  type IndexSortOption,
} from './index-filter'

export interface IndexToolbarProps {
  sort: IndexSort
  onSortChange: (sort: IndexSort) => void
  /** The sort options offered on this tab (decks include "Lowest price"; lists don't). */
  sortOptions: IndexSortOption[]
  reverse: boolean
  onReverseToggle: () => void
  /**
   * Grouping is only offered when both `group` and `onGroupChange` are provided
   * (the decks tab). Collection and wanted-list tabs omit them, and the Group
   * selector is left out of the toolbar entirely.
   */
  group?: IndexGroup
  onGroupChange?: (group: IndexGroup) => void
}

export const IndexToolbar: Component<IndexToolbarProps> = (props) => {
  const { stuck, sentinelRef } = useStuck()
  return (
    <>
      <div ref={sentinelRef} aria-hidden="true" class="toolbar-sentinel" />
      <div class="toolbar" classList={{ 'is-stuck': stuck() }}>
        <Show when={props.onGroupChange}>
          {(onGroupChange) => (
            <div class="toolbar-group">
              <label class="toolbar-label">Group:</label>
              <select
                class="toolbar-select"
                value={props.group ?? 'none'}
                onChange={(e) => onGroupChange()(parseIndexGroup(e.currentTarget.value))}
              >
                <For each={INDEX_GROUP_OPTIONS}>
                  {(opt) => <option value={opt.value}>{opt.label}</option>}
                </For>
              </select>
            </div>
          )}
        </Show>
        <div class="toolbar-group">
          <label class="toolbar-label">Sort:</label>
          <select
            class="toolbar-select"
            value={props.sort}
            onChange={(e) =>
              props.onSortChange(parseIndexSort(e.currentTarget.value, props.sortOptions))
            }
          >
            <For each={props.sortOptions}>
              {(opt) => <option value={opt.value}>{opt.label}</option>}
            </For>
          </select>
        </div>
        <button
          type="button"
          class="toolbar-toggle"
          classList={{ active: props.reverse }}
          aria-pressed={props.reverse}
          onClick={props.onReverseToggle}
        >
          <span aria-hidden="true">↑↓</span> Reverse
        </button>
      </div>
    </>
  )
}
