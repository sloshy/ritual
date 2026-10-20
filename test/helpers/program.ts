/**
 * The real command tree, built in-process the way `ritual` builds it, for
 * suites that inspect it (help text, registered names) rather than run it.
 *
 * Its own module rather than `test/helpers/cli.ts`, which ~75 suites import:
 * building the tree loads every command module, and those suites need none.
 */

import type { Command } from 'commander'
import { buildProgram } from '../../src/cli/program'
import { COMMAND_GROUPS } from '../../src/commands/registry'
import { NO_UPDATE_NOTICE } from './cli'

/** Every registered command, as `ritual` builds it, with no hook that touches a workspace. */
export function realProgram(): Command {
  return buildProgram({
    groups: COMMAND_GROUPS,
    backfill: () => false,
    workspaceCheck: () => Promise.resolve(),
    updateNotice: NO_UPDATE_NOTICE,
  })
}

/**
 * The command `path` names below `program` (`['cache', 'feed', 'host']`), or the
 * deepest one it reaches when a name is not a subcommand — what commander would
 * run for that argv.
 */
export function commandAt(program: Command, path: readonly string[]): Command {
  let command = program
  for (const name of path) {
    const next = command.commands.find((sub) => sub.name() === name)
    if (next === undefined) break
    command = next
  }
  return command
}

/** Every command below `program`, keyed by its path joined with spaces (`''` for the root). */
export function commandsByPath(program: Command): Map<string, Command> {
  const found = new Map<string, Command>([['', program]])
  const walk = (command: Command, path: readonly string[]): void => {
    for (const sub of command.commands) {
      const subPath = [...path, sub.name()]
      found.set(subPath.join(' '), sub)
      walk(sub, subPath)
    }
  }
  walk(program, [])
  return found
}
