import { type JSX, createMemo, For, Match, Show, Switch } from 'solid-js'
import type { CollectionSyncList } from '../../api/collection-sync'
import { describeAmbiguousRemoval, type AmbiguousRemoval } from '../../../collection-sync/describe'
import { useT, useTSegments } from '../../../ui/i18n'

/**
 * The Sync Collection page's two surfaces for the one thing a pull cannot work
 * out on its own: which binder a card physically left.
 *
 * A removal is ambiguous when only *some* of a printing's copies are gone and
 * those copies span several lists. {@link RemovalPriorityPicker} answers that
 * before the run — the browser's form of `--removal-priority`, since there is
 * nobody to prompt mid-run — and {@link AmbiguousRemovalsPanel} reports the
 * removals a run could not place, which is the run that wrote nothing at all.
 */

export type RemovalPriorityPickerProps = {
  /**
   * The lists the run could take copies from — the run's scope, not every
   * collection list: an ambiguity can only arise between lists being compared,
   * and a priority naming an out-of-scope list places nothing and fails the run.
   */
  lists: readonly CollectionSyncList[]
  /** The chosen lists, by slug, in priority order — the request's `removalPriority`. */
  value: readonly string[]
  onChange: (priority: string[]) => void
  /** Set while a run is in flight, when changing the answer would be a lie. */
  disabled: boolean
  /** Whether the run is a preview, which reports an ambiguity instead of failing on it. */
  dryRun: boolean
}

/**
 * An ordered picker: clicking a list appends it to the priority, and each chosen
 * list can be dropped again. Order is the whole content of a priority — the
 * first list named is the first asked for copies — so the chosen lists are shown
 * ranked rather than as a set of ticks.
 *
 * Lists are shown by heading with their slug beside it: the slug is what the
 * ambiguity messages name (`copies live in "long-box" (2)`), so the control that
 * answers them has to speak the same vocabulary.
 */
export function RemovalPriorityPicker(props: RemovalPriorityPickerProps): JSX.Element {
  const t = useT()
  const tSegments = useTSegments()
  /** The heading a list is displayed under, by slug; the slug when it has none. */
  const labels = createMemo(
    () => new Map(props.lists.map((list) => [list.slug, list.name] as const)),
  )
  const labelOf = (slug: string): string => labels().get(slug) ?? slug

  /** Lists not in the priority yet — a list may only give copies up once. */
  const remaining = createMemo((): CollectionSyncList[] =>
    props.lists.filter((list) => !props.value.includes(list.slug)),
  )

  const append = (slug: string): void => props.onChange([...props.value, slug])
  const drop = (slug: string): void =>
    props.onChange(props.value.filter((chosen) => chosen !== slug))

  return (
    <div class="sync-priority">
      <h3 class="section-subheading">{t('admin.priority.heading')}</h3>
      <p class="sync-choice-desc">
        {t('admin.priority.desc')}{' '}
        {/* The bolded consequence sits mid-sentence, so the follow-up renders as
            segments and only the emphasized parameter gets markup. */}
        <For
          each={tSegments(props.dryRun ? 'admin.priority.descPreview' : 'admin.priority.descRun', {
            emphasis: t('admin.priority.failsAndWritesNothing'),
          })}
        >
          {(segment) =>
            segment.kind === 'param' ? <strong>{segment.value}</strong> : segment.value
          }
        </For>
      </p>

      <Show
        when={props.value.length > 0}
        fallback={
          <p class="sync-priority-empty">
            {props.dryRun ? t('admin.priority.emptyPreview') : t('admin.priority.emptyRun')}
          </p>
        }
      >
        <ol class="sync-priority-chips">
          <For each={props.value}>
            {(slug, index) => (
              <li class="sync-priority-chip">
                <span class="sync-priority-rank">{index() + 1}</span>
                <span class="sync-priority-name">{labelOf(slug)}</span>
                {/* Only when it adds something: a list titled like its file
                    would otherwise show the same word twice. */}
                <Show when={labelOf(slug) !== slug}>
                  <span class="sync-priority-slug">{slug}</span>
                </Show>
                <button
                  type="button"
                  class="sync-priority-remove"
                  aria-label={t('admin.priority.remove', { name: labelOf(slug) })}
                  disabled={props.disabled}
                  onClick={() => drop(slug)}
                >
                  ×
                </button>
              </li>
            )}
          </For>
        </ol>
      </Show>

      {/* Three states: lists left to offer, no lists at all, and every list
          already ranked — the last one rendering nothing. */}
      <Switch>
        <Match when={remaining().length > 0}>
          <div class="sync-priority-options">
            <For each={remaining()}>
              {(list) => (
                <button
                  type="button"
                  class="sync-priority-option"
                  disabled={props.disabled}
                  onClick={() => append(list.slug)}
                >
                  + {list.name}
                  <Show when={list.name !== list.slug}>
                    <span class="sync-priority-slug">{list.slug}</span>
                  </Show>
                </button>
              )}
            </For>
          </div>
        </Match>
        <Match when={props.lists.length === 0}>
          <p class="text-muted">{t('admin.priority.noLists')}</p>
        </Match>
      </Switch>
    </div>
  )
}

export type AmbiguousRemovalsPanelProps = {
  removals: readonly AmbiguousRemoval[]
}

/**
 * The removals a finished run refused to place, worded exactly as the CLI words
 * them (same `describeAmbiguousRemoval`), with what to do about it. Shown only
 * when the run actually failed on them: a priority that placed them needs no
 * panel, and a preview says so in its own log.
 */
export function AmbiguousRemovalsPanel(props: AmbiguousRemovalsPanelProps): JSX.Element {
  const t = useT()
  const tSegments = useTSegments()
  return (
    <div class="sync-ambiguous">
      <p class="sync-ambiguous-lead">
        {/* The bolded clause sits mid-sentence, so the message is rendered as
            segments and the emphasized parameter is the one that gets markup —
            which leaves a translator free to move it. */}
        <For
          each={tSegments('admin.sync.ambiguousLead', {
            count: props.removals.length,
            emphasis: t('admin.sync.nothingWritten'),
          })}
        >
          {(segment) =>
            segment.kind === 'param' && segment.name === 'emphasis' ? (
              <strong>{segment.value}</strong>
            ) : (
              segment.value
            )
          }
        </For>
      </p>
      <ul class="sync-ambiguous-list">
        <For each={props.removals}>
          {(removal) => <li class="sync-ambiguous-item">{describeAmbiguousRemoval(removal)}</li>}
        </For>
      </ul>
    </div>
  )
}
