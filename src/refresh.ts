import prompts from 'prompts'

/**
 * How the card-cache refresh question should be resolved for a command run.
 *
 * The build/serve/admin commands only ever ask one yes/no question — whether to
 * refresh the Scryfall card cache — so the answer is modeled as a dedicated mode
 * rather than a generic confirmation.
 *
 * - `ask`: prompt interactively (the default for direct CLI use). Falls back to
 *   the prompt's default answer when stdin is not a TTY, so a non-interactive
 *   context (e.g. `bun run dev`, where the orchestrator owns the terminal)
 *   never hangs on an unanswerable prompt.
 * - `allow` (`--allow-refresh`): refresh when stale, including the fast Scryfall
 *   bulk download.
 * - `no-bulk` (`--allow-refresh-no-bulk`): refresh stale prices per-card, but
 *   never trigger a bulk download.
 * - `none` (`--no-refresh`): never refresh; use the existing cache as-is.
 */
export type RefreshMode = 'ask' | 'allow' | 'no-bulk' | 'none'

/** CLI flags (as parsed by Commander) that select a {@link RefreshMode}. */
export type RefreshFlags = {
  /** `--allow-refresh`. */
  allowRefresh?: boolean
  /** `--allow-refresh-no-bulk`. */
  allowRefreshNoBulk?: boolean
  /** Commander stores `--no-refresh` as `refresh: false` (negated boolean). */
  refresh?: boolean
}

/** Resolve the {@link RefreshMode} selected by the `--*-refresh` flags. */
export function refreshMode(flags: RefreshFlags): RefreshMode {
  if (flags.allowRefreshNoBulk) return 'no-bulk'
  if (flags.allowRefresh) return 'allow'
  if (flags.refresh === false) return 'none'
  return 'ask'
}

/** Whether a full Scryfall bulk download is permitted under this mode. */
export function bulkAllowed(mode: RefreshMode): boolean {
  return mode === 'ask' || mode === 'allow'
}

/** Whether merely-stale (but cached) prices should be refetched per-card. */
export function refreshStaleAllowed(mode: RefreshMode): boolean {
  return mode !== 'none'
}

export type BulkRefreshPrompt = {
  message: string
  initial: boolean
}

/**
 * Decide whether to run a bulk cache download under a given mode.
 *
 * - `allow` always accepts; `no-bulk`/`none` always decline.
 * - `ask` prompts interactively, or returns `initial` when stdin is not a TTY
 *   rather than issuing a prompt that would hang forever.
 */
export async function shouldBulkRefresh(
  mode: RefreshMode,
  { message, initial }: BulkRefreshPrompt,
): Promise<boolean> {
  if (mode === 'allow') return true
  if (mode === 'no-bulk' || mode === 'none') return false
  if (!process.stdin.isTTY) return initial
  const response = await prompts({ type: 'confirm', name: 'value', message, initial })
  return response.value === true
}
