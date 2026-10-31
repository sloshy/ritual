/**
 * `ritual doctor`'s report: the facts it gathers about the running build, the
 * workspace, its config, the card cache and the update check, and the checks it
 * judges from them — each `ok`, `warn` or `fail` with a one-line summary and,
 * when something needs doing, a one-line fix.
 *
 * Pure: {@link evaluateDoctorChecks} reads only the facts it is handed, so
 * every verdict is unit-testable without a workspace. Gathering the facts is
 * `./collect.ts`; the CLI renders the report, `GET /api/doctor` returns it, and
 * the MCP `get_diagnostics` tool relays that route.
 *
 * Every summary and hint is a {@link SyncMessage}: English plus its catalog key,
 * so the API and MCP read English and the CLI renders it in the UI language.
 * Paths inside them start `~` for the home directory (the raw fields keep
 * absolute paths) — the report is meant to be pasted into a public issue.
 */

import type { CacheDirSource } from '../config/cache-location'
import type { CacheStatusResult } from '../cache/status'
import type { ListType } from '../list/list-type'
import { UPDATE_CHECK_ELIGIBILITIES, type UpdateCheckEligibility } from '../update/notice'
import { syncDuration, syncList, syncMessage, syncRef } from '../sync/message'
import type { SyncMessage } from '../sync/message'
import type { ParameterlessKey } from '../i18n/t'
import {
  COMMAND,
  CONFIG_KEY,
  DOCKER_PULL_COMMAND,
  ENV_VAR,
  FILE,
  FLAG,
  commandLine,
  flagValue,
} from '../util/cli-tokens'

// ── Facts ─────────────────────────────────────────────────────────────

/** How the running build was made: by the release workflow at a tag, or anything else. */
export const BUILD_KINDS = ['release', 'development'] as const
export type BuildKind = (typeof BUILD_KINDS)[number]

/** How Ritual is running: a compiled binary, `bun` from a source checkout, or the Docker image. */
export const INSTALL_METHODS = ['binary', 'source', 'docker'] as const
export type InstallMethod = (typeof INSTALL_METHODS)[number]

/** The running build. */
export type DoctorRitualFacts = {
  /** As `ritual --version` prints it. */
  version: string
  build: BuildKind
  install: InstallMethod
  /** `process.platform` / `process.arch`. */
  platform: string
  arch: string
  /** The Bun runtime — the one compiled into a binary, or the one running the source. */
  bunVersion: string
  /** Where bugs in this build are reported (a fork's own tracker for a fork's build). */
  issuesUrl: string
}

/** One list type's folder. */
export type DoctorListFolder = {
  /** Absolute path, as the config names it. */
  dir: string
  exists: boolean
  /** List files in it. */
  lists: number
}

/** The workspace at the base directory. */
export type DoctorWorkspaceFacts = {
  /** Absolute path of the base directory. */
  baseDir: string
  /** Whether `ritual.config.json` exists there. */
  configFile: boolean
  folders: Record<ListType, DoctorListFolder>
}

/**
 * The config file: missing, valid, holding settings the strict parser refuses,
 * or not a JSON object at all.
 */
export const CONFIG_STATES = ['absent', 'valid', 'invalid', 'unreadable'] as const
export type ConfigState = (typeof CONFIG_STATES)[number]

export type DoctorConfigFacts = {
  state: ConfigState
  /** Every refused setting (`invalid`), or why the file could not be read (`unreadable`). */
  problems: SyncMessage[]
}

/**
 * What `ritual migrate --check` would say: no config, nothing to do, updates
 * pending, a newer Ritual updated the workspace, the migrated config would be
 * invalid — or the check could not run (`unknown`): it failed (`problem` says
 * why), or it was skipped (no `problem`) because the config check already
 * failed, whose fix comes first.
 */
export const MIGRATION_STATES = [
  'no-config',
  'current',
  'pending',
  'ahead',
  'invalid',
  'unknown',
] as const
export type MigrationState = (typeof MIGRATION_STATES)[number]

export type DoctorMigrationFacts = {
  state: MigrationState
  /** The command that brings this Ritual level with the workspace (`ahead` only). */
  remedy: string | null
  /** Why the migrated config is invalid, or why the check could not run. */
  problem: SyncMessage | null
}

