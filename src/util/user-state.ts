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
import { isRecord } from './json'
import { resolveUserStateDir } from './user-dirs'

/** When the pre-command migration prompt last asked, in epoch ms, keyed by resolved base dir. */
export type MigratePromptTimes = Record<string, number>

/** Every section of the state file this build understands. */
export type UserState = {
  migratePrompts: MigratePromptTimes
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

/**
 * Parse the `migratePrompts` section: an object of base dir → non-negative
 * finite epoch milliseconds. Malformed entries are dropped; a section that is
 * not an object at all is an error.
 */
export function parseMigratePromptTimes(value: unknown): MigratePromptTimes | string {
  if (!isRecord(value)) return 'migratePrompts must be an object'
  const times: MigratePromptTimes = {}
  for (const [baseDir, time] of Object.entries(value)) {
    if (typeof time === 'number' && Number.isFinite(time) && time >= 0) times[baseDir] = time
  }
  return times
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
  value: UserState[S],
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
