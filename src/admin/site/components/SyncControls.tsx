import { type JSX, For } from 'solid-js'
import { useT, useTKey } from '../../../ui/i18n'
import type { SyncChangeFilter } from '../../../sync-common'
import type { ParameterlessKey } from '../../../i18n/t'

/**
 * The controls both sync pages are built from.
 *
 * Sync Decks and Sync Collection ask the same questions — which way, which
 * changes, over what — and a run means the same thing on either page, so the
 * choices live here rather than being written twice with wording that could
 * drift.
 */

/**
 * One option of a {@link ChoicePicker}: what it is called and what picking it
 * does. Both are {@link MessageKey}s rather than text — the option tables are
 * built once at module load, so rendered strings would leave every choice in the
 * boot-time language after a locale switch. `id` is the persisted/URL value and
 * never moves.
 */
export type SyncChoice<T extends string> = {
  id: T
  labelKey: ParameterlessKey
  descriptionKey: ParameterlessKey
}

type ChoicePickerProps<T extends string> = {
  /** The control's heading, e.g. "Direction", already rendered. */
  heading: string
  /** The group's accessible name, which says what is being chosen. */
  label: string
  options: readonly SyncChoice<T>[]
  value: T
  onSelect: (id: T) => void
  /** Set while a run is in flight, when changing the answer would be a lie. */
  disabled: boolean
  /** Distinguishes this control from the page's others, for styling and tests. */
  class: string
}

type SyncToggleProps = {
  /** The label beside the box, as a key so a locale switch re-renders it. */
  labelKey: ParameterlessKey
  value: boolean
  onChange: (next: boolean) => void
  /** Set while a run is in flight, when changing the answer would be a lie. */
  disabled: boolean
  /** Distinguishes this toggle from the page's others, for styling and tests. */
  class: string
}

/**
 * One boolean option row of a sync page — dry run, printing sync. The shared
 * `.sync-toggle` class carries the layout; the per-instance class is the
 * page's handle on this particular row.
 */
export function SyncToggle(props: SyncToggleProps): JSX.Element {
  const tKey = useTKey()
  return (
    <label class={`sync-toggle ${props.class}`}>
      <input
        type="checkbox"
        checked={props.value}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.currentTarget.checked)}
      />
      {tKey(props.labelKey)}
    </label>
  )
}

/**
 * A segmented choice with the selected option's explanation under it. The whole
 * control is wrapped so a page can address one of them (`.sync-change-filter
 * .sync-choice-desc`) rather than every description on the page.
 */
export function ChoicePicker<T extends string>(props: ChoicePickerProps<T>): JSX.Element {
  const tKey = useTKey()
  const selected = (): SyncChoice<T> | undefined =>
    props.options.find((option) => option.id === props.value)

  return (
    <div class={`sync-choice ${props.class}`}>
      <h3 class="section-subheading">{props.heading}</h3>
      <div class="segmented" role="group" aria-label={props.label}>
        <For each={props.options}>
          {(option) => (
            <button
              type="button"
              class="segmented-option"
              data-active={props.value === option.id ? 'true' : undefined}
              aria-pressed={props.value === option.id}
              disabled={props.disabled}
              onClick={() => props.onSelect(option.id)}
            >
              {tKey(option.labelKey)}
            </button>
          )}
        </For>
      </div>
      <p class="sync-choice-desc">
        {(() => {
          const choice = selected()
          return choice ? tKey(choice.descriptionKey) : ''
        })()}
      </p>
    </div>
  )
}

/**
 * The change filter's choices. `all` is the UI's name for "no filter" — the
 * request field is simply omitted for it, matching a CLI run without `--only`.
 */
export type ChangeFilterChoice = SyncChangeFilter | 'all'

/**
 * Descriptions are written destination-relative, the way the filter itself is
 * defined, so they hold for either page: the destination is your list files on a
 * pull and Archidekt on a push.
 */
const CHANGE_FILTERS: SyncChoice<ChangeFilterChoice>[] = [
  { id: 'all', labelKey: 'admin.sync.filterAll', descriptionKey: 'admin.sync.filterAllDesc' },
  {
    id: 'additions',
    labelKey: 'admin.sync.filterAdditions',
    descriptionKey: 'admin.sync.filterAdditionsDesc',
  },
  {
    id: 'removals',
    labelKey: 'admin.sync.filterRemovals',
    descriptionKey: 'admin.sync.filterRemovalsDesc',
  },
]

type ChangeFilterPickerProps = {
  value: ChangeFilterChoice
  onSelect: (choice: ChangeFilterChoice) => void
  disabled: boolean
}

/** The page's form of the CLI's `--only <additions|removals>`. */
export function ChangeFilterPicker(props: ChangeFilterPickerProps): JSX.Element {
  const t = useT()
  return (
    <ChoicePicker
      heading={t('admin.sync.filterHeading')}
      label={t('admin.sync.filterLabel')}
      class="sync-change-filter"
      options={CHANGE_FILTERS}
      value={props.value}
      onSelect={props.onSelect}
      disabled={props.disabled}
    />
  )
}

/** The `only` field as the API takes it: omitted when every change applies. */
export function changeFilterParam(choice: ChangeFilterChoice): SyncChangeFilter | undefined {
  return choice === 'all' ? undefined : choice
}
