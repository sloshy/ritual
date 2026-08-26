import { type Component, For, Show, createMemo } from 'solid-js'
import { LIST_TYPE_DISPLAY } from '../../../list/list-type'
import type { ListInfo } from '../../../list/list-info'
import { type ListId, listInfoId, groupListsByType } from '../list-grouping'
import { useT, useTKey, useTSegments } from '../../../ui/i18n'

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
  const t = useT()
  const tKey = useTKey()
  const tSegments = useTSegments()
  const groups = createMemo(() => groupListsByType(props.lists))

  return (
    <div class="move-filters-body">
      <div class="move-filters-header">
        {/* Both emphasized words sit mid-sentence, so the message renders as
            segments and only the parameters get markup — a translator keeps
            control of where they go. */}
        <p class="form-hint">
          <For
            each={tSegments('admin.moveFilters.help', {
              from: t('admin.moveFilters.fromWord'),
              to: t('admin.moveFilters.toWord'),
            })}
          >
            {(segment) =>
              segment.kind === 'param' ? <strong>{segment.value}</strong> : segment.value
            }
          </For>
        </p>
        <div class="move-filters-bulk">
          <span class="move-filters-bulk-label">{t('admin.moveFilters.fromLabel')}</span>
          <button
            type="button"
            class="btn btn-secondary btn-xs"
            onClick={() => props.setAllSources(true)}
          >
            {t('admin.moveFilters.all')}
          </button>
          <button
            type="button"
            class="btn btn-secondary btn-xs"
            onClick={() => props.setAllSources(false)}
          >
            {t('admin.moveFilters.none')}
          </button>
          <span class="move-filters-bulk-label">{t('admin.moveFilters.toLabel')}</span>
          <button
            type="button"
            class="btn btn-secondary btn-xs"
            onClick={() => props.setAllDests(true)}
          >
            {t('admin.moveFilters.all')}
          </button>
          <button
            type="button"
            class="btn btn-secondary btn-xs"
            onClick={() => props.setAllDests(false)}
          >
            {t('admin.moveFilters.none')}
          </button>
        </div>
      </div>

      <div class="move-filters-grid" role="table">
        <div class="move-filters-row move-filters-row--head" role="row">
          <span class="move-filters-name" role="columnheader">
            {t('admin.moveFilters.colList')}
          </span>
          <span class="move-filters-col" role="columnheader">
            {t('admin.moveFilters.colFrom')}
          </span>
          <span class="move-filters-col" role="columnheader">
            {t('admin.moveFilters.colTo')}
          </span>
        </div>
        <For each={groups()}>
          {(group) => (
            <>
              <div class="move-filters-group-label">
                {LIST_TYPE_DISPLAY[group.type].icon} {tKey(group.labelKey)}
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
                          aria-label={t('admin.moveFilters.moveFrom', { name: list.name })}
                          checked={props.sourceEnabled(id)}
                          onChange={() => props.toggleSource(id)}
                        />
                      </span>
                      <span class="move-filters-col" role="cell">
                        <input
                          type="checkbox"
                          aria-label={t('admin.moveFilters.moveTo', { name: list.name })}
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
        <p class="text-muted">{t('admin.moveFilters.noLists')}</p>
      </Show>
    </div>
  )
}
