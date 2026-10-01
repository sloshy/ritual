/**
 * The per-user state file, `state.json` in {@link resolveUserStateDir}: what
 * Ritual remembers between runs that belongs to the user rather than to a
 * workspace. One file holds several independent sections; each is validated on
 * its own, so a damaged section costs only its own contents.
 *
 * The file is best-effort by contract. Nothing a command does may fail because
 * it could not be read or written: a missing, unreadable or corrupt file reads
 * as empty, and a failed write is dropped.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { writeFileAtomic } from './atomic-write'
import { createDefaultFileSystemClient } from './interfaces'
import { isUpdateChannel, UPDATE_CHANNELS, type UpdateChannel } from '../config/semver'
import { isReleaseTag } from '../config/version'
import { isRecord } from './json'
import { resolveUserStateDir } from './user-dirs'

/** When the pre-command migration prompt last asked, in epoch ms, keyed by resolved base dir. */
export type MigratePromptTimes = Record<string, number>

/**
 * The update-available notice's cache (`src/update/notice.ts`): what the last
 * releases lookup found, and when the notice last spoke. Times are epoch ms.
 */
export type UpdateCheckState = {
  /** The channel the lookup fields describe; a different running channel ignores them. */
  channel: UpdateChannel
  /** When a lookup last succeeded. */
  checkedAt?: number
  /** The newest release version on {@link channel} at {@link checkedAt}. */
  latest?: string
  /** When a lookup last failed — it is not retried for an hour. */
  failedAt?: number
  /** When a lookup was last abandoned unanswered — it is not retried for ten minutes. */
  abandonedAt?: number
  /** When the notice was last printed, and for which version. */
  notifiedAt?: number
  notifiedVersion?: string
}

/** Every section of the state file this build understands. */
export type UserState = {
  migratePrompts: MigratePromptTimes
  /** Absent until the first update check on a release build. */
  updateCheck?: UpdateCheckState
}

/** The section names, as stored in the file. */
export type UserStateSection = keyof UserState

const STATE_FILE = 'state.json'

/** The empty state: what a missing or unreadable file reads as. */
export function emptyUserState(): UserState {
  return { migratePrompts: {} }
}

/** The path of the state file. */
export function userStatePath(): string {
  return path.join(resolveUserStateDir(), STATE_FILE)
}

/** A non-negative finite epoch-milliseconds time. */
function isEpochMs(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/**
 * Parse the `migratePrompts` section: an object of base dir → non-negative
 * finite epoch milliseconds. Malformed entries are dropped; a section that is
 * not an object at all is an error.
 */
export function parseMigratePromptTimes(value: unknown): MigratePromptTimes | string {
  if (!isRecord(value)) return 'migratePrompts must be an object'
  const times: MigratePromptTimes = {}
  for (const [baseDir, time] of Object.entries(value)) {
    if (isEpochMs(time)) times[baseDir] = time
  }
  return times
}

/** A stored version: what the releases API's tags normalize to (`1.2.3`, `1.3.0-beta1`). */
function isStoredVersion(value: unknown): value is string {
  return typeof value === 'string' && !value.startsWith('v') && isReleaseTag(value)
}

/**
 * Parse the `updateCheck` section. Without a known channel nothing in it can
 * be trusted, so that is an error; any other malformed field is dropped on its
 * own (a lost time only means an early retry or a repeated notice).
 */
export function parseUpdateCheckState(value: unknown): UpdateCheckState | string {
  if (!isRecord(value)) return 'updateCheck must be an object'
  const { channel, checkedAt, latest, failedAt, abandonedAt, notifiedAt, notifiedVersion } = value
  if (!isUpdateChannel(channel)) {
    return `updateCheck.channel must be one of: ${UPDATE_CHANNELS.join(', ')}`
  }
  const state: UpdateCheckState = { channel }
  // A version without the time it was seen (or the reverse) is half a fact.
  if (isEpochMs(checkedAt) && isStoredVersion(latest)) {
    state.checkedAt = checkedAt
    state.latest = latest
  }
  if (isEpochMs(failedAt)) state.failedAt = failedAt
  if (isEpochMs(abandonedAt)) state.abandonedAt = abandonedAt
  if (isEpochMs(notifiedAt) && isStoredVersion(notifiedVersion)) {
    state.notifiedAt = notifiedAt
    state.notifiedVersion = notifiedVersion
  }
  return state
}

/**
 * Parse the whole state file. Content that is not a JSON object is an error;
 * within an object, a missing or malformed section reads as empty so the
 * others survive it. Sections this build does not know are ignored here and
 * preserved by {@link writeUserStateSection}.
 */
export function parseUserState(value: unknown): UserState | string {
  if (!isRecord(value)) return 'the state file must contain a JSON object'
  const state = emptyUserState()
  const migratePrompts = parseMigratePromptTimes(value.migratePrompts)
  if (typeof migratePrompts !== 'string') state.migratePrompts = migratePrompts
  if (value.updateCheck !== undefined) {
    const updateCheck = parseUpdateCheckState(value.updateCheck)
    if (typeof updateCheck !== 'string') state.updateCheck = updateCheck
  }
  return state
}

/** The file's parsed JSON, or `undefined` when it is missing, unreadable or not JSON. */
async function readStateJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf-8'))
  } catch {
    return undefined
  }
}

/** Read the state file; any failure reads as {@link emptyUserState}. */
export async function readUserState(): Promise<UserState> {
  const parsed = parseUserState(await readStateJson(userStatePath()))
  return typeof parsed === 'string' ? emptyUserState() : parsed
}

/**
 * Replace one section of the state file, keeping every other section —
 * including ones a newer Ritual wrote — as it is. The write is atomic, so a
 * concurrent reader never sees half a file; two processes writing at once can
 * still lose one update, which the best-effort contract accepts.
 * Never throws: a state file that cannot be written only means Ritual forgets.
 */
export async function writeUserStateSection<S extends UserStateSection>(
  section: S,
  value: NonNullable<UserState[S]>,
): Promise<void> {
  try {
    const file = userStatePath()
    const current = await readStateJson(file)
    const next = { ...(isRecord(current) ? current : {}), [section]: value }
    await fs.mkdir(path.dirname(file), { recursive: true })
    await writeFileAtomic(
      createDefaultFileSystemClient(),
      file,
      `${JSON.stringify(next, null, 2)}\n`,
    )
  } catch {
    // Best-effort by contract — see the module comment.
  }
}
