/**
 * How the card-cache refresh question should be resolved for a command run,
 * selected by the shared `--refresh <mode>` option (`addRefreshOption` in
 * `src/cli/options.ts`).
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

/** Whether a full Scryfall bulk download is permitted under this mode. */
export function bulkAllowed(mode: RefreshMode): boolean {
  return mode === 'ask' || mode === 'auto'
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
 * A run's refresh mode plus the way its `ask` questions get answered. The
 * gates in `freshness.ts` and `cardkingdom/ensure.ts` take one of these rather
 * than prompting themselves: the CLI's policy (`src/cli/refresh-policy.ts`)
 * asks on the terminal, a server's ({@link headlessPolicy}) always declines,
 * and a test's records what was asked.
 */
export type RefreshPolicy = {
  mode: RefreshMode
  confirm: (prompt: BulkRefreshPrompt) => Promise<boolean>
}

/**
 * Decide whether to run a bulk cache download under a policy: `auto` always
 * accepts, `no-bulk`/`never` always decline, and `ask` puts the question to
 * the policy's `confirm`.
 */
export async function decideBulkRefresh(
  policy: RefreshPolicy,
  prompt: BulkRefreshPrompt,
): Promise<boolean> {
  switch (policy.mode) {
    case 'auto':
      return true
    case 'no-bulk':
    case 'never':
      return false
    case 'ask':
      return policy.confirm(prompt)
  }
}

/** A policy with nobody to ask: every `ask` question is declined. */
export function headlessPolicy(mode: RefreshMode): RefreshPolicy {
  return { mode, confirm: async () => false }
}
