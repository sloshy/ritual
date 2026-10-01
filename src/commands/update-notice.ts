/**
 * The update-available notice (plan §8 of
 * research/self-update-and-migrations-plan-2026-09-30.md): one stderr line,
 * after a command's own output, when a newer Ritual release is out — at most
 * once a day per version. The rules live in `src/update/notice.ts`; this module
 * decides whether a run takes part and drives the cache around the command.
 *
 * - `start` (end of the root preAction hook) reads the cache and, when it is
 *   due, starts the releases lookup beside the command.
 * - `finish` (postAction — which also runs when the action reported a failure
 *   through the exit code, but not when it threw) takes the lookup's answer if
 *   it already arrived, abandons it otherwise, and prints the notice the cache
 *   then calls for.
 * - `abandon` (after parsing ends, however it ends) aborts a lookup still in
 *   flight, so a command that threw past `finish` cannot be held open by it.
 *
 * `serve` and `admin` run until stopped, so they get the notice at startup from
 * the cache alone and refresh it in the background for the next run (cancelled
 * only when the server failed to start).
 *
 * Advisory and silent on failure: nothing here can fail or delay a command.
 */

import { isCommandOrSubcommand, qualifiedCommandName } from '../cli/command-name'
import type { UpdateNoticeHooks } from '../cli/program'
import type { UpdateChannel } from '../config/semver'
import { isConfigParseError, parseUpdateCheck, readRawRitualConfig } from '../config/ritual-config'
import { t } from '../i18n/t'
import {
  defaultSelfUpdateEnv,
  type BuildIdentity,
  type InstallKind,
  type ReleaseApiEnv,
} from '../update/env'
import {
  isLookupDue,
  lookupLatestVersion,
  recordLookup,
  recordNotice,
  versionToAnnounce,
  type LookupFailed,
  type LookupFound,
} from '../update/notice'
import { resolveChannel } from '../update/release'
import { envFlagSet, isCiEnvironment } from '../util/no-input'
import { readUserState, writeUserStateSection, type UpdateCheckState } from '../util/user-state'

/** Commands that never check: matched by qualified name, subcommands included. */
export const UPDATE_NOTICE_EXEMPT: readonly string[] = ['self-update', 'mcp', 'help']

/**
 * Commands that run until stopped: notice at startup, background refresh,
 * nothing after. Exact names — `admin setup` and friends are one-shot commands.
 */
export const LONG_RUNNING_COMMANDS: ReadonlySet<string> = new Set(['serve', 'admin'])

/** What the notice reads from the world, injectable so tests need no network or release build. */
export type UpdateNoticeEnv = ReleaseApiEnv & {
  build: BuildIdentity
  installKind: InstallKind
  /** `RITUAL_NO_UPDATE_CHECK`, read with the same on/off spellings as `RITUAL_NO_INPUT`. */
  optedOut: boolean
  /** `CI` is set — see {@link isCiEnvironment}. */
  ci: boolean
  stderrIsTTY: boolean
  now: () => number
}

/** The real environment of this process, read when a command starts. */
export function defaultUpdateNoticeEnv(): UpdateNoticeEnv {
  const { fetch, githubToken, apiBase, build, installKind } = defaultSelfUpdateEnv()
  return {
    fetch,
    githubToken,
    apiBase,
    build,
    installKind,
    optedOut: envFlagSet(process.env.RITUAL_NO_UPDATE_CHECK),
    ci: isCiEnvironment(),
    stderrIsTTY: process.stderr.isTTY === true,
    now: () => Date.now(),
  }
}

/** How a run takes part: not at all, beside a one-shot command, or at a server's startup. */
export type UpdateNoticeMode = 'off' | 'command' | 'long-running'

/** Everything {@link updateNoticeMode} decides on, apart from the config key. */
export type UpdateNoticeGate = Pick<
  UpdateNoticeEnv,
  'build' | 'installKind' | 'optedOut' | 'ci' | 'stderrIsTTY'
> & {
  /** The action command's qualified name (`config set`). */
  command: string
  /** The action command's `--output`, or `text` when it has none. */
  output: string
  /** The action command's `--quiet`. */
  quiet: boolean
}

/**
 * Whether (and how) a run checks for updates. Off for a build that cannot
 * update itself (not a release, or Ritual's Docker image), when the user opted
 * out (`RITUAL_NO_UPDATE_CHECK`), under CI, when stderr is not a terminal (a
 * script or log reads it), for machine-readable output or `--quiet`, and for
 * the exempt commands. The `updateCheck` config key is checked separately,
 * after this, since it costs a file read.
 */
export function updateNoticeMode(gate: UpdateNoticeGate): UpdateNoticeMode {
  if (!gate.build.release || gate.installKind === 'docker') return 'off'
  if (gate.optedOut || gate.ci || !gate.stderrIsTTY) return 'off'
  if (gate.output !== 'text' || gate.quiet) return 'off'
  if (isCommandOrSubcommand(gate.command, UPDATE_NOTICE_EXEMPT)) return 'off'
  if (LONG_RUNNING_COMMANDS.has(gate.command)) return 'long-running'
  return 'command'
}

/**
 * The `updateCheck` config key, read from the raw file: `migrate` deliberately
 * skips the config load, and the key must hold for it too. Anything unreadable
 * or malformed leaves the check on — the config load reports a bad file itself.
 */
async function configAllowsCheck(): Promise<boolean> {
  try {
    const parsed = parseUpdateCheck((await readRawRitualConfig())?.updateCheck)
    return isConfigParseError(parsed) || parsed
  } catch {
    return true
  }
}

/** The action command's options the gate reads (`--output` may be `csv`). */
type GateOptions = { output?: string; quiet?: boolean }

