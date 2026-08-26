#!/usr/bin/env bun
import { setupGlobalFetch } from './src/util/http'
// Apply global fetch patch immediately
setupGlobalFetch()

import { CommanderError } from 'commander'
import { COMMAND_GROUPS } from './src/commands/registry'
import { shouldBackfillCardIds } from './src/commands/id-backfill'
import { buildProgram } from './src/cli/program'
import { initI18n } from './src/cli/locale'
import { registerCliMessages } from './src/i18n/register/cli'
import { ExitCode, CardCommandError, getErrorMessage, isBrokenPipeError } from './src/util/errors'
import { markStdoutClosed } from './src/cli/output'

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

  // Hand the runtime its English catalog. Namespaces are import boundaries
  // (plan §4.2), so nothing is registered until a surface asks for it — the CLI
  // is the surface that asks for all seven. Must precede `initI18n()`, and
  // therefore every `t()` call in the process.
  registerCliMessages()

  // Resolve the UI locale before the command tree exists: Commander evaluates
  // help strings at registration time, so this is the last moment at which
  // `--help` can still be authored in the user's language. The preAction hook
  // re-resolves authoritatively once the flag and base dir are parsed.
  initI18n()
  const program = buildProgram({ groups: COMMAND_GROUPS, backfill: shouldBackfillCardIds })

  try {
    await program.parseAsync()
  } catch (error) {
    if (isBrokenPipeError(error)) {
      // See handleStreamError: benign end of output, existing exit code stands.
      markStdoutClosed()
    } else if (error instanceof CommanderError) {
      // Commander already printed its message (usage error, help, or version).
      process.exitCode = error.exitCode === 0 ? ExitCode.Success : ExitCode.UsageError
    } else if (error instanceof CardCommandError) {
      // A structured failure that escaped its command (or came from the
      // preAction hook) carries its own exit code — 2 for usage errors — which
      // the generic branch below would flatten to 1.
      process.stderr.write(`${error.message}\n`)
      process.exitCode = error.exitCode
    } else {
      process.stderr.write(`${getErrorMessage(error)}\n`)
      if (!process.exitCode) process.exitCode = ExitCode.RuntimeError
    }
  }
}

void main()
