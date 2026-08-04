import type { Command } from 'commander'
import type { HistoryOptions } from './history'
import type { ServeCliOptions } from './serve'
import type { DryRunOptions } from './scripting'

/**
 * Commands whose action writes list files or consumes persisted `&N` card IDs —
 * only these trigger the file-writing ID backfill (`ensureCardIdsForAllLists`)
 * in the root preAction hook. Everything else (read-only commands, the
 * new/rename/delete lifecycle, cache/config/legal surfaces, and front-matter-
 * only writers like `metadata`, which touch list files but never their card
 * lines) must leave card lines untouched, so a new command defaults to NOT
 * backfilling.
 *
 * Matched on the action command's leaf name, or on `"<parent> <leaf>"` for a
 * subcommand that must be named with its parent — so nested subcommands (e.g.
 * `admin setup`, `cache feed host`, `deck-sync status`) stay exempt unless
 * listed themselves. `deck-sync` spells its directions as subcommands, so the
 * two that write list files are listed as `deck-sync pull` / `deck-sync push`;
 * its read-only `status` and its front-matter-only `link` are not.
 *
 * `detect-changes` is deliberately absent even though it reads `&N`: it must
 * see the working tree exactly as the user committed it, so IDs it has no way
 * to match against the old revision are left to a later backfill rather than
 * invented mid-diff. Its `--hash-only` and `--verify` modes are exempt for the
 * same reason — a backfill before stamping or reporting would hash content the
 * user never wrote, and `--verify` must write nothing at all.
 *
 * When editing this list, keep the prose enumerations in sync: the
 * "card-ID backfill" section in docs-site/src/content/docs/index.mdx, the
 * Backfill policy paragraph in AGENTS.md, and the `&N` bullet in
 * src/skills/content/overview.ts.
 */
export const COMMANDS_WITH_ID_BACKFILL = [
  // Editors and one-shot card mutations — target cards by `&N` ID and write
  // list files.
  'edit',
  'add-card',
  'remove-card',
  'set-card',
  'note',
  'move',
  // `history` embeds card IDs in rewritten changelog lines; the read-only
  // `--show` fork is skipped in shouldBackfillCardIds.
  'history',
  // Importers and syncs write list files.
  'import',
  'import-account',
  'import-changes',
  'deck-sync pull',
  'deck-sync push',
  'collection-sync',
  // Rewrites every list file into canonical form.
  'cleanup',
  // The site build and the admin/MCP servers rely on every card line having a
  // persisted ID (trade page, admin editors). Plain `serve` (no --build/--api)
  // is skipped in shouldBackfillCardIds.
  'build-site',
  'serve',
  'admin',
  'mcp',
] as const

export type BackfillCommandName = (typeof COMMANDS_WITH_ID_BACKFILL)[number]

const BACKFILL_COMMAND_NAMES: ReadonlySet<string> = new Set(COMMANDS_WITH_ID_BACKFILL)

type ServeModeOptions = Pick<ServeCliOptions, 'build' | 'api'>
type HistoryShowOptions = Pick<HistoryOptions, 'show'>

/**
 * Whether the root preAction hook should run the card-ID backfill for this
 * invocation. `actionCommand` is the command whose action is about to run.
 */
export function shouldBackfillCardIds(actionCommand: Command): boolean {
  const leaf = actionCommand.name()
  const parent = actionCommand.parent?.name()
  if (
    !BACKFILL_COMMAND_NAMES.has(leaf) &&
    !(parent !== undefined && BACKFILL_COMMAND_NAMES.has(`${parent} ${leaf}`))
  ) {
    return false
  }
  // Plain `serve` only serves a prebuilt dist/ and must not write; with
  // --build it rebuilds from the list files, and with --api it reads them
  // live — the backfill applies to both.
  if (leaf === 'serve') {
    const serveOptions = actionCommand.opts<ServeModeOptions>()
    if (serveOptions.build !== true && serveOptions.api !== true) {
      return false
    }
  }
  // `history --show` is the documented read-only path — it must write nothing.
  if (leaf === 'history' && actionCommand.opts<HistoryShowOptions>().show === true) {
    return false
  }
  // A dry run must write nothing — including the card-ID backfill.
  if (actionCommand.opts<DryRunOptions>().dryRun === true) {
    return false
  }
  return true
}