/** A lookup running beside the command. */
type PendingLookup = {
  controller: AbortController
  /** Set once the lookup has answered; until then `finish` abandons it. */
  outcome: LookupFound | LookupFailed | undefined
  /** Resolves with the outcome (never rejects). */
  answered: Promise<LookupFound | LookupFailed>
}

/** What `start` learned about a one-shot command, for `finish`. */
type CommandRun = {
  mode: 'command'
  env: UpdateNoticeEnv
  channel: UpdateChannel
  state: UpdateCheckState | undefined
  lookup: PendingLookup | undefined
}

/** A server's background refresh, cancelled only if the server never started. */
type ServerRun = {
  mode: 'long-running'
  lookup: PendingLookup | undefined
}

type ActiveRun = CommandRun | ServerRun

/** The hooks the root program calls, plus the one `main()` calls once parsing ends. */
export type UpdateNotice = UpdateNoticeHooks & {
  abandon: () => void
}

/** Whether the command recorded a failure (an action's exit code, or `main()`'s catch). */
function commandFailed(): boolean {
  return Number(process.exitCode ?? 0) !== 0
}

/**
 * Print the notice when the cache calls for one, and return the cache that
 * records it — or `undefined` when nothing was printed.
 */
function announceIfDue(
  env: UpdateNoticeEnv,
  state: UpdateCheckState | undefined,
  channel: UpdateChannel,
): UpdateCheckState | undefined {
  const now = env.now()
  const version = versionToAnnounce(state, channel, env.build.version, now)
  if (state === undefined || version === undefined) return undefined
  console.warn(t('cli.updateNotice.available', { latest: version, current: env.build.version }))
  return recordNotice(state, version, now)
}

/** Start a lookup that `controller` can cancel; `outcome` fills in when it answers. */
function startLookup(env: UpdateNoticeEnv, channel: UpdateChannel): PendingLookup {
  const controller = new AbortController()
  const answered = lookupLatestVersion(env, channel, controller.signal)
  const pending: PendingLookup = { controller, outcome: undefined, answered }
  void answered.then((outcome) => {
    pending.outcome = outcome
  })
  return pending
}

/**
 * A server's startup: announce from the cache, then refresh it in the
 * background — not abandoned when the action returns, since the server keeps
 * running; the lookup's own timeout bounds it, and it is cancelled only when
 * the server failed to start.
 */
async function startServer(env: UpdateNoticeEnv, channel: UpdateChannel): Promise<ServerRun> {
  let state = await readUserState().then((user) => user.updateCheck)
  const announced = announceIfDue(env, state, channel)
  if (announced !== undefined) {
    state = announced
    await writeUserStateSection('updateCheck', announced)
  }
  if (!isLookupDue(state, channel, env.now())) return { mode: 'long-running', lookup: undefined }
  const before = state
  const lookup = startLookup(env, channel)
  void lookup.answered.then((outcome) =>
    // A cancelled refresh is the server's failure, not a lookup's: record nothing.
    lookup.controller.signal.aborted
      ? undefined
      : writeUserStateSection('updateCheck', recordLookup(before, channel, outcome, env.now())),
  )
  return { mode: 'long-running', lookup }
}

/** Settle a one-shot command's lookup and print the notice its cache calls for. */
async function finishCommand(run: CommandRun): Promise<void> {
  const { env, channel } = run
  let next: UpdateCheckState | undefined
  if (run.lookup !== undefined) {
    // An answer that has not arrived by now is abandoned; it is retried after
    // a short delay (a later, longer command may catch it), not on every run.
    const outcome = run.lookup.outcome ?? { kind: 'abandoned' }
    run.lookup.controller.abort()
    next = recordLookup(run.state, channel, outcome, env.now())
  }
  next = announceIfDue(env, next ?? run.state, channel) ?? next
  if (next !== undefined) await writeUserStateSection('updateCheck', next)
}

/** The hooks for one process; `env` is read when a command starts. */
export function createUpdateNotice(
  env: () => UpdateNoticeEnv = defaultUpdateNoticeEnv,
): UpdateNotice {
  let active: ActiveRun | undefined

  /** Cancel what `start` began — a server's refresh only when the server failed. */
  const stop = (run: ActiveRun): void => {
    if (run.mode === 'command' || commandFailed()) run.lookup?.controller.abort()
  }

  return {
    // Both hooks are advisory: whatever goes wrong in them (an unreadable home
    // directory, say) is swallowed rather than failing the command.
    async start(actionCommand) {
      if (active !== undefined) stop(active)
      active = undefined
      try {
        const runEnv = env()
        const options = actionCommand.opts<GateOptions>()
        const mode = updateNoticeMode({
          ...runEnv,
          command: qualifiedCommandName(actionCommand),
          output: options.output ?? 'text',
          quiet: options.quiet === true,
        })
        if (mode === 'off' || !(await configAllowsCheck())) return
        const channel = resolveChannel(runEnv.build.version, {})
        if (mode === 'long-running') {
          active = await startServer(runEnv, channel)
          return
        }
        const state = (await readUserState()).updateCheck
        const lookup = isLookupDue(state, channel, runEnv.now())
          ? startLookup(runEnv, channel)
          : undefined
        active = { mode: 'command', env: runEnv, channel, state, lookup }
      } catch {
        // Advisory — see above.
      }
    },

    async finish() {
      const run = active
      active = undefined
      if (run === undefined) return
      if (run.mode === 'long-running') {
        stop(run)
        return
      }
      try {
        await finishCommand(run)
      } catch {
        // Advisory — see `start`.
      }
    },

    abandon() {
      if (active !== undefined) stop(active)
      active = undefined
    },
  }
}
