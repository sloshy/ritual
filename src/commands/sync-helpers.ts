/**
 * CLI plumbing shared by the two Archidekt sync commands, `deck-sync` and
 * `collection-sync`.
 *
 * Both take the same `<direction>` positional and `--only` filter, silence
 * progress the same way under scripted output, and refuse to sync a file
 * holding lines the parser could not read until the user says otherwise. The
 * only thing that differs is what each command calls the things it syncs (decks
 * or collection lists) and what accepting the loss of those lines costs — both
 * passed in as an {@link UnreadableSubject} and a cost clause.
 */

import { ArchidektAuth } from '../auth/ArchidektAuth'
import { FileTokenStore } from '../auth/FileTokenStore'
import { getLogger, STDERR_LOGGER, type Logger } from '../logger'
import { isNoInput } from '../no-input'
import {
  SYNC_CHANGE_FILTERS,
  SYNC_DIRECTIONS,
  type SyncChangeFilter,
  type SyncDirection,
  type UnreadableSource,
} from '../sync-common'
import { ask } from './prompts-helpers'
import {
  addDryRunOption,
  emitError,
  ExitCode,
  parseEnumFlag,
  type ScriptingOptions,
} from './scripting'
import type { Command } from 'commander'

/** Commander argParser for the `<direction>` positional: only push/pull are valid. */
export function parseSyncDirection(value: string): SyncDirection {
  return parseEnumFlag(value, SYNC_DIRECTIONS, 'direction')
}

/** Commander argParser for `--only`: additions or removals, nothing else. */
export function parseSyncChangeFilter(value: string): SyncChangeFilter {
  return parseEnumFlag(value, SYNC_CHANGE_FILTERS, 'change filter')
}

/**
 * Register the `<direction>` positional and the `--only` / `-y, --yes` /
 * `--dry-run` options both sync commands take, so their spellings, argParsers,
 * and help text cannot drift. `subject` is the plural noun the `--yes` text
 * names (`decks`, `collection lists`); each command adds its own remaining
 * arguments and options around this call.
 */
export function addSyncOptions(command: Command, subject: string): Command {
  return addDryRunOption(
    command
      .argument(
        '<direction>',
        "Sync direction: 'push' (local → Archidekt) or 'pull' (Archidekt → local)",
        parseSyncDirection,
      )
      .option(
        '-y, --yes',
        `Sync ${subject} with unreadable lines without asking (those lines are lost)`,
        false,
      )
      .option(
        '--only <changes>',
        "Apply only 'additions' or 'removals' (relative to the sync destination)",
        parseSyncChangeFilter,
      ),
    'Report what would sync without writing files or pushing changes',
  )
}

/** Warnings and errors still print, progress info does not. */
function quietLogger(base: Logger): Logger {
  return {
    info() {},
    progress() {},
    warn: base.warn.bind(base),
    error: base.error.bind(base),
  }
}

/**
 * Pick the logger for a run. Under `--output json`/`ndjson` the report owns
 * stdout, so progress is dropped but warnings and errors go to stderr — a run
 * refused for unreadable lines has to be able to say why, and stderr is where
 * that belongs (see `STDERR_LOGGER`). `--quiet` gets the same treatment on the
 * normal logger.
 */
export function loggerFor(scripting: ScriptingOptions): Logger {
  if (scripting.output !== 'text') return quietLogger(STDERR_LOGGER)
  return scripting.quiet ? quietLogger(getLogger()) : getLogger()
}

export type { UnreadableSource }

/**
 * Whether a sync command can prompt at all: it owns stdout (text output rather
 * than a JSON/NDJSON report), prompts are enabled, and there is a terminal to
 * ask on. Shared by every question a sync asks — the unreadable-lines
 * confirmation and the ambiguous-removal session — so the two can never disagree
 * about whether a run is interactive. Callers add their own extra conditions
 * (a dry run resolves nothing, `--yes` answers up front).
 */
export function canPromptDuringSync(scripting: ScriptingOptions): boolean {
  return scripting.output === 'text' && !isNoInput() && process.stdin.isTTY === true
}

/** A resolved Archidekt session: the access token, plus the account it belongs to. */
export type ArchidektSession = {
  token: string
  account: { id: number; username: string }
}

