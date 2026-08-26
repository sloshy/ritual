import { Show, type Accessor, type Component } from 'solid-js'
import { useT } from '../../../ui/i18n'
import { ListScopePicker } from '../../../list-view/ListScopePicker'
import type { ListRefKey, NamedListRef } from '../../../list-view/combined-list'

export type SourcesStepProps = {
  /** Every list that may be a source (the edited list already removed). */
  lists: Accessor<NamedListRef[]>
  excluded: Accessor<Set<ListRefKey>>
  setExcluded: (update: (prev: Set<ListRefKey>) => Set<ListRefKey>) => void
  enabledCount: Accessor<number>
}

/** Step 2: which other lists may supply replacement printings. */
export const SourcesStep: Component<SourcesStepProps> = (props) => {
  const t = useT()
  return (
    <div class="swap-wizard-step-body">
      <div class="swap-wizard-step-head">
        <h4 class="swap-wizard-heading">{t('ui.swap.sources.heading')}</h4>
        <span class="swap-wizard-muted" role="status">
          {t('ui.swap.sources.selectedCount', { count: props.enabledCount() })}
        </span>
      </div>
      <Show
        when={props.lists().length > 0}
        fallback={<div class="empty-state">{t('ui.swap.sources.none')}</div>}
      >
        <ListScopePicker
          lists={props.lists}
          excluded={props.excluded}
          setExcluded={props.setExcluded}
          label={t('ui.swap.sources.label')}
        />
        <p class="swap-wizard-note">{t('ui.swap.sources.note')}</p>
      </Show>
    </div>
  )
}
