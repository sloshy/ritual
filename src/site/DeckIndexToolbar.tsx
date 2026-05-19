import type { Component } from 'solid-js'
import { For } from 'solid-js'
import { useStuck } from './useStuck'
import {
  DECK_INDEX_GROUP_OPTIONS,
  DECK_INDEX_SORT_OPTIONS,
  parseDeckIndexGroup,
  parseDeckIndexSort,
  type DeckIndexGroup,
  type DeckIndexSort,
} from './deck-index-filter'

export interface DeckIndexToolbarProps {
  sort: DeckIndexSort
  onSortChange: (sort: DeckIndexSort) => void
  group: DeckIndexGroup
  onGroupChange: (group: DeckIndexGroup) => void
  reverse: boolean
  onReverseToggle: () => void
}

export const DeckIndexToolbar: Component<DeckIndexToolbarProps> = (props) => {
  const { stuck, sentinelRef } = useStuck()
  return (
    <>
      <div ref={sentinelRef} aria-hidden="true" class="toolbar-sentinel" />
      <div class="toolbar" classList={{ 'is-stuck': stuck() }}>
        <div class="toolbar-group">
          <label class="toolbar-label">Group:</label>
          <select
            class="toolbar-select"
            value={props.group}
            onChange={(e) => props.onGroupChange(parseDeckIndexGroup(e.currentTarget.value))}
          >
            <For each={DECK_INDEX_GROUP_OPTIONS}>
              {(opt) => <option value={opt.value}>{opt.label}</option>}
            </For>
          </select>
        </div>
        <div class="toolbar-group">
          <label class="toolbar-label">Sort:</label>
          <select
            class="toolbar-select"
            value={props.sort}
            onChange={(e) => props.onSortChange(parseDeckIndexSort(e.currentTarget.value))}
          >
            <For each={DECK_INDEX_SORT_OPTIONS}>
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
