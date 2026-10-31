/**
 * The one-time introduction to the `.sha256` sidecars: the first time a
 * command leaves a workspace holding a sidecar where it held none, one line
 * says what the files are for and that they belong in git.
 *
 * "First" is read from the workspace itself rather than remembered anywhere:
 * the preAction hook notes whether any list folder holds a `.sha256` file, and
 * the postAction hook prints only when that was "no" and is now "yes". So the
 * line appears once per workspace — on its first `new`, `import` or
 * `add-card`, whichever comes first — and never again once a sidecar exists.
 */
import * as fs from 'node:fs/promises'
import type { Command } from 'commander'
import { isCommandOrSubcommand, qualifiedCommandName } from '../cli/command-name'
import type { ActionNoticeHooks } from '../cli/program'
import { t } from '../i18n/t'
import { LIST_TYPES } from '../list/list-type'
import { dirForType } from '../list/resolve-list'
import { FILE } from '../util/cli-tokens'

/**
 * The commands that can write a workspace's first sidecar: the ones that
 * create a list, or rewrite a hand-made one through Ritual's writers. Opt-in,
 * like the card-ID backfill (`id-backfill.ts`), so a read-only command never
 * pays for the folder scan; matched with its subcommands (`deck-sync pull`).
 */
export const SIDECAR_NOTICE_COMMANDS: readonly string[] = [
  'new',
  'rename',
  'import',
  'import-account',
  'import-changes',
  'add-card',
  'remove-card',
  'set-card',
  'note',
  'move',
  'edit',
  'metadata',
  'categories',
  'set-list-image',
  'cleanup',
  'deck-sync',
  'collection-sync',
]

/** Whether any list folder (searched recursively) holds a `.sha256` sidecar. */
export async function workspaceHasSidecars(): Promise<boolean> {
  for (const type of LIST_TYPES) {
    let names: string[]
    try {
      names = await fs.readdir(dirForType(type), { recursive: true })
    } catch {
      continue
    }
    if (names.some((name) => name.endsWith(FILE.hashSidecar))) return true
  }
  return false
}

type GateOptions = { output?: string; quiet?: boolean; dryRun?: boolean }

/**
 * Whether this run could introduce the sidecars: a text-mode, non-quiet,
 * non-dry-run invocation of a command that can write one.
 */
function noticeApplies(actionCommand: Command): boolean {
  if (!isCommandOrSubcommand(qualifiedCommandName(actionCommand), SIDECAR_NOTICE_COMMANDS)) {
    return false
  }
  const { output, quiet, dryRun } = actionCommand.opts<GateOptions>()
  return (output === undefined || output === 'text') && quiet !== true && dryRun !== true
}

/**
 * The preAction/postAction pair `buildProgram` runs. `probe` is the workspace
 * check, injectable for tests.
 */
export function createSidecarNotice(
  probe: () => Promise<boolean> = workspaceHasSidecars,
): ActionNoticeHooks {
  let hadNone = false
  return {
    start: async (actionCommand) => {
      hadNone = noticeApplies(actionCommand) && !(await probe())
    },
    finish: async () => {
      if (!hadNone) return
      hadNone = false
      // stderr, like the update notice: stdout stays the command's own output.
      if (await probe())
        console.warn(t('cli.sidecarNotice.introduction', { file: FILE.hashSidecar }))
    },
  }
}
