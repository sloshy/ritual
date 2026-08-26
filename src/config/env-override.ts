/**
 * The precedence rule every string-valued global option shares (`--base-dir` /
 * `RITUAL_BASE_DIR`, `--cache-server` / `RITUAL_CACHE_SERVER`): an explicit
 * flag wins, a blank/whitespace value on either source counts as unset, and
 * `undefined` means "no override requested".
 */
export function resolveStringOverride(
  cliValue: string | undefined,
  envValue: string | undefined,
): string | undefined {
  return cliValue?.trim() || envValue?.trim() || undefined
}
