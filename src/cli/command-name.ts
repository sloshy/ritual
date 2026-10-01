import type { Command } from 'commander'

/**
 * A command's name from the top-level command down, e.g. `deck-sync pull` or
 * `cache feed host` — the root program's own name is left out. The one way the
 * root preAction hook and its injected checks identify which command is about
 * to run, so a nested subcommand that happens to share a top-level name (a
 * hypothetical `cache migrate`) is never mistaken for it.
 */
export function qualifiedCommandName(actionCommand: Command): string {
  const names: string[] = []
  for (let command: Command | null = actionCommand; command?.parent; command = command.parent) {
    names.unshift(command.name())
  }
  return names.join(' ')
}
