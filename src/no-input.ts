/**
 * Process-wide "never prompt" state, resolved once from the global `--no-input`
 * flag and the `RITUAL_NO_INPUT` environment variable (same override pattern as
 * `src/cache/config.ts`), plus the guards every prompt-spawning surface shares.
 * Near the bottom of the dependency graph (the equally leaf `errors` module and
 * the browser-safe message catalog) so any layer — prompt helpers, the pager,
 * the Scryfall client, auth — can consult it without import cycles.
 *
 * `--no-input` is a **human** mode, not a machine dialect: its refusals are
 * localized like every other text-mode output. The machine dialect is
 * `--output json|ndjson`, whose payload keys, `code`, and `messageKey` stay
 * locale-invariant while `message` follows the locale.
 */

import { CardCommandError, ExitCode } from './errors'
import type { MessageKey } from './i18n/messages/en'
import { currentLocale } from './i18n/runtime'
import { t, tDynamic, type MessageParams, type RenderParams, type TranslateArgs } from './i18n/t'

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
  return isNoInput() ? t('cli.prompt.reason.noInput') : t('cli.prompt.reason.noTty')
}

/**
 * A catalog key naming *what* a refused prompt was going to ask for, as a short
 * **noun phrase** ("a card name", "a printing to add"), never a question.
 *
 * The distinction is the whole point. `Input required: <subject> (<reason>).` is
 * a declarative frame, and the old code spliced the prompt's own `message` —
 * "Which printing?" — straight into it. English tolerates that; most languages
 * do not, because the interrogative form of a phrase is not its nominal form.
 * Making the subject a separate key lets a translator write the noun phrase the
 * frame actually needs.
 */
export type PromptSubjectKey = Extract<MessageKey, `cli.prompt.subject.${string}`>

/** The two already-rendered halves of the refusal frame. */
type InputRequiredParams = MessageParams<'errors.input.required'>

/**
 * The one "a prompt was needed and could not run" error: a usage error naming
 * what the run should have supplied and which of the two causes applied. Every
 * prompt guard — {@link requireInteractive}, `ask`, `promptUser` — builds its
 * refusal here so the phrasing and the exit code cannot drift.
 *
 * Two spellings, because the conversion of ~15 prompt sites is incremental:
 *
 * - a {@link PromptSubjectKey} (with its params) — the converted form;
 * - a plain string — the transitional form, spliced verbatim as before. Every
 *   remaining caller of this overload is a prompt that has not yet been given a
 *   `subjectKey`.
 */
export function inputRequiredError<K extends PromptSubjectKey>(
  subjectKey: K,
  ...args: TranslateArgs<K>
): CardCommandError
export function inputRequiredError(subject: string): CardCommandError
export function inputRequiredError(subject: string, params?: RenderParams): CardCommandError {
  const messageParams: InputRequiredParams = {
    subject: isPromptSubjectKey(subject) ? renderSubject(subject, params) : subject,
    reason: promptsUnavailableReason(),
  }
  return new CardCommandError(
    'usage_error',
    t('errors.input.required', messageParams),
    ExitCode.UsageError,
    undefined,
    { key: 'errors.input.required', params: messageParams },
  )
}

/**
 * Whether a subject is a catalog key rather than literal prose. The namespace
 * prefix is what makes this unambiguous: no English noun phrase a call site
 * could pass begins with `cli.prompt.subject.`.
 */
function isPromptSubjectKey(subject: string): subject is PromptSubjectKey {
  return subject.startsWith('cli.prompt.subject.')
}

/**
 * Render a subject key with whatever params came in. The overloads above have
 * already type-checked the (key, params) pair against the catalog; the union of
 * subject keys cannot be re-checked inside a single implementation body, which
 * is exactly what {@link tDynamic} exists for.
 */
function renderSubject(key: PromptSubjectKey, params: RenderParams | undefined): string {
  return tDynamic(currentLocale(), key, params)
}

/**
 * Refuse to open an interactive picker when prompting is unavailable — stdin
 * is not a terminal, or `--no-input` disabled prompts. Without this, a script
 * that omits a selector either exits 0 having done nothing (closed stdin: the
 * prompt never resolves and the event loop drains) or blocks — never an
 * acceptable one-shot contract.
 *
 * `what` is the flag or argument the run should have carried; it is an English
 * identifier and is spliced into the localized "pass …" frame rather than
 * concatenated onto it.
 */
export function requireInteractive(what: string): void {
  if (promptsUnavailable()) throw inputRequiredError('cli.prompt.subject.pass', { what })
}
