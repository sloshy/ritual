/**
 * Gather `ritual doctor`'s facts from the running process, the workspace at
 * the base directory, the card cache and the per-user state file. Read-only
 * and offline: nothing here writes a file, refreshes the cache, or makes a
 * network call — a configured cache server is named, not asked.
 *
 * The report reads the config the process has loaded (`getRitualConfig()`) for
 * the list folders and the cache directory, and re-reads the file itself for
 * the verdict on it — so a server's report describes the file as it is on disk
 * now, and the CLI's survives a file the loader would refuse (the root hook
 * loads it quietly for `doctor`).
 */

import fs from 'node:fs/promises'
import os from 'node:os'
import { getConfiguredCacheServerAddress } from '../cache/config'
import { getCacheDirLocation } from '../cache/file-cache'
import { collectCacheStatus } from '../cache/status'
import { getBaseDir } from '../config/base-dir'
import {
  getRitualConfig,
  inspectRitualConfig,
  readRawRitualConfig,
  RitualConfigParseError,
  type RawConfig,
} from '../config/ritual-config'
import { isRunningFromSource } from '../config/runtime'
import { ISSUES_URL, isReleaseBuild, version } from '../config/version'
import type { ListType } from '../list/list-type'
import { dirForType, listLocations } from '../list/resolve-list'
import { errorMessage, syncMessage, syncMessageOf } from '../sync/message'
import { currentInstallKind } from '../update/env'
import { newerCachedRelease, updateCheckEligibility, updateChecksOptedOut } from '../update/notice'
import { resolveChannel } from '../update/release'
import { readUserState } from '../util/user-state'
import {
  buildDoctorReport,
  type DoctorCacheFacts,
  type DoctorConfigFacts,
  type DoctorFacts,
  type DoctorListFolder,
  type DoctorMigrationFacts,
  type DoctorReport,
  type DoctorRitualFacts,
  type DoctorUpdateFacts,
  type DoctorWorkspaceFacts,
  type InstallMethod,
} from './report'

function installMethod(): InstallMethod {
  if (currentInstallKind() === 'docker') return 'docker'
  return isRunningFromSource() ? 'source' : 'binary'
}

function ritualFacts(): DoctorRitualFacts {
  return {
    version,
    build: isReleaseBuild ? 'release' : 'development',
    install: installMethod(),
    platform: process.platform,
    arch: process.arch,
    bunVersion: Bun.version,
    issuesUrl: ISSUES_URL,
  }
}

/** The verdict on the config file, read from disk now. */
async function configFacts(): Promise<DoctorConfigFacts> {
  let raw: RawConfig | null
  try {
    raw = await readRawRitualConfig()
  } catch (error) {
    // The parse error's own sentence ends in "fix the file", which the
    // check's hint already says: the parser's reason is the useful part.
    const problem =
      error instanceof RitualConfigParseError ? syncMessageOf(error.reason) : errorMessage(error)
    return { state: 'unreadable', problems: [problem] }
  }
  if (raw === null) return { state: 'absent', problems: [] }
  const problems = inspectRitualConfig(raw).problems.map((problem) => problem.error)
  return { state: problems.length === 0 ? 'valid' : 'invalid', problems }
}

async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await fs.stat(dir)).isDirectory()
  } catch {
    return false
  }
}

async function folderFacts(type: ListType): Promise<DoctorListFolder> {
  const dir = dirForType(type)
  return {
    dir,
    exists: await isDirectory(dir),
    lists: (await listLocations(type)).length,
  }
}

async function workspaceFacts(configFile: boolean): Promise<DoctorWorkspaceFacts> {
  const [deck, collection, wanted] = await Promise.all([
    folderFacts('deck'),
    folderFacts('collection'),
    folderFacts('wanted'),
  ])
  return { baseDir: getBaseDir(), configFile, folders: { deck, collection, wanted } }
}

