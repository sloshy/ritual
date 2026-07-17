import { type Component, For, Show, createMemo } from 'solid-js'
import { LIST_TYPE_DISPLAY } from '../../../list-type'
import type { ListInfo } from '../../../list-info'
import { type ListId, listInfoId, groupListsByType } from '../list-grouping'

interface MoveFiltersPanelProps {
  lists: ListInfo[]
  sourceEnabled: (id: ListId) => boolean
  destEnabled: (id: ListId) => boolean
  toggleSource: (id: ListId) => void
  toggleDest: (id: ListId) => void
  setAllSources: (on: boolean) => void
  setAllDests: (on: boolean) => void
}

/**
 * Session filters for the move page: per-list checkboxes controlling which lists
 * are searched/browsed as sources ("From") and offered as destinations ("To").
 * Mirrors the editor's expandable add-card-defaults panel placement.
 */
export const MoveFiltersPanel: Component<MoveFiltersPanelProps> = (props) => {
  const groups = createMemo(() => groupListsByType(props.lists))

  return (
    <div class="move-filters-body">
      <div class="move-filters-header">
        <p class="form-hint">
          Choose which lists you can move cards <strong>from</strong> (browsed and searched) and{' '}
          <strong>to</strong> (offered as destinations).
        </p>
        <div class="move-filters-bulk">
          <span class="move-filters-bulk-label">From:</span>
          <button
            type="button"
            class="btn btn-secondary btn-xs"
            onClick={() => props.setAllSources(true)}
          >
            All
          </button>
          <button
            type="button"
            class="btn btn-secondary btn-xs"
            onClick={() => props.setAllSources(false)}
          >
            None
          </button>
          <span class="move-filters-bulk-label">To:</span>
          <button
            type="button"
            class="btn btn-secondary btn-xs"
            onClick={() => props.setAllDests(true)}
          >
            All
          </button>
          <button
            type="button"
            class="btn btn-secondary btn-xs"
            onClick={() => props.setAllDests(false)}
          >
            None
          </button>
        </div>
      </div>

      <div class="move-filters-grid" role="table">
        <div class="move-filters-row move-filters-row--head" role="row">
          <span class="move-filters-name" role="columnheader">
            List
          </span>
          <span class="move-filters-col" role="columnheader">
            From
          </span>
          <span class="move-filters-col" role="columnheader">
            To
          </span>
        </div>
        <For each={groups()}>
          {(group) => (
            <>
              <div class="move-filters-group-label">
                {LIST_TYPE_DISPLAY[group.type].icon} {group.label}
              </div>
              <For each={group.lists}>
                {(list) => {
                  const id = listInfoId(list)
                  return (
                    <div class="move-filters-row" role="row">
                      <span class="move-filters-name" role="cell">
                        {list.name}
                      </span>
                      <span class="move-filters-col" role="cell">
                        <input
                          type="checkbox"
                          aria-label={`Move from ${list.name}`}
                          checked={props.sourceEnabled(id)}
                          onChange={() => props.toggleSource(id)}
                        />
                      </span>
                      <span class="move-filters-col" role="cell">
                        <input
                          type="checkbox"
                          aria-label={`Move to ${list.name}`}
                          checked={props.destEnabled(id)}
                          onChange={() => props.toggleDest(id)}
                        />
                      </span>
                    </div>
                  )
                }}
              </For>
            </>
          )}
        </For>
      </div>

      <Show when={props.lists.length === 0}>
        <p class="text-muted">No lists found.</p>
      </Show>
    </div>
  )
}
