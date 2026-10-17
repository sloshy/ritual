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

import { CardCommandError, ExitCode, messageCommandError } from './errors'
import type { MessageKey } from '../i18n/messages/en'
import type { ParameterlessKey } from '../i18n/t'
import {
  renderSyncParam,
  syncMessage,
  syncRef,
  type SyncArgs,
  type SyncMessageRef,
  type SyncParam,
} from '../sync/message'

let noInputOverride: boolean | undefined

/**
 * Spellings of "off" that a user setting `RITUAL_NO_INPUT=0` plainly means as
 * "leave prompting on" — treating them as "set" would turn the natural way to
 * disable the variable into the way to enable never-prompt mode.
 */
const FALSY_ENV_VALUES = new Set(['0', 'false', 'no', 'off'])

/**
 * A boolean environment variable (`RITUAL_NO_INPUT`, `CI`, `RITUAL_NO_UPDATE_CHECK`) counts as set when it is
 * non-empty after trimming and is not one of the {@link FALSY_ENV_VALUES} spellings (case-insensitive).
 */
export function envFlagSet(envValue: string | undefined): boolean {
  const value = envValue?.trim().toLowerCase() ?? ''
  if (value === '') return false
  return !FALSY_ENV_VALUES.has(value)
}

/**
 * Whether the process runs under continuous integration: `CI` is set, read with
 * the same spellings as `RITUAL_NO_INPUT` (so `CI=false` means "not CI"). CI
 * runs never get Ritual's unsolicited prompts, even on a pseudo-terminal.
 */
export function isCiEnvironment(envValue: string | undefined = process.env.CI): boolean {
  return envFlagSet(envValue)
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
  return envFlagSet(envValue)
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
  return envFlagSet(process.env.RITUAL_NO_INPUT)
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
  return renderSyncParam(promptsUnavailableReasonRef())
}

/** {@link promptsUnavailableReason} unrendered, to nest in a message. */
function promptsUnavailableReasonRef(): SyncMessageRef {
  return syncRef(isNoInput() ? 'cli.prompt.reason.noInput' : 'cli.prompt.reason.noTty')
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

/**
 * A {@link PromptSubjectKey} that takes no params — what a question names as
 * its `subjectKey`, since `ask` has nowhere to carry params for it.
 */
export type QuestionSubjectKey = Extract<PromptSubjectKey, ParameterlessKey>

/**
 * The one "a prompt was needed and could not run" error: a usage error naming
 * what the run should have supplied and which of the two causes applied. Every
 * prompt guard — {@link requireInteractive}, {@link requireFlag}, `ask` —
 * builds its refusal here so the phrasing and the exit code cannot drift.
 *
 * The subject and the reason nest as messages, so the CLI words the whole
 * refusal in its language while the `--output json` envelope's `messageParams`
 * carry their English, like every other keyed refusal.
 */
export function inputRequiredError<K extends PromptSubjectKey>(
  subjectKey: K,
  ...args: SyncArgs<K>
): CardCommandError {
  return inputRequired(syncRef(subjectKey, ...args))
}

/**
 * The transitional form of {@link inputRequiredError} for a prompt that has
 * not been given a `subjectKey` yet: its own question, already worded, spliced
 * in as the subject (in the envelope too — there is no English to carry).
 */
export function inputRequiredForQuestion(question: string): CardCommandError {
  return inputRequired(question)
}

function inputRequired(subject: SyncParam): CardCommandError {
  return messageCommandError(
    'usage_error',
    ExitCode.UsageError,
    syncMessage('errors.input.required', { subject, reason: promptsUnavailableReasonRef() }),
  )
}

/**
 * Refuse to open an interactive picker when prompting is unavailable — stdin
 * is not a terminal, or `--no-input` disabled prompts. Without this, a script
 * that omits a selector either exits 0 having done nothing (closed stdin: the
 * prompt never resolves and the event loop drains) or blocks — never an
 * acceptable one-shot contract.
 *
 * The subject is a catalog key, worded whole ("pass a list name", "pass
 * --skills or --no-skills"); a single flag to name goes through
 * {@link requireFlag} instead.
 */
export function requireInteractive<K extends PromptSubjectKey>(
  subjectKey: K,
  ...args: SyncArgs<K>
): void {
  if (promptsUnavailable()) throw inputRequiredError(subjectKey, ...args)
}

/**
 * A flag spelling, refused at compile time when it is shaped like a subject key
 * — so a key passed here by mistake cannot be spliced in as if it were a flag.
 */
type FlagSpelling<S extends string> = S extends `cli.${string}` ? never : S

/**
 * {@link requireInteractive} for a remedy that is one flag or argument, spelled
 * exactly as it is typed (`--yes`, `--finish <foil|nonfoil>`): a command-line
 * token with no words in it, never translated, spliced into the localized
 * "pass …" frame. Two flags joined by a conjunction are a subject key of their
 * own (`cli.prompt.subject.passEither` / `passBoth`), because the conjunction is
 * a word.
 */
export function requireFlag<S extends string>(flag: FlagSpelling<S>): void {
  requireInteractive('cli.prompt.subject.pass', { what: flag })
}
