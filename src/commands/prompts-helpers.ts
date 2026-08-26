import prompts, { type Choice } from 'prompts'
import type { AskQuestion, PromptLibraryStrings, PromptState } from './prompts-types'
import { LIST_TYPES, type ListType } from '../list/list-type'
import { inputRequiredError, isNoInput, promptsUnavailable } from '../util/no-input'
import { t } from '../i18n/t'
import { getLogger } from '../util/logger'
import { canPromptWithOutput, type ScriptingOptions } from './scripting'
import { matchesChoiceTerms, matchesChoiceTitleTerms } from './menu-search'

type PromptAnswer = { value?: unknown }

/**
 * The `suggest` callback for an autocomplete whose choices are titled with a
 * leading icon (list pickers, menus): every whitespace-separated term of the
 * input must appear somewhere in the title — or in the English terms a
 * translated row carries alongside it. The library's default filter is a
 * prefix match, which such a title can never satisfy.
 */
export async function suggestByTitleTerms(rawInput: unknown, choices: Choice[]): Promise<Choice[]> {
  const input = String(rawInput)
  if (!input) return choices
  return choices.filter((choice) => matchesChoiceTitleTerms(choice, input))
}

/** A `prompts` autocomplete `suggest` callback. */
type SuggestCallback = (rawInput: unknown, choices: Choice[]) => Promise<Choice[]>

/** How a card prompt whose choice list also holds menu rows filters itself. */
export type MenuAwareSuggestOptions = {
  /** Tells a menu row from a card row; menu rows stay visible while filtering. */
  isMenuChoice: (choice: Choice) => boolean
  /** What an empty input shows: only the menu rows, or every row. */
  emptyShows: 'menu' | 'all'
}

/**
 * The `suggest` callback for an autocomplete that mixes menu rows with card
 * rows. Card rows match under card-name terms — case-, diacritic- and
 * punctuation-insensitive, and segmented for scripts that are typed without
 * spaces — which is what makes the move session's search agree with the card
 * sessions' on names like `Æther Vial`.
 */
export function suggestCardsWithMenu(options: MenuAwareSuggestOptions): SuggestCallback {
  return async (rawInput, choices) => {
    const input = String(rawInput).trim()
    if (!input) return options.emptyShows === 'all' ? choices : choices.filter(options.isMenuChoice)
    return choices.filter(
      (choice) => options.isMenuChoice(choice) || matchesChoiceTerms(choice, input),
    )
  }
}

/**
 * The `prompts` library's own English, rendered in the active locale. Resolved
 * per prompt rather than once at module load, because a module-level table
 * would freeze in whatever language was active when this file was first
 * imported.
 */
function promptLibraryStrings(): PromptLibraryStrings {
  return {
    noMatches: t('cli.prompt.noMatches'),
    active: t('cli.prompt.toggleOn'),
    inactive: t('cli.prompt.toggleOff'),
  }
}

/**
 * Run a single `prompts` question and return its answer, or `undefined` when
 * the user cancels (Ctrl-C / Esc). Wraps the library's `onState` exit-detection
 * dance so wizard-style commands don't have to repeat it per question.
 *
 * Every prompt in the CLI passes through here, which makes this the one place
 * the library's own English is overridden and the one place `--no-input`
 * refusals are phrased. A question's `subjectKey` names what it wanted as a
 * noun phrase; without one the refusal falls back to splicing the question
 * itself, which is what every not-yet-converted prompt does.
 */
export async function ask<T>(question: AskQuestion): Promise<T | undefined> {
  if (promptsUnavailable()) {
    if (question.subjectKey !== undefined) throw inputRequiredError(question.subjectKey)
    const label =
      typeof question.message === 'string'
        ? question.message
        : t('cli.prompt.subject.interactiveInput')
    throw inputRequiredError(label)
  }
  let exited = false
  const { subjectKey: _subjectKey, ...libraryQuestion } = question
  const response = (await prompts({
    ...promptLibraryStrings(),
    ...libraryQuestion,
    name: 'value',
    onState: (state: PromptState) => {
      if (state.exited) exited = true
    },
  })) as PromptAnswer
  if (exited || response.value === undefined) return undefined
  return response.value as T
}

/**
 * Read the password from stdin, draining it fully and stripping exactly one
 * trailing newline (`\r?\n`). Deliberately NOT `readLinesFromStdin` from
 * card.ts — that helper trims and filters lines, which would corrupt
 * passwords containing leading/trailing whitespace.
 */
export async function readPasswordFromStdin(): Promise<string> {
  const chunks: Uint8Array[] = []
  for await (const chunk of process.stdin as AsyncIterable<Uint8Array>) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
    .toString('utf-8')
    .replace(/\r?\n$/, '')
}

