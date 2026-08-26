import type { Accessor, Component } from 'solid-js'
import { createMemo, createSignal, For, Show } from 'solid-js'
import { useT } from '../ui/i18n'
import { LIST_TYPES, LIST_TYPE_DISPLAY, listTypeTitle, type ListType } from '../list/list-type'
import { indeterminateRef } from '../ui/indeterminate'
import type { SelectionState } from './useCardSelection'
import { listRefKey, type ListRefKey, type NamedListRef } from './combined-list'
import {
  enabledScopeRefs,
  refsOfType,
  toggleListExclusion,
  toggleTypeExclusion,
  typeScopeState,
} from './find-scope'

export type ListScopePickerProps = {
  /** Every list on offer, in canonical deck → collection → wanted order. */
  lists: Accessor<NamedListRef[]>
  /** The exclusion set (see `find-scope.ts`): a list is in scope unless its key is here. */
  excluded: Accessor<Set<ListRefKey>>
  setExcluded: (update: (prev: Set<ListRefKey>) => Set<ListRefKey>) => void
  /** Leading caption, e.g. "Search in:". */
  label?: string
}

/**
 * The list-scope control shared by the Find page and the Swap Printings
 * wizard: one group per list type with a tri-state checkbox, expandable to
 * per-list checkboxes. State is the caller's exclusion set, so every list —
 * including one that appears later — is in scope by default unless the caller
 * seeded the set otherwise.
 */
export const ListScopePicker: Component<ListScopePickerProps> = (props) => {
  const t = useT()
  const [expandedTypes, setExpandedTypes] = createSignal<Set<ListType>>(new Set<ListType>())

  return (
    <div class="find-scope">
      <Show when={props.label}>{(label) => <span class="find-scope-label">{label()}</span>}</Show>
      <For each={LIST_TYPES}>
        {(type) => {
          const ofType = createMemo<NamedListRef[]>(() => refsOfType(props.lists(), type))
          const state = createMemo<SelectionState>(() =>
            typeScopeState(props.excluded(), props.lists(), type),
          )
          const enabledCount = createMemo<number>(
            () => enabledScopeRefs(props.excluded(), ofType()).length,
          )
          const isOpen = (): boolean => expandedTypes().has(type)
          const toggleOpen = (): void => {
            setExpandedTypes((prev) => {
              const next = new Set(prev)
              if (next.has(type)) next.delete(type)
              else next.add(type)
              return next
            })
          }
          return (
            <Show when={ofType().length > 0}>
              <div class="find-scope-group">
                <div class="find-scope-head">
                  <label class="find-scope-type">
                    <input
                      type="checkbox"
                      checked={state() === 'all'}
                      ref={indeterminateRef(() => state() === 'partial')}
                      onChange={() => {
                        const refs = props.lists()
                        props.setExcluded((prev) => toggleTypeExclusion(prev, refs, type))
                      }}
                    />
                    <span aria-hidden="true">{LIST_TYPE_DISPLAY[type].icon}</span>
                    <span>{listTypeTitle(type)}</span>
                    <span class="find-scope-count">
                      {t('site.find.scopeCount', {
                        enabled: enabledCount(),
                        total: ofType().length,
                      })}
                    </span>
                  </label>
                  <button
                    type="button"
                    class="find-scope-expand"
                    aria-expanded={isOpen()}
                    aria-label={t('site.find.scopeExpandAria', { type: listTypeTitle(type) })}
                    onClick={toggleOpen}
                  >
                    {isOpen() ? '▾' : '▸'}
                  </button>
                </div>
                <Show when={isOpen()}>
                  <div class="find-scope-lists">
                    <For each={ofType()}>
                      {(ref) => (
                        <label class="find-scope-list">
                          <input
                            type="checkbox"
                            checked={!props.excluded().has(listRefKey(ref))}
                            onChange={() =>
                              props.setExcluded((prev) => toggleListExclusion(prev, ref))
                            }
                          />
                          <span>{ref.name}</span>
                        </label>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </Show>
          )
        }}
      </For>
    </div>
  )
}
