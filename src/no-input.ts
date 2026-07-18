/**
 * Process-wide "never prompt" state, resolved once from the global `--no-input`
 * flag and the `RITUAL_NO_INPUT` environment variable (same override pattern as
 * `src/cache/config.ts`). Dependency-free so any layer — prompt helpers, the
 * Scryfall client, auth — can consult it without import cycles.
 */

let noInputOverride: boolean | undefined

/** `RITUAL_NO_INPUT` counts as set when it is non-empty after trimming. */
function envNoInput(envValue: string | undefined): boolean {
  return (envValue?.trim() ?? '') !== ''
}

/**
 * Resolve the effective no-input state from the CLI flag and the environment.
 * An explicit CLI value wins; otherwise `RITUAL_NO_INPUT` decides.
 */
export function resolveNoInput(
  cliValue: boolean | undefined,
  envValue: string | undefined = process.env.RITUAL_NO_INPUT,
): boolean {
  if (cliValue !== undefined) return cliValue
  return envNoInput(envValue)
}

/** Set (or, with `undefined`, clear) the resolved no-input state for this process. */
export function setNoInputOverride(value: boolean | undefined): void {
  noInputOverride = value
}

/**
 * Whether prompting is disabled for this process. Falls back to
 * `RITUAL_NO_INPUT` when {@link setNoInputOverride} never ran (e.g. code paths
 * exercised outside the CLI's preAction hook).
 */
export function isNoInput(): boolean {
  if (noInputOverride !== undefined) return noInputOverride
  return envNoInput(process.env.RITUAL_NO_INPUT)
}