/**
 * Ask which list type an import targets, or `undefined` when the user cancels.
 * Shared by the `import` command's text and CSV paths so the wording never drifts.
 */
export async function promptListType(): Promise<ListType | undefined> {
  return ask<ListType>({
    type: 'select',
    message: t('cli.import.promptListType'),
    subjectKey: 'cli.prompt.subject.listType',
    // The rows are the persisted type slugs themselves, not display names: the
    // answer is what gets written, and showing the slug is what makes the two
    // obviously the same thing.
    choices: LIST_TYPES.map((type) => ({ title: type, value: type })),
  })
}

/**
 * What {@link resolveImportPrintings} decides from. An options object rather
 * than positional booleans: the flag and the deck's own answer have opposite
 * consequences, and the scripting envelope has to ride along for the
 * prompt-vs-JSON-output guard.
 */
export type ImportPrintingsQuestion = {
  /**
   * `--sync-printings` (true) / `--no-sync-printings` (false), or undefined
   * when neither was given.
   */
  flag: boolean | undefined
  /**
   * Whether there is anything to keep or strip; `import-account` passes true,
   * since Archidekt decks always state editions.
   */
  deckStatesPrintings: boolean
  /** The run's output envelope — a JSON payload cannot share stdout with a prompt. */
  scripting: ScriptingOptions
}

/**
 * Whether a URL import keeps the exact printings — set, collector number, and
 * finish — the source service states, shared by `import` and `import-account`
 * so the question and its non-interactive behavior never drift.
 *
 * An explicit flag answers outright. Otherwise, a deck stating no printing has
 * nothing to decide (kept vacuously); under `--no-input` the import keeps the
 * command's historical behavior — the printings are kept — but says so, the
 * same softening `import` applies to its list-type prompt; and interactively
 * the user is asked (default yes). Without a terminal, or when JSON/NDJSON
 * output owns stdout, the unanswerable question is refused with the flags to
 * pass. Returns `undefined` when the prompt is cancelled.
 */
export async function resolveImportPrintings(
  question: ImportPrintingsQuestion,
): Promise<boolean | undefined> {
  if (question.flag !== undefined) return question.flag
  if (!question.deckStatesPrintings) return true
  if (isNoInput()) {
    getLogger().info(t('cli.import.defaultedToPrintings'))
    return true
  }
  // ask() itself refuses when prompts are unavailable; this adds the other
  // half of the shared rule — a machine-readable stream owns stdout, so a
  // prompt must not be drawn over it even on a TTY.
  if (!canPromptWithOutput(question.scripting)) {
    throw inputRequiredError('cli.prompt.subject.syncPrintings')
  }
  return ask<boolean>({
    type: 'confirm',
    message: t('cli.import.promptSyncPrintings'),
    subjectKey: 'cli.prompt.subject.syncPrintings',
    initial: true,
  })
}

/**
 * Prompt for a free-text filter value, prefilled with the current one. An
 * empty submission clears the filter (returns undefined); cancelling the
 * prompt keeps the current value. Shared by the price browser and the export
 * wizard filter screens.
 */
export async function promptTextFilter(
  message: string,
  current: string | undefined,
): Promise<string | undefined> {
  const value = await ask<string>({
    type: 'text',
    message,
    subjectKey: 'cli.prompt.subject.filterValue',
    initial: current ?? '',
  })
  if (value === undefined) return current
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/** The user's pick from the shared editor exit menu. */
export type ExitMenuChoice = 'save' | 'discard' | 'cancel'

/**
 * The shared "you have unsaved changes" exit menu used by every interactive
 * editor (the card sessions, `move`, and `history`). Editors call this when
 * the user exits with unsaved changes; cancelling the prompt itself
 * (Esc / Ctrl-C) counts as Cancel, so the editor keeps running. The change
 * count is shown when given and positive; omit it (or pass 0) when the caller
 * only knows that *something* is unsaved.
 */
export async function promptExitMenu(changeCount?: number): Promise<ExitMenuChoice> {
  const message =
    changeCount !== undefined && changeCount > 0
      ? t('cli.exitMenu.promptCounted', { count: changeCount })
      : t('cli.exitMenu.prompt')
  const choice = await ask<ExitMenuChoice>({
    type: 'select',
    message,
    subjectKey: 'cli.prompt.subject.exitChoice',
    choices: [
      { title: `✅ ${t('cli.menu.saveAndExit')}`, value: 'save' },
      { title: `🚪 ${t('cli.menu.exitWithoutSaving')}`, value: 'discard' },
      { title: `← ${t('cli.menu.cancelKeepEditing')}`, value: 'cancel' },
    ],
  })
  return choice ?? 'cancel'
}