/**
 * What `ritual migrate --check` would find, given the config check's verdict.
 * The migration engine (`src/migrate`) sits above this module — it refreshes
 * the installed skills — so the process's entry point hands its probe in
 * through {@link setMigrationProbe}.
 */
export type MigrationProbe = (config: DoctorConfigFacts) => Promise<DoctorMigrationFacts>

/** The installed probe; until one is, the check reports that it could not run. */
let migrationProbe: MigrationProbe | null = null

/** Install the probe {@link collectDoctorFacts} asks — once, at startup (`index.ts`). */
export function setMigrationProbe(probe: MigrationProbe | null): void {
  migrationProbe = probe
}

/** The migration check, or "could not run" (with the reason) when it throws or none is installed. */
async function migrationFacts(config: DoctorConfigFacts): Promise<DoctorMigrationFacts> {
  if (migrationProbe === null) {
    return {
      state: 'unknown',
      remedy: null,
      problem: syncMessage('domain.doctor.migrations.noProbe'),
    }
  }
  try {
    return await migrationProbe(config)
  } catch (error) {
    return { state: 'unknown', remedy: null, problem: errorMessage(error) }
  }
}

async function cacheFacts(): Promise<DoctorCacheFacts> {
  const location = getCacheDirLocation()
  const server = getConfiguredCacheServerAddress() ?? null
  const read: CacheRead =
    server === null ? await readCacheStatus() : { status: null, problem: null }
  return {
    dir: location.dir,
    dirSource: location.source,
    dirExists: await isDirectory(location.dir),
    server,
    ...read,
  }
}

/** `cache status`'s report, or why it could not be read. */
type CacheRead = Pick<DoctorCacheFacts, 'status' | 'problem'>

async function readCacheStatus(): Promise<CacheRead> {
  try {
    return { status: await collectCacheStatus(), problem: null }
  } catch (error) {
    return { status: null, problem: errorMessage(error) }
  }
}

/** The last successful update check's answer, as the report states it. */
type SeenRelease = Pick<DoctorUpdateFacts, 'latest' | 'checkedAt'>

/** `checkedAt` as ISO-8601, or null for a stamp no `Date` can hold (a hand-edited file). */
function isoTime(epochMs: number): string | null {
  const date = new Date(epochMs)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

async function updateFacts(install: InstallMethod): Promise<DoctorUpdateFacts> {
  const eligibility = updateCheckEligibility({
    release: isReleaseBuild,
    installKind: install === 'docker' ? 'docker' : undefined,
    optedOut: updateChecksOptedOut(),
  })
  // The notice reads `updateCheck` too, once the run is eligible.
  const mode = eligibility === 'on' && !getRitualConfig().updateCheck ? 'off' : eligibility
  // Never rejects: an unreadable state file reads as empty.
  const state = (await readUserState()).updateCheck
  const channel = resolveChannel(version, {})
  const checkedAt =
    state?.channel === channel && state.checkedAt !== undefined ? isoTime(state.checkedAt) : null
  const seen: SeenRelease =
    checkedAt !== null && state?.latest !== undefined
      ? { latest: state.latest, checkedAt }
      : { latest: null, checkedAt: null }
  return {
    mode,
    ...seen,
    available: newerCachedRelease(state, channel, version) !== undefined,
  }
}

/** Gather every fact the checks read. */
export async function collectDoctorFacts(): Promise<DoctorFacts> {
  const ritual = ritualFacts()
  const config = await configFacts()
  const [workspace, migrations, cache, update] = await Promise.all([
    workspaceFacts(config.state !== 'absent'),
    migrationFacts(config),
    cacheFacts(),
    updateFacts(ritual.install),
  ])
  return { ritual, workspace, config, migrations, cache, update }
}

/** The whole report, judged now. */
export async function collectDoctorReport(): Promise<DoctorReport> {
  return buildDoctorReport(await collectDoctorFacts(), { now: Date.now(), home: os.homedir() })
}
