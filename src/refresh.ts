import prompts from 'prompts'
import { Command } from 'commander'
import { promptsUnavailable } from './no-input'
import { parseEnumFlag } from './commands/scripting'

/**
 * How the card-cache refresh question should be resolved for a command run,
 * selected by the shared `--refresh <mode>` option ({@link addRefreshOption}).
 *
 * - `ask` (the default): prompt interactively. When prompts are unavailable
 *   (`--no-input` / `RITUAL_NO_INPUT`, or stdin is not a terminal) the refresh
 *   is skipped — never guessed — so a non-interactive context can neither hang
 *   on an unanswerable prompt nor trigger a surprise bulk download.
 * - `auto`: refresh when stale, including the fast Scryfall bulk download.
 * - `no-bulk`: refresh stale prices per-card, but never trigger a bulk download.
 * - `never`: never refresh; use the existing cache as-is.
 */
export const REFRESH_MODES = ['ask', 'auto', 'no-bulk', 'never'] as const
export type RefreshMode = (typeof REFRESH_MODES)[number]

/** Parse a `--refresh <mode>` value, rejecting anything but the four modes. */
export function parseRefreshFlag(value: string): RefreshMode {
  return parseEnumFlag(value, REFRESH_MODES, 'refresh mode')
}

/**
 * Register the shared `--refresh <mode>` option (default `ask`). Every command
 * that touches card-cache freshness uses this so the vocabulary never drifts.
 * (The `cache feed` subcommands' unrelated `--refresh <interval>` is not this.)
 *
 * `description` overrides the help text for commands where `ask` does not mean
 * "skip when prompts are unavailable" — `collection-sync`'s CSV-upload gate
 * fails the run instead, and `build-site`'s empty/stale-cache bulk download
 * runs without asking. A command whose help describes the wrong behavior is
 * worse than no help.
 */
export function addRefreshOption(command: Command, description?: string): Command {
  return command.option(
    '--refresh <mode>',
    description ??
      'Card cache refresh policy: ask (prompt; skip when prompts are unavailable), auto, no-bulk, never',
    parseRefreshFlag,
    'ask' as RefreshMode,
  )
}

/** Whether a full Scryfall bulk download is permitted under this mode. */
export function bulkAllowed(mode: RefreshMode): boolean {
  return mode === 'ask' || mode === 'auto'
}

/**
 * Structured output must stay parseable, so never mix prompts into it: an
 * unanswerable `ask` refresh downgrades to `never`. `output` is the command's
 * `--output` value — anything but `text` is structured (json, ndjson, csv).
 */
export function resolveRefreshMode(refresh: RefreshMode, output: string): RefreshMode {
  return output !== 'text' && refresh === 'ask' ? 'never' : refresh
}

/** Whether merely-stale (but cached) prices should be refetched per-card. */
export function refreshStaleAllowed(mode: RefreshMode): boolean {
  return mode !== 'never'
}

export type BulkRefreshPrompt = {
  message: string
  initial: boolean
}

/**
 * Decide whether to run a bulk cache download under a given mode.
 *
 * - `auto` always accepts; `no-bulk`/`never` always decline.
 * - `ask` prompts interactively. When prompts are unavailable (`--no-input` or
 *   stdin is not a terminal) it always declines — never the prompt's default —
 *   so a headless run can't be surprised by a multi-MB download; an empty cache
 *   then surfaces through the caller's `ready: false` error path.
 */
export async function shouldBulkRefresh(
  mode: RefreshMode,
  { message, initial }: BulkRefreshPrompt,
): Promise<boolean> {
  if (mode === 'auto') return true
  if (mode === 'no-bulk' || mode === 'never') return false
  if (promptsUnavailable()) return false
  const response = await prompts({ type: 'confirm', name: 'value', message, initial })
  return response.value === true
}
