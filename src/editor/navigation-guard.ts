import { createContext, useContext } from 'solid-js'

/**
 * A guard the active editor installs so navigation can confirm discarding unsaved
 * changes. `onCancel` runs when the user declines, which lets a caller undo a
 * navigation that already happened — the admin router uses it to put the URL
 * back after a refused Back/Forward.
 */
export type NavigationAttempt = (proceed: () => void, onCancel?: () => void) => void

/** What the active editor registers with the guard. */
export type NavigationGuardEntry = {
  /** Run `proceed`, confirming discard first when the editor has unsaved changes. */
  attempt: NavigationAttempt
  /** Whether the editor currently has unsaved changes. */
  isDirty: () => boolean
}

export type NavigationGuardController = {
  /**
   * Run `proceed`, first routing through the active editor's guard so it can
   * confirm discarding unsaved changes. With no editor mounted (or no unsaved
   * changes) `proceed` runs immediately.
   */
  attempt: NavigationAttempt
  /** Whether the active editor (if any) has unsaved changes. */
  isDirty: () => boolean
  /**
   * Install the active editor's guard. Returns a cleanup that removes it, but
   * only if it is still the installed guard — so out-of-order mount/cleanup
   * during a tab swap leaves the newly mounted editor's guard in place.
   */
  register: (entry: NavigationGuardEntry) => () => void
}

const passthrough: NavigationGuardController = {
  attempt: (proceed) => proceed(),
  isDirty: () => false,
  register: () => () => {},
}

const NavigationGuardContext = createContext<NavigationGuardController>(passthrough)

export const NavigationGuardProvider = NavigationGuardContext

export const useNavigationGuard = (): NavigationGuardController =>
  useContext(NavigationGuardContext)

/**
 * Create the shared controller; one instance lives at the app root.
 *
 * The installed entry is a plain variable, not a signal: it is only ever read
 * imperatively (a navigation attempt, the unload prompt), and an editor
 * installs it while it mounts, where a reactive write is not allowed.
 */
export function createNavigationGuard(): NavigationGuardController {
  let entry: NavigationGuardEntry | null = null
  return {
    attempt: (proceed, onCancel) => {
      if (entry) entry.attempt(proceed, onCancel)
      else proceed()
    },
    isDirty: () => entry?.isDirty() ?? false,
    register: (e) => {
      entry = e
      return () => {
        if (entry === e) entry = null
      }
    },
  }
}
