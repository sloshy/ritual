/**
 * The once-a-day rule for the pre-command migration prompt: after Ritual has
 * asked about a workspace, further commands there only print the one-line
 * notice until a day has passed. Pure — the times live in the user state file
 * (`src/util/user-state.ts`), keyed by the workspace's resolved base dir.
 */

import type { MigratePromptTimes } from '../util/user-state'

/** How long one prompt silences the next: a day. */
export const MIGRATE_PROMPT_SNOOZE_MS = 24 * 60 * 60 * 1000

/**
 * Whether the prompt asked about `baseDir` less than a day before `now`. A
 * time in the future (a clock that moved backwards) does not snooze, so a
 * skewed clock can never silence the prompt for good.
 */
export function isMigratePromptSnoozed(
  times: MigratePromptTimes,
  baseDir: string,
  now: number,
): boolean {
  const last = times[baseDir]
  if (last === undefined) return false
  const elapsed = now - last
  return elapsed >= 0 && elapsed < MIGRATE_PROMPT_SNOOZE_MS
}

/**
 * The times after asking about `baseDir` at `now`. Entries whose snooze has
 * lapsed are dropped, so the section only ever holds the workspaces asked
 * about in the last day.
 */
export function recordMigratePrompt(
  times: MigratePromptTimes,
  baseDir: string,
  now: number,
): MigratePromptTimes {
  const kept: MigratePromptTimes = {}
  for (const [dir, time] of Object.entries(times)) {
    if (isMigratePromptSnoozed(times, dir, now)) kept[dir] = time
  }
  kept[baseDir] = now
  return kept
}