/** The card cache. */
export type DoctorCacheFacts = {
  /** Absolute path of the cache directory, and the setting that chose it. */
  dir: string
  dirSource: CacheDirSource
  dirExists: boolean
  /** The configured cache server's address, when card data comes from one. */
  server: string | null
  /**
   * `ritual cache status`'s report, or null with a cache server configured
   * (reading it there would be a network call, and doctor makes none) or when
   * reading it failed.
   */
  status: CacheStatusResult | null
  /** Why the cache could not be read (a corrupt or unreadable file), or null. */
  problem: SyncMessage | null
}

/**
 * Whether this run's update notice checks for new releases: `on`, turned
 * `off` (the `updateCheck` key or `RITUAL_NO_UPDATE_CHECK`), or not applicable
 * to a development build or the Docker image (`updateCheckEligibility`).
 */
export const UPDATE_CHECK_MODES = UPDATE_CHECK_ELIGIBILITIES
export type UpdateCheckMode = UpdateCheckEligibility

/** The update notice's last answer, read from the per-user state file — never looked up live. */
export type DoctorUpdateFacts = {
  mode: UpdateCheckMode
  /** The newest release the last successful check saw on this build's channel. */
  latest: string | null
  /** ISO-8601 time of that check. */
  checkedAt: string | null
  /** `latest` is newer than the running version. */
  available: boolean
}

/** Everything the checks are judged from. */
export type DoctorFacts = {
  ritual: DoctorRitualFacts
  workspace: DoctorWorkspaceFacts
  config: DoctorConfigFacts
  migrations: DoctorMigrationFacts
  cache: DoctorCacheFacts
  update: DoctorUpdateFacts
}

// ── Checks ────────────────────────────────────────────────────────────

export const DOCTOR_STATUSES = ['ok', 'warn', 'fail'] as const
export type DoctorStatus = (typeof DOCTOR_STATUSES)[number]

/** Every check, in report order. */
export const DOCTOR_CHECK_IDS = [
  'ritual',
  'workspace',
  'config',
  'migrations',
  'cache',
  'update',
] as const
export type DoctorCheckId = (typeof DOCTOR_CHECK_IDS)[number]

/** One verdict. */
export type DoctorCheck = {
  id: DoctorCheckId
  status: DoctorStatus
  /** What was found, in one line. */
  summary: SyncMessage
  /** How to fix it, in one line — null when there is nothing to do. */
  hint: SyncMessage | null
  /** Further lines under the summary: each invalid config setting. Usually empty. */
  details: SyncMessage[]
}

/** The whole report: the facts, the verdicts, and whether none failed. */
export type DoctorReport = DoctorFacts & {
  /** No check failed (warnings allowed) — `ritual doctor` exits 0 exactly when this holds. */
  ok: boolean
  checks: DoctorCheck[]
}

/** What the verdicts read besides the facts. */
export type DoctorContext = {
  /** Epoch milliseconds — ages are measured from it. */
  now: number
  /** The home directory, shown as `~` in summaries. */
  home: string
}

/** `path` with a leading home directory shown as `~`. */
export function homeRelative(path: string, home: string): string {
  const trimmed = home.replace(/[\\/]+$/, '')
  // A home that is a root (`/`, `C:\`) would turn every path into `~…`.
  if (trimmed === '' || /^[A-Za-z]:$/.test(trimmed)) return path
  if (path === trimmed) return '~'
  const rest = path.slice(trimmed.length)
  return path.startsWith(trimmed) && /^[\\/]/.test(rest) ? `~${rest}` : path
}

/** One verdict; `hint` and `details` default to none. */
function check(
  id: DoctorCheckId,
  status: DoctorStatus,
  summary: SyncMessage,
  hint: SyncMessage | null = null,
  details: SyncMessage[] = [],
): DoctorCheck {
  return { id, status, summary, hint, details }
}

/** The catalog name of each install method. */
const INSTALL_LABELS = {
  binary: 'domain.doctor.install.binary',
  source: 'domain.doctor.install.source',
  docker: 'domain.doctor.install.docker',
} as const satisfies Record<InstallMethod, ParameterlessKey>

/** The catalog name of each build kind. */
const BUILD_LABELS = {
  release: 'domain.doctor.build.release',
  development: 'domain.doctor.build.development',
} as const satisfies Record<BuildKind, ParameterlessKey>

