/**
 * The prompt shapes `src/commands/prompts-helpers.ts` works in, kept apart from
 * the helpers themselves so any module can name them without importing the
 * `prompts` runtime.
 */

import type prompts from 'prompts'
import type { PromptSubjectKey } from '../util/no-input'

/** Shared type for the `onState` callback parameter used with the `prompts` library. */
export type PromptState = { exited: boolean }

/**
 * Options the `prompts` library reads but does not declare in its published
 * types. `noMatches` is real (`lib/elements/autocomplete.js` defaults it to
 * `'no matches found'`) and is one of the few English strings the library lets
 * a caller replace; `@types/prompts` simply never listed it.
 *
 * Its multiselect `\nInstructions:\n` block has no such hook and cannot be
 * overridden without vendoring the library — an accepted, documented gap, since
 * the CLI contains exactly one multiselect.
 */
export type UndeclaredPromptOptions = {
  /** Row shown in place of the choice list when an autocomplete matches nothing. */
  noMatches?: string
}

/**
 * Every English string the `prompts` library will let a caller replace, filled
 * in on every prompt so a session never speaks two languages. `active` and
 * `inactive` are the toggle prompt's labels; `noMatches` is the autocomplete's
 * empty state. Options the prompt itself sets always win over these.
 */
export type PromptLibraryStrings = {
  noMatches: string
  active: string
  inactive: string
}

/**
 * A question for {@link module:commands/prompts-helpers.ask}: everything the
 * `prompts` library accepts (minus the `name`, which the helper owns), plus the
 * undeclared options above and Ritual's own `subjectKey`.
 */
export type AskQuestion = Omit<prompts.PromptObject<'value'>, 'name'> &
  UndeclaredPromptOptions & {
    /**
     * A short **noun phrase** naming what this prompt is for, used when
     * `--no-input` refuses to open it: "Input required: {subject} (…)".
     *
     * Not the prompt's own `message`. A question spliced into that declarative
     * frame is ungrammatical in most languages once translated — and often in
     * English too ("Input required: Which printing? (…)"). A prompt without a
     * `subjectKey` still falls back to its `message`, which is what every
     * unconverted prompt does today.
     */
    subjectKey?: PromptSubjectKey
  }
