/**
 * Process-wide "never prompt" state, resolved once from the global `--no-input`
 * flag and the `RITUAL_NO_INPUT` environment variable (same override pattern as
 * `src/cache/config.ts`), plus the guards every prompt-spawning surface shares.
 * A dependency leaf (only the equally leaf `errors` module) so any layer —
 * prompt helpers, the pager, the Scryfall client, auth — can consult it without
 * import cycles.
 */

import { CardCommandError, ExitCode } from './errors'

let noInputOverride: boolean | undefined

/**
 * Spellings of "off" that a user setting `RITUAL_NO_INPUT=0` plainly means as
 * "leave prompting on" — treating them as "set" would turn the natural way to
 * disable the variable into the way to enable never-prompt mode.
 */
const FALSY_ENV_VALUES = new Set(['0', 'false', 'no', 'off'])

/**
 * `RITUAL_NO_INPUT` counts as set when it is non-empty after trimming and is
 * not one of the {@link FALSY_ENV_VALUES} spellings (case-insensitive).
 */
function envNoInput(envValue: string | undefined): boolean {
  const value = envValue?.trim().toLowerCase() ?? ''
  if (value === '') return false
  return !FALSY_ENV_VALUES.has(value)
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

/**
 * Whether interactive prompting is unavailable for this process: `--no-input`
 * (or `RITUAL_NO_INPUT`) disabled prompts, or stdin is not a terminal. The
 * single source of truth for the prompt gate — every surface that can spawn a
 * prompt (or a pager waiting on a keypress) must consult this rather than
 * re-deriving the condition inline, so the `--no-input` half can never be
 * dropped from one copy.
 */
export function promptsUnavailable(): boolean {
  return isNoInput() || !process.stdin.isTTY
}

/**
 * Why prompting is unavailable, phrased to sit in the parenthetical of an
 * `Input required: … (<reason>)` message. The two causes need different
 * remedies — supply the missing flags vs. reconsider `--no-input` — so the
 * guards must not describe a redirected stdin as "prompts are disabled".
 */
export function promptsUnavailableReason(): string {
  return isNoInput()
    ? 'prompts are disabled by --no-input / RITUAL_NO_INPUT'
    : 'no terminal available for prompts'
}

/**
 * The one "a prompt was needed and could not run" error: a usage error whose
 * message names what the run should have supplied and which of the two causes
 * applied. Every prompt guard — {@link requireInteractive}, `ask`, `promptUser`
 * — builds its refusal here so the phrasing and the exit code cannot drift.
 * `what` completes the sentence "Input required: …" (e.g. `pass --finish
 * <foil|nonfoil>`, or the prompt's own question).
 */
export function inputRequiredError(what: string): CardCommandError {
  return new CardCommandError(
    'usage_error',
    `Input required: ${what} (${promptsUnavailableReason()}).`,
    ExitCode.UsageError,
  )
}

/**
 * Refuse to open an interactive picker when prompting is unavailable — stdin
 * is not a terminal, or `--no-input` disabled prompts. Without this, a script
 * that omits a selector either exits 0 having done nothing (closed stdin: the
 * prompt never resolves and the event loop drains) or blocks — never an
 * acceptable one-shot contract.
 */
export function requireInteractive(what: string): void {
  if (promptsUnavailable()) throw inputRequiredError(`pass ${what}`)
}
