import { createSignal, type Accessor } from 'solid-js'
import { type ListRef, listRefLabel } from '../change-event'

/** One selectable destination in the move-target picker. */
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
 * with {@link listRefLabel}; picking one invokes `onPick` with that {@link ListRef}.
 */
export function promptListMove(targets: ListRef[], onPick: (dest: ListRef) => void): void {
  promptMoveTarget({
    title: 'Move to list',
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
    title: 'Move to section',
    options: [
      ...sections.map((section) => ({
        label: section,
        onSelect: () => onPick(section),
      })),
      { label: 'New section…', variant: 'create', onSelect: onNew },
    ],
  })
}
