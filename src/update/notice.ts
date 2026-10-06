/**
 * The update-available notice's rules: when the cached releases lookup is due
 * for a refresh, what a lookup's outcome does to the cache, and which version
 * — if any — the notice announces. Pure apart from {@link lookupLatestVersion};
 * the cache itself lives in the user state file's
 * `updateCheck` section (`src/util/user-state.ts`), and the command hook that
 * drives all of this is `src/commands/update-notice.ts`.
 *
 * The cache is the single source of truth: whether a notice shows is decided
 * from it, never from how quickly the network answered.
 */

import { compareVersions, type UpdateChannel } from '../config/semver'
import { isWithinWindow } from '../util/time-window'
import type { UpdateCheckState } from '../util/user-state'
import type { ReleaseApiEnv } from './env'
import { fetchRelease } from './release'

const HOUR_MS = 60 * 60 * 1000

/** How long a successful lookup stays fresh. */
export const UPDATE_CHECK_INTERVAL_MS = 24 * HOUR_MS

/** How long a failed lookup waits before the next attempt. */
export const UPDATE_CHECK_RETRY_MS = HOUR_MS

/**
 * How long a lookup abandoned unanswered (its command finished first) waits
 * before the next attempt — shorter than after a failure, so a user who mostly
 * runs quick commands still gets an answer from a slower one soon, without
 * asking GitHub on every command.
 */
export const UPDATE_CHECK_ABANDON_RETRY_MS = 10 * 60 * 1000

/** How long the notice stays quiet about a version it has announced. */
export const UPDATE_NOTICE_INTERVAL_MS = 24 * HOUR_MS

/** How long one lookup may take before it counts as failed. */
export const UPDATE_LOOKUP_TIMEOUT_MS = 5000

/** A lookup that answered with the channel's newest release. */
export type LookupFound = { kind: 'found'; version: string }

/** A lookup that failed: no network, an HTTP error, a timeout, a bad answer. */
export type LookupFailed = { kind: 'failed' }

/** A lookup still unanswered when its command finished, and cancelled then. */
export type LookupAbandoned = { kind: 'abandoned' }

/** What one releases lookup produced. */
export type LookupOutcome = LookupFound | LookupFailed | LookupAbandoned

/** The fields of the cache that record the notice, which survive every lookup. */
type NoticeRecord = Pick<UpdateCheckState, 'notifiedAt' | 'notifiedVersion'>

/**
 * Whether a run on `channel` should look the newest release up: the cache is
 * for another channel, or none of a success in the last day, a failure in the
 * last hour, or an abandoned attempt in the last ten minutes stands.
 */
export function isLookupDue(
  state: UpdateCheckState | undefined,
  channel: UpdateChannel,
  now: number,
): boolean {
  if (state === undefined || state.channel !== channel) return true
  return (
    !isWithinWindow(state.checkedAt, now, UPDATE_CHECK_INTERVAL_MS) &&
    !isWithinWindow(state.failedAt, now, UPDATE_CHECK_RETRY_MS) &&
    !isWithinWindow(state.abandonedAt, now, UPDATE_CHECK_ABANDON_RETRY_MS)
  )
}

/**
 * The cache after a lookup on `channel`. A success replaces what was known; a
 * failure or abandoned attempt (recorded as such, for its own retry delay)
 * keeps the last success on the same channel (still the best answer there is)
 * but drops one from another channel. When the notice last spoke survives
 * every outcome, since it is about a version rather than a lookup.
 */
export function recordLookup(
  state: UpdateCheckState | undefined,
  channel: UpdateChannel,
  outcome: LookupOutcome,
  now: number,
): UpdateCheckState {
  const notified: NoticeRecord =
    state?.notifiedAt === undefined
      ? {}
      : { notifiedAt: state.notifiedAt, notifiedVersion: state.notifiedVersion }
  if (outcome.kind === 'found') {
    return { channel, checkedAt: now, latest: outcome.version, ...notified }
  }
  const attempt: Pick<UpdateCheckState, 'failedAt' | 'abandonedAt'> =
    outcome.kind === 'failed' ? { failedAt: now } : { abandonedAt: now }
  if (state?.channel === channel) return { ...state, ...attempt }
  return { channel, ...attempt, ...notified }
}

/**
 * The version the notice should announce to a `current` build on `channel`, or
 * `undefined`: the cached newest release must be on that channel and newer
 * than `current`, and the notice must not have announced it in the last day.
 */
export function versionToAnnounce(
  state: UpdateCheckState | undefined,
  channel: UpdateChannel,
  current: string,
  now: number,
): string | undefined {
  if (state === undefined || state.channel !== channel) return undefined
  const { latest } = state
  if (latest === undefined || compareVersions(latest, current) <= 0) return undefined
  if (
    state.notifiedVersion === latest &&
    isWithinWindow(state.notifiedAt, now, UPDATE_NOTICE_INTERVAL_MS)
  ) {
    return undefined
  }
  return latest
}

/** The cache after the notice announced `version` at `now`. */
export function recordNotice(
  state: UpdateCheckState,
  version: string,
  now: number,
): UpdateCheckState {
  return { ...state, notifiedAt: now, notifiedVersion: version }
}

/**
 * Look up the newest release on `channel` — the same lookup `self-update`
 * makes, so the notice and the command agree on what "newest" means — giving
 * up after {@link UPDATE_LOOKUP_TIMEOUT_MS} or when `cancel` aborts. Never
 * rejects: every failure is the `failed` outcome.
 */
export async function lookupLatestVersion(
  env: ReleaseApiEnv,
  channel: UpdateChannel,
  cancel?: AbortSignal,
): Promise<LookupFound | LookupFailed> {
  const timeout = AbortSignal.timeout(UPDATE_LOOKUP_TIMEOUT_MS)
  const signal = cancel === undefined ? timeout : AbortSignal.any([timeout, cancel])
  try {
    const release = await fetchRelease(env, { kind: 'channel', channel }, signal)
    return { kind: 'found', version: release.version }
  } catch {
    return { kind: 'failed' }
  }
}
