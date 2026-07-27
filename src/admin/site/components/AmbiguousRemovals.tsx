import { type JSX, createMemo, For, Match, Show, Switch } from 'solid-js'
import type { CollectionSyncList } from '../../api/collection-sync'
import { describeAmbiguousRemoval, type AmbiguousRemoval } from '../../../collection-sync/describe'

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
      <h3 class="section-subheading">Removal priority</h3>
      <p class="sync-choice-desc">
        When a printing loses copies remotely but its local copies live in several lists, nothing
        says which one the card left. Name the lists that may give copies up, in order — the first
        is asked first, and only these lists are touched.{' '}
        <Show
          when={props.dryRun}
          fallback={
            <>
              Without one, a run that meets such a removal <strong>fails and writes nothing</strong>
              .
            </>
          }
        >
          A preview reports such a removal instead of failing; a real run without a priority{' '}
          <strong>fails and writes nothing</strong>.
        </Show>
      </p>

      <Show
        when={props.value.length > 0}
        fallback={
          <p class="sync-priority-empty">
            No priority set —{' '}
            {props.dryRun
              ? 'a preview will report an ambiguous removal instead of placing it.'
              : 'an ambiguous removal will stop the run before anything is written.'}
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
                  aria-label={`Remove ${labelOf(slug)} from the removal priority`}
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
          <p class="text-muted">No collection lists in scope — there is nothing to prioritize.</p>
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
  return (
    <div class="sync-ambiguous">
      <p class="sync-ambiguous-lead">
        {props.removals.length} removal{props.removals.length === 1 ? '' : 's'} could not be placed,
        so <strong>nothing was written</strong>. Set a removal priority above and run again, or keep
        a printing's copies in one list.
      </p>
      <ul class="sync-ambiguous-list">
        <For each={props.removals}>
          {(removal) => <li class="sync-ambiguous-item">{describeAmbiguousRemoval(removal)}</li>}
        </For>
      </ul>
    </div>
  )
}
