/**
 * The CLI's {@link RefreshPolicy}: `--refresh ask` questions go to the terminal
 * through `ask()`, and decline — never throw — when prompts are unavailable,
 * so a headless run can neither hang on a courtesy offer nor be surprised by
 * a multi-MB download.
 */
import type { RefreshMode, RefreshPolicy } from '../cache/refresh'
import { promptsUnavailable } from '../util/no-input'
import { ask } from './prompts'

export function cliRefreshPolicy(mode: RefreshMode): RefreshPolicy {
  return {
    mode,
    confirm: async ({ message, initial }) => {
      if (promptsUnavailable()) return false
      return (await ask<boolean>({ type: 'confirm', message, initial })) === true
    },
  }
}