function ritualCheck(facts: DoctorRitualFacts): DoctorCheck {
  return check(
    'ritual',
    'ok',
    syncMessage('domain.doctor.ritual.summary', {
      version: facts.version,
      build: syncRef(BUILD_LABELS[facts.build]),
      install: syncRef(INSTALL_LABELS[facts.install]),
      platform: facts.platform,
      arch: facts.arch,
      bun: facts.bunVersion,
    }),
  )
}

function workspaceCheck(facts: DoctorWorkspaceFacts, context: DoctorContext): DoctorCheck {
  const path = homeRelative(facts.baseDir, context.home)
  const { deck, collection, wanted } = facts.folders
  const looksLikeWorkspace = facts.configFile || deck.exists || collection.exists || wanted.exists
  if (!looksLikeWorkspace) {
    return check(
      'workspace',
      'warn',
      syncMessage('domain.doctor.workspace.notFound', { path, file: FILE.config }),
      syncMessage('domain.doctor.workspace.notFoundHint', {
        flag: flagValue(FLAG.baseDir, '<path>'),
        command: commandLine(COMMAND.new, 'deck', '"<name>"'),
      }),
    )
  }
  return check(
    'workspace',
    'ok',
    syncMessage('domain.doctor.workspace.found', {
      path,
      lists: syncList(
        [
          syncRef('domain.count.decks', { count: deck.lists }),
          syncRef('domain.count.collections', { count: collection.lists }),
          syncRef('domain.count.wantedLists', { count: wanted.lists }),
        ],
        'unit',
      ),
    }),
  )
}

function configCheck(facts: DoctorConfigFacts): DoctorCheck {
  const file = FILE.config
  switch (facts.state) {
    case 'absent':
      return check('config', 'ok', syncMessage('domain.doctor.config.absent', { file }))
    case 'valid':
      return check('config', 'ok', syncMessage('domain.doctor.config.valid', { file }))
    case 'invalid':
      return check(
        'config',
        'fail',
        syncMessage('domain.doctor.config.invalid', { file, count: facts.problems.length }),
        syncMessage('domain.doctor.config.invalidHint', {
          file,
          command: commandLine(COMMAND.configUnset, '<key>'),
        }),
        facts.problems,
      )
    case 'unreadable':
      return check(
        'config',
        'fail',
        syncMessage('domain.doctor.config.unreadable', { file }),
        syncMessage('domain.doctor.config.unreadableHint', { file }),
        facts.problems,
      )
    default:
      return facts.state satisfies never
  }
}

function migrationsCheck(facts: DoctorMigrationFacts): DoctorCheck {
  switch (facts.state) {
    case 'no-config':
      return check(
        'migrations',
        'ok',
        syncMessage('domain.doctor.migrations.noConfig', { file: FILE.config }),
      )
    case 'current':
      return check('migrations', 'ok', syncMessage('domain.doctor.migrations.current'))
    case 'pending':
      return check(
        'migrations',
        'warn',
        syncMessage('domain.doctor.migrations.pending'),
        syncMessage('domain.doctor.migrations.pendingHint', {
          preview: commandLine(COMMAND.migrate, FLAG.dryRun),
          command: commandLine(COMMAND.migrate),
        }),
      )
    case 'ahead':
      return check(
        'migrations',
        'warn',
        syncMessage('domain.doctor.migrations.ahead'),
        syncMessage('domain.doctor.migrations.aheadHint', {
          command: facts.remedy ?? commandLine(COMMAND.selfUpdate),
        }),
      )
    case 'invalid':
      return check(
        'migrations',
        'fail',
        syncMessage('domain.doctor.migrations.invalid'),
        syncMessage('domain.doctor.migrations.invalidHint', { file: FILE.config }),
        facts.problem === null ? [] : [facts.problem],
      )
    case 'unknown':
      return facts.problem === null
        ? check(
            'migrations',
            'warn',
            syncMessage('domain.doctor.migrations.blocked', { file: FILE.config }),
          )
        : check('migrations', 'warn', syncMessage('domain.doctor.migrations.unknown'), null, [
            facts.problem,
          ])
    default:
      return facts.state satisfies never
  }
}

/** The command that downloads the whole card cache now. */
const PRELOAD_COMMAND = commandLine(COMMAND.cachePreloadAll)

