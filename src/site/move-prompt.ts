import { createSignal, type Accessor } from 'solid-js'
import { type ListRef, listRefLabel } from '../changes/change-event'
import { t } from '../i18n/t'

/**
 * One selectable destination in the move-target picker.
 *
 * `title` and `label` are rendered text rather than message keys because a
 * prompt is built from live data — list names, section names — that has no key
 * to hold. They are resolved with the non-reactive module-level `t` at the
 * moment the picker opens, which is sound here: the picker is short-lived and
 * modal, so there is no window in which a locale switch could leave it stale.
 */
export interface MoveTargetOption {
  /** Display label for the option button. */
  label: string
  /** Apply this destination. The picker closes itself before invoking. */
  onSelect: () => void
  /**
   * Visual hint. `create` renders the "New section…" affordance distinctly from
   * concrete destinations.
   */
  variant?: 'create'
}

/** A pending move-target choice: a titled list of destinations awaiting a pick. */
export interface MoveTargetPrompt {
  title: string
  options: MoveTargetOption[]
}

const [pending, setPending] = createSignal<MoveTargetPrompt | null>(null)

/** The move-target choice currently awaiting the user, or null. */
export const pendingMovePrompt: Accessor<MoveTargetPrompt | null> = pending

/**
 * Open the shared move-target picker. The menus that used to list one entry per
 * destination now show a single "Move to…" item that opens this picker. Replaces
 * any prompt already open.
 */
export function promptMoveTarget(prompt: MoveTargetPrompt): void {
  setPending(prompt)
}

/** Dismiss the move-target picker without choosing. */
export function closeMovePrompt(): void {
  setPending(null)
}

/**
 * Open the picker to move card(s) into another list. Destinations are labelled
 * with {@link listRefLabel}; picking one invokes `onPick` with the exact target
 * object that was passed in (generic, so slug-bearing refs survive the round trip).
 */
export function promptListMove<T extends ListRef>(targets: T[], onPick: (dest: T) => void): void {
  promptMoveTarget({
    title: t('site.move.toListTitle'),
    options: targets.map((dest) => ({
      label: listRefLabel(dest),
      onSelect: () => onPick(dest),
    })),
  })
}

/**
 * Open the picker to move card(s) into another section of the current list. Lists
 * the given section names plus a trailing "New section…" entry that invokes `onNew`.
 */
export function promptSectionMove(
  sections: string[],
  onPick: (section: string) => void,
  onNew: () => void,
): void {
  promptMoveTarget({
    title: t('site.move.toSectionTitle'),
    options: [
      ...sections.map((section) => ({
        label: section,
        onSelect: () => onPick(section),
      })),
      { label: t('site.move.newSection'), variant: 'create', onSelect: onNew },
    ],
  })
}
