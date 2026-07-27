import { type JSX, For } from 'solid-js'
import type { SyncChangeFilter } from '../../../sync-common'

/**
 * The controls both sync pages are built from.
 *
 * Sync Decks and Sync Collection ask the same questions — which way, which
 * changes, over what — and a run means the same thing on either page, so the
 * choices live here rather than being written twice with wording that could
 * drift.
 */

/** One option of a {@link ChoicePicker}: what it is called and what picking it does. */
export type SyncChoice<T extends string> = {
  id: T
  label: string
  description: string
}

type ChoicePickerProps<T extends string> = {
  /** The control's heading, e.g. `Direction`. */
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

/**
 * A segmented choice with the selected option's explanation under it. The whole
 * control is wrapped so a page can address one of them (`.sync-change-filter
 * .sync-choice-desc`) rather than every description on the page.
 */
export function ChoicePicker<T extends string>(props: ChoicePickerProps<T>): JSX.Element {
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
              {option.label}
            </button>
          )}
        </For>
      </div>
      <p class="sync-choice-desc">{selected()?.description}</p>
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
  {
    id: 'all',
    label: 'All changes',
    description: 'Apply every difference: cards added, cards removed, and quantity changes.',
  },
  {
    id: 'additions',
    label: 'Additions only',
    description:
      'Only add cards. New cards and quantity increases are applied to the destination (your list files on a pull, Archidekt on a push); removals and decreases are reported but skipped.',
  },
  {
    id: 'removals',
    label: 'Removals only',
    description:
      'Only take cards away. Removals and quantity decreases are applied to the destination; new cards and increases are reported but skipped.',
  },
]

type ChangeFilterPickerProps = {
  value: ChangeFilterChoice
  onSelect: (choice: ChangeFilterChoice) => void
  disabled: boolean
}

/** The page's form of the CLI's `--only <additions|removals>`. */
export function ChangeFilterPicker(props: ChangeFilterPickerProps): JSX.Element {
  return (
    <ChoicePicker
      heading="Changes"
      label="Changes to apply"
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