function cacheCheck(facts: DoctorCacheFacts, context: DoctorContext): DoctorCheck {
  const path = homeRelative(facts.dir, context.home)
  if (facts.server !== null) {
    return check(
      'cache',
      'ok',
      syncMessage('domain.doctor.cache.server', { address: facts.server }),
    )
  }
  if (facts.problem !== null) {
    return check(
      'cache',
      'warn',
      syncMessage('domain.doctor.cache.unreadable', { path }),
      syncMessage('domain.doctor.cache.refreshHint', { command: PRELOAD_COMMAND }),
      [facts.problem],
    )
  }
  const status = facts.status
  if (status === null || status.empty) {
    return check(
      'cache',
      'warn',
      syncMessage('domain.doctor.cache.empty', { path }),
      syncMessage('domain.doctor.cache.emptyHint', { command: PRELOAD_COMMAND }),
    )
  }
  const cards = syncRef('domain.count.cards', { count: status.cardCount })
  if (status.bulkTypeStale) {
    return check(
      'cache',
      'warn',
      syncMessage('domain.doctor.cache.bulkStale', {
        path,
        cards,
        configKey: CONFIG_KEY.defaultLanguage,
      }),
      syncMessage('domain.doctor.cache.refreshHint', { command: PRELOAD_COMMAND }),
    )
  }
  const refreshedAt = status.lastCardRefresh === null ? null : Date.parse(status.lastCardRefresh)
  if (refreshedAt === null || Number.isNaN(refreshedAt)) {
    return check(
      'cache',
      status.priceStale ? 'warn' : 'ok',
      syncMessage('domain.doctor.cache.neverRefreshed', { path, cards }),
      status.priceStale
        ? syncMessage('domain.doctor.cache.refreshHint', { command: PRELOAD_COMMAND })
        : null,
    )
  }
  const age = syncDuration(Math.max(0, context.now - refreshedAt))
  if (status.priceStale) {
    return check(
      'cache',
      'warn',
      syncMessage('domain.doctor.cache.stale', { path, cards, age }),
      syncMessage('domain.doctor.cache.refreshHint', { command: PRELOAD_COMMAND }),
    )
  }
  return check('cache', 'ok', syncMessage('domain.doctor.cache.fresh', { path, cards, age }))
}

function updateCheck(
  facts: DoctorUpdateFacts,
  version: string,
  context: DoctorContext,
): DoctorCheck {
  switch (facts.mode) {
    case 'development':
      return check('update', 'ok', syncMessage('domain.doctor.update.development'))
    case 'docker':
      return check(
        'update',
        'ok',
        syncMessage('domain.doctor.update.docker', { command: DOCKER_PULL_COMMAND }),
      )
    case 'off':
      return check(
        'update',
        'ok',
        syncMessage('domain.doctor.update.off', {
          configKey: CONFIG_KEY.updateCheck,
          envVar: ENV_VAR.noUpdateCheck,
        }),
      )
    case 'on':
      break
    default:
      return facts.mode satisfies never
  }
  if (facts.available && facts.latest !== null) {
    return check(
      'update',
      'warn',
      syncMessage('domain.doctor.update.available', { latest: facts.latest, current: version }),
      syncMessage('domain.doctor.update.availableHint', {
        command: commandLine(COMMAND.selfUpdate),
      }),
    )
  }
  const checkedAt = facts.checkedAt === null ? Number.NaN : Date.parse(facts.checkedAt)
  if (Number.isNaN(checkedAt)) {
    return check('update', 'ok', syncMessage('domain.doctor.update.neverChecked'))
  }
  return check(
    'update',
    'ok',
    syncMessage('domain.doctor.update.current', {
      age: syncDuration(Math.max(0, context.now - checkedAt)),
    }),
  )
}

/** Judge every check from the facts, in {@link DOCTOR_CHECK_IDS} order. */
export function evaluateDoctorChecks(facts: DoctorFacts, context: DoctorContext): DoctorCheck[] {
  return [
    ritualCheck(facts.ritual),
    workspaceCheck(facts.workspace, context),
    configCheck(facts.config),
    migrationsCheck(facts.migrations),
    cacheCheck(facts.cache, context),
    updateCheck(facts.update, facts.ritual.version, context),
  ]
}

/** The facts with their verdicts: {@link DoctorReport}. */
export function buildDoctorReport(facts: DoctorFacts, context: DoctorContext): DoctorReport {
  const checks = evaluateDoctorChecks(facts, context)
  return { ...facts, ok: checks.every((c) => c.status !== 'fail'), checks }
}