/** Emit a structured runtime error and set the exit code, as a refusal helper. */
function refuseRun(message: string, scripting: ScriptingOptions): null {
  emitError('runtime_error', message, scripting)
  process.exitCode = ExitCode.RuntimeError
  return null
}

/**
 * The stored Archidekt access token, or null after emitting the structured error
 * and setting the exit code — so both sync commands refuse an unauthenticated
 * run identically.
 */
export async function requireArchidektToken(scripting: ScriptingOptions): Promise<string | null> {
  const token = await new ArchidektAuth(new FileTokenStore()).getToken()
  if (token) return token
  return refuseRun('Not signed into Archidekt. Run "ritual login archidekt" first.', scripting)
}

/**
 * {@link requireArchidektToken} plus the account the login recorded. A
 * collection belongs to an account rather than to a file, so a collection sync
 * needs the numeric user id; a deck sync addresses decks by id and does not.
 */
export async function requireArchidektSession(
  scripting: ScriptingOptions,
): Promise<ArchidektSession | null> {
  const auth = new ArchidektAuth(new FileTokenStore())
  const token = await auth.getToken()
  if (!token) {
    return refuseRun('Not signed into Archidekt. Run "ritual login archidekt" first.', scripting)
  }
  const user = await auth.getStoredUser()
  if (!user) {
    return refuseRun(
      'The stored Archidekt login does not name an account. Re-run "ritual login archidekt" to record it.',
      scripting,
    )
  }
  return { token, account: { id: user.id, username: user.username } }
}

/** What a sync command calls the things it syncs, for the messages below. */
export type UnreadableSubject = {
  /** Singular noun, e.g. `deck`. */
  one: string
  /** Plural noun, e.g. `decks`. */
  many: string
}

/** `1 deck` / `3 collection lists` — a count with the right noun. */
function countOf(count: number, subject: UnreadableSubject): string {
  return `${count} ${count === 1 ? subject.one : subject.many}`
}

/**
 * The full picture of what syncing these files would cost: every file, every
 * line the parser could not read. Shown before the confirmation so the choice is
 * made against the actual lines, not a count.
 */
export function describeUnreadable(
  sources: readonly UnreadableSource[],
  subject: UnreadableSubject,
  /** The sentence explaining what this direction would do to the listed lines. */
  consequence: string,
): string {
  const lines = sources.flatMap((source) => [
    `  ${source.file} ("${source.name}"):`,
    ...source.warnings.map((warning) => `    ${warning}`),
  ])
  const verb = sources.length === 1 ? 'contains' : 'contain'
  return [
    `${countOf(sources.length, subject)} ${verb} lines Ritual cannot read.`,
    consequence,
    ...lines,
  ].join('\n')
}

export type UnreadableConfirmation = {
  /** The files holding lines the parser could not read. */
  sources: readonly UnreadableSource[]
  subject: UnreadableSubject
  /** The clause completing "Sync 2 decks anyway, …?" — what accepting costs. */
  cost: string
  /**
   * `--yes`, answering the prompt up front. Taken as a bare flag rather than the
   * whole command options object: `ScriptingOptions` is assignable to those, so
   * an options/scripting mix-up at the call site would type-check and silently
   * disable `--yes`.
   */
  yes: boolean
  scripting: ScriptingOptions
  logger: Logger
}

/**
 * Ask whether the files with unreadable lines may sync anyway (the lines the run
 * just listed are what accepting costs). `--yes` answers it up front. Without a
 * terminal — `--no-input`, a pipe, or json/ndjson output, which owns stdout —
 * there is nobody to ask, so the answer is no and those files fail.
 */
export async function confirmUnreadableSync(
  confirmation: UnreadableConfirmation,
): Promise<boolean> {
  const { sources, subject, cost, yes, scripting, logger } = confirmation
  if (yes) return true

  if (!canPromptDuringSync(scripting)) {
    logger.error(
      `Confirmation required: pass --yes to sync these ${subject.many} non-interactively (${cost}), or fix the lines first.`,
    )
    return false
  }

  return (
    (await ask<boolean>({
      type: 'confirm',
      message: `Sync ${countOf(sources.length, subject)} anyway, ${cost}?`,
      initial: false,
    })) === true
  )
}
