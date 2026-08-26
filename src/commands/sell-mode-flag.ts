/**
 * The shared `--sell-mode` flag: one registration, one application rule, for
 * every command that can turn sell mode on for its own run.
 *
 * Follows `addRefreshOption`'s precedent (`src/refresh.ts`) — the flag exists on
 * `build-site`, `serve`, `admin` and `mcp`, and the rule it applies (enable-only,
 * set before *anything* reads sell mode) is subtle enough that four hand-written
 * copies were already drifting. The help text stays a per-command `t()` key:
 * the commands describe genuinely different consequences of the same switch.
 */

import type { Command } from 'commander'
import { setSiteSellModeOverride } from '../config/ritual-config'

/**
 * The flag's commander attribute name. Exported so `serve`'s build-only-flags
 * guard can exempt it without restating the string.
 */
export const SELL_MODE_OPTION_NAME = 'sellMode'

/** The parsed shape every command that registers the flag receives. */
export type SellModeOptions = {
  sellMode?: boolean
}

/**
 * Register `--sell-mode` on a command. `helpText` is the command's own already
 * translated description of what enabling it does there.
 */
export function addSellModeOption(command: Command, helpText: string): Command {
  return command.option('--sell-mode', helpText)
}

/**
 * Apply a run's `--sell-mode` to the session.
 *
 * Enable-only: an absent flag leaves whatever the config (or an outer
 * `serve`/`admin` run) decided, so this can never turn sell mode *off*. Call it
 * as the first thing in the action body — the buylist warm, the build, and
 * every request's `getSiteSellMode` read all follow the override.
 */
export function applySellModeOverride(options: SellModeOptions): void {
  if (options.sellMode === true) setSiteSellModeOverride(true)
}
