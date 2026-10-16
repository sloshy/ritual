#!/usr/bin/env bun
import { setupGlobalFetch } from './src/util/http'
// Apply global fetch patch immediately
setupGlobalFetch()

import { CommanderError } from 'commander'
import { COMMAND_GROUPS } from './src/commands/registry'
import { shouldBackfillCardIds } from './src/commands/id-backfill'
import { checkWorkspaceMigrations } from './src/commands/migrate-check'
import { createUpdateNotice } from './src/commands/update-notice'
import { buildProgram } from './src/cli/program'
import { initI18n } from './src/cli/locale'
import { registerCliMessages } from './src/i18n/register/cli'
import { ExitCode, CardCommandError, getErrorMessage, isBrokenPipeError } from './src/util/errors'
import { markStdoutClosed, TEXT_ONLY } from './src/cli/output'
import { SyncMessageError } from './src/sync/message'
import { PreActionFailure, reportCommandFailure } from './src/cli/action'
import { isReleaseBuild } from './src/config/version'
import { removeLeftoverBinary } from './src/update/install'

// Wrapped in a function because the compiled binary (bun build --bytecode)
// does not support top-level await.
async function main(): Promise<void> {
  // `ritual … --output ndjson | head` closes stdout mid-stream. That is a normal
  // end of output for a Unix tool, not a failure: stop quietly instead of
  // dumping an EPIPE stack trace. The shared writers in
  // src/cli/output.ts absorb the synchronous throw; this handler covers
  // asynchronous emissions and any console.log that bypasses them.
  //
  // A throw from inside an emitter callback would escape the try/catch below as
  // an unhandled exception, so a genuine (non-EPIPE) stream failure is reported
  // here with the same runtime-error exit code the catch would have given it.
  const handleStreamError = (error: unknown): void => {
    if (isBrokenPipeError(error)) {
      // Every shared writer checks this flag, so the rest of the run produces
      // no further output. The exit code is deliberately left alone: a broken
      // pipe is not a failure, but it must not erase one the command already
      // recorded either.
      markStdoutClosed()
      return
    }
    process.stderr.write(`${getErrorMessage(error)}\n`)
    process.exitCode = ExitCode.RuntimeError
  }
  process.stdout.on('error', handleStreamError)
  process.stderr.on('error', (error: unknown) => {
    if (isBrokenPipeError(error)) return
    process.exitCode = ExitCode.RuntimeError
  })

  // Hand the runtime its English catalog. Namespaces are import boundaries,
  // so nothing is registered until a surface asks for it — the CLI
  // is the surface that asks for all seven. Must precede `initI18n()`, and
  // therefore every `t()` call in the process.
  registerCliMessages()

  // Resolve the UI locale before the command tree exists: Commander evaluates
  // help strings at registration time, so this is the last moment at which
  // `--help` can still be authored in the user's language. The preAction hook
  // re-resolves authoritatively once the flag and base dir are parsed.
  initI18n()
  const updateNotice = createUpdateNotice()
  const program = buildProgram({
    groups: COMMAND_GROUPS,
    backfill: shouldBackfillCardIds,
    workspaceCheck: checkWorkspaceMigrations,
    updateNotice,
  })

  // A Windows `self-update` cannot delete the binary it replaced while that
  // binary is still running, so the next start removes it. A no-op elsewhere.
  if (isReleaseBuild) await removeLeftoverBinary(process.execPath, process.platform)

  try {
    await program.parseAsync()
  } catch (error) {
    if (isBrokenPipeError(error)) {
      // See handleStreamError: benign end of output, existing exit code stands.
      markStdoutClosed()
    } else if (error instanceof CommanderError) {
      // Commander already printed its message (usage error, help, or version).
      process.exitCode = error.exitCode === 0 ? ExitCode.Success : ExitCode.UsageError
    } else if (error instanceof PreActionFailure) {
      // A refusal from the root `preAction` hook (a bad `--base-dir`, a
      // malformed `ritual.config.json`): reported in the invoked command's
      // output mode, an envelope under `--output json`, with its exit code.
      reportCommandFailure(error.scripting, error.cause)
    } else if (error instanceof CardCommandError || error instanceof SyncMessageError) {
      // A structured failure that escaped with no command in hand to report it
      // with: plain text, its own exit code (a `SyncMessageError` is a runtime
      // error) — the dispatch `runCommandAction` uses.
      reportCommandFailure(TEXT_ONLY, error)
    } else {
      // The last-resort net for anything else `parseAsync` itself throws.
      // Everything thrown inside a command action is caught by
      // `runCommandAction`, and the `preAction` hook's throws arrive above as a
      // `PreActionFailure`. An exit code the run already recorded stands.
      process.stderr.write(`${getErrorMessage(error)}\n`)
      if (!process.exitCode) process.exitCode = ExitCode.RuntimeError
    }
  } finally {
    // A command that threw skipped the postAction hook; its update lookup
    // must not keep the process alive after it.
    updateNotice.abandon()
  }
}

void main()
