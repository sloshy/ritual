import prompts, { type Choice } from 'prompts'
import { compareData } from '../i18n/collate'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { compareCollectorNumbers, getAllCardNames, getAllPrintings } from '../scryfall'
import { formatPrintingLabel } from '../printing-key'
import {
  matchesCollectorQuery,
  parseCollectorQuery,
  type PrintingSearchTerms,
} from '../collector-query'
import { emptyCacheAdvice, refreshCardCacheForSession } from '../cache/freshness'
import type { RefreshMode } from '../refresh'
import type { Condition, Finish, ScryfallCard } from '../types'
import { conditionLabel, isCondition, isFinish, VALID_CONDITIONS } from '../finish-condition'
import type { PromptState } from './prompts-types'
import { appendChangelog } from '../changelog-writer'
import { createSetNoteChange, type ChangeEvent, type MoveToChange } from '../change-event'
import type { CardArtRef } from '../card-art'
import { writeFileWithHash } from '../content-hash'
import { formatSetCodesForDisplay, parseSetCodesInput } from '../set-codes'
import { rankNameMatches } from '../term-match'
import type { MessageKey } from '../i18n/messages/en'
import { DEFAULT_LOCALE } from '../i18n/runtime'
import { t, tIn, type TranslateArgs } from '../i18n/t'
import { matchesChoiceTerms } from './menu-search'
import { promptExitMenu } from './prompts-helpers'
import { ExitCode } from './scripting'
import { isListMarkdownFile } from '../list-file-name'

/**
 * Shared engine for the unified `edit` command's interactive card-entry
 * sessions. Owns everything the three list types have in common — the
 * autocomplete loop, menu construction, entry modes, the collector-mode
 * printing pool, session filters, and save/exit/changelog plumbing — and delegates the
 * list-type-specific flows (printing/finish/condition prompts, change
 * application, copy semantics) to a {@link CardSessionStrategy}.
 */

// ── Session config ──────────────────────────────────────────────────

export type EntryMode = 'name' | 'collector'

/** Session-wide filters and entry-mode state shared by all card-entry commands. */
export type SessionConfig = {
  sets?: string[]
  // Deliberately no `language` default alongside `finish`: the configured
  // `defaultLanguage` already is the session-wide default (adds never prompt
  // for language), and per-entry deviations go through the printing picker's
  // availability confirm or the Change Language edit action — a per-session
  // language filter would just duplicate the config key.
  finish?: Finish
  condition?: Condition | 'NONE'
  entryMode: EntryMode
  /**
   * The built collector-mode autocomplete rows — every printing the cache holds
   * under the session's set filter — or null before the first collector-mode
   * prompt. Cached here rather than rebuilt per loop iteration because the pool
   * spans the whole card cache, and shared across every list a unified session
   * has open. {@link applySessionConfigAnswers} clears it when the set filter
   * moves, since the filter is what decides which printings belong to it.
   */
  collectorChoices: CollectorChoice[] | null
}

// ── Menu sentinels ──────────────────────────────────────────────────

/**
 * The menu sentinel values (e.g. `__EXIT__`). Matched by exact membership rather
 * than a `__` prefix check, because real card names can begin with underscores
 * (e.g. the Unstable card `_____ Goblin`) and must not be mistaken for menu items.
 */
const MENU_SENTINEL_VALUES = [
  '__ADD_ANOTHER__',
  '__ADD_SIMILAR__',
  '__ADD_NOTE__',
  '__SECTION__',
  '__FORMAT__',
  '__TAGS__',
  '__LIST_LABELS__',
  '__CONFIG__',
  '__COLLECTOR_MODE__',
  '__NAME_MODE__',
  '__EDIT_MODE__',
  '__ADD_MODE__',
  '__SAVE__',
  '__SAVE_CURRENT__',
  '__SWITCH_LIST__',
  '__EXIT__',
  '__EDIT_LAST__',
  '__UNDO_LAST__',
  '__UNDO_EDIT__',
  '__CHANGES__',
] as const satisfies readonly `__${string}__`[]

/**
 * A session-menu shortcut value, as opposed to a card name. Produce menu
 * choices through {@link menuItem} and compare against a narrowed value of this
 * type, so a typo'd sentinel is a compile error rather than a string that
 * silently falls through to the card-name path at runtime.
 */
export type MenuSentinel = (typeof MENU_SENTINEL_VALUES)[number]

/** Widened to `Set<string>` so membership checks accept arbitrary prompt input. */
const MENU_SENTINELS = new Set<string>(MENU_SENTINEL_VALUES)

/** A session-menu choice, its value pinned to a real sentinel. Assignable to {@link Choice}. */
export type MenuChoice = {
  title: string
  value: MenuSentinel
  /**
   * English terms that also select this row, so the typing a user has in their
   * fingers keeps working after the menu is translated. Under English these
   * equal the title and change nothing. See `menu-search.ts`.
   */
  searchAliases: string[]
}

/** Build a session-menu choice, constraining the value to a real sentinel. */
export function menuItem(
  title: string,
  value: MenuSentinel,
  searchAliases: string[] = [],
): MenuChoice {
  return { title, value, searchAliases }
}

/**
 * Build a session-menu choice from a catalog key, rendering the label in the
 * active locale and recording its English rendering as a search alias in the
 * same call. Keeping the two together is the point: an alias derived from the
 * catalog cannot fall out of date with its label the way a hand-written list
 * would, and a new menu row gets muscle-memory search for free.
 *
 * `icon` is decoration, not text: it stays out of the catalog so it cannot be
 * translated away, and out of the `maxLen` budget, which measures the words.
 */
function menuRow<K extends MessageKey>(
  icon: string,
  value: MenuSentinel,
  key: K,
  ...args: TranslateArgs<K>
): MenuChoice {
  return menuItem(`${icon} ${t(key, ...args)}`, value, [tIn(DEFAULT_LOCALE, key, ...args)])
}

/** Whether a prompt value is exactly a known sentinel (vs. a card name or object choice). */
export function isMenuSentinel(value: unknown): value is MenuSentinel {
  return typeof value === 'string' && MENU_SENTINELS.has(value)
}

/** A choice is a menu item (vs. a card) when its value is exactly a known sentinel. */
export const isMenuChoice = (choice: Choice): boolean => isMenuSentinel(choice.value)

/** Narrow a prompt selection to the menu sentinel it is, or null for a card/entry choice. */
export const asMenuSentinel = (value: unknown): MenuSentinel | null =>
  isMenuSentinel(value) ? value : null

/**
 * Suffix a name-mode `!` selection carries on its choice value to force the
 * option prompts. Not a {@link MenuSentinel}: it rides on a card-name value
 * rather than being a selection of its own, and is stripped before the name is
 * used. Menu items never carry it ({@link suggestNameMode} exempts them).
 */
const FORCE_SUFFIX = '__FORCE__'

// ── Choice values & prompt responses ────────────────────────────────

/** A collector-mode autocomplete choice value: one specific printing. */
type CollectorChoiceValue = { type: 'card'; card: ScryfallCard }
/**
 * A collector-mode row with its match fields precomputed. The pool spans every
 * printing in the cache and `suggest` runs on every keystroke, so lowercasing
 * the set code and collector number is done once, at build time, rather than
 * over the whole pool per character typed. `prompts` hands the very choice
 * objects it was given to `suggest`, so the extra fields survive the round trip.
 */
export type CollectorChoice = PrintingSearchTerms & {
  title: string
  value: CollectorChoiceValue
}
/** An edit-mode autocomplete choice value: an existing entry, targeted by card ID. */
type EntryChoiceValue = { type: 'entry'; cardId: number }
/** The card-entry prompt resolves to a menu sentinel/card-name string, a collector choice, or an entry. */
type CardSelectionResponse = { cardName?: string | CollectorChoiceValue | EntryChoiceValue }

type NotePromptResponse = { note?: string }
type ConfirmPromptResponse = { confirm?: boolean }
/** The session-changes picker resolves to an item index, null (Back), or undefined (escaped). */
type ChangeIndexPromptResponse = { index?: number | null }

// ── Session context & strategy ──────────────────────────────────────

/**
 * Whether the session is adding new cards (autocomplete over the card database)
 * or editing existing entries (autocomplete over the list's current entries).
 * Toggled from the session menu; orthogonal to the name/collector {@link EntryMode}.
 */
export type SessionMode = 'add' | 'edit'

/**
 * An existing list entry offered in the edit-mode picker. The engine treats
 * `cardId` as opaque and hands it straight back to
 * {@link CardSessionStrategy.editEntry} — a multi-list scope exploits that to
 * issue synthetic keys, since card ids are only unique within one list.
 */
export type EditableEntryItem = { label: string; cardId: number }

/** The most recently added/edited card, tracked for the menu shortcuts. */
export type LastAdded = { name: string; hasNote: boolean; cardId?: number }

/** The list file a session writes, and the display name recorded in its changelog. */
export type ListSaveTarget = { filePath: string; listName: string }

/** Mutable per-session state owned by the engine and shared with the strategy. */
export type CardSessionContext = {
  /** Change events accumulated for the session changelog. */
  sessionChanges: ChangeEvent[]
  /** Index into {@link sessionChanges} of the entry an edit would update in place. */
  lastChangeIndex: number | null
  lastAdded: LastAdded | null
  /** Consecutive copies of {@link lastAdded} added this streak. */
  lastAddedCount: number
  /**
   * Whether this session has already written a changelog block. Once true, later
   * saves merge into that block (one changelog entry per session) rather than
   * appending a new one. Never reset mid-session — only a new session clears it.
   */
  hasSavedChangelog: boolean
}

/** Create a fresh session context. Multi-list sessions own one per open list. */
export function createCardSessionContext(): CardSessionContext {
  return {
    sessionChanges: [],
    lastChangeIndex: null,
    lastAdded: null,
    lastAddedCount: 0,
    hasSavedChangelog: false,
  }
}

/**
 * A card added during the current session, for the Undo Last Add shortcut and
 * the session-changes list. `label` is the full rendered line shown in the
 * picker; `name` is the bare card name used in the "Undo Last Add" shortcut.
 */
export type SessionAddItem = { label: string; name: string }

/**
 * One change made this session, as shown in the View Session Changes picker.
 * `blocked` carries the reason the change cannot be discarded right now (a
 * newer change touches the same card), or is undefined when it can be.
 */
export type SessionChangeItem = { label: string; blocked?: string }

/**
 * Why the engine is invoking {@link CardSessionStrategy.handleCard}:
 *
 * - `add` — a fresh add; a multi-list scope asks which list it should go to.
 * - `edit-last` — a re-entry of the last added card that replaces its options
 *   in place rather than adding a copy.
 * - `similar-copy` — a re-entry of the last added card to add a copy with
 *   different options.
 *
 * Both re-entry intents act on the list the last added card went into, so a
 * multi-list scope must route them there rather than asking for a destination.
 */
export type CardChoiceIntent = 'add' | 'edit-last' | 'similar-copy'

/** Input to {@link CardSessionStrategy.handleCard} once the engine has resolved a selection. */
export type CardChoiceInput = {
  cardName: string
  /** Printing preselected via collector mode, or null in name mode. */
  preselected: ScryfallCard | null
  /** Force the finish/condition prompts even when session defaults would apply. */
  forcePrompts: boolean
  intent: CardChoiceIntent
}

/**
 * The {@link CardChoiceInput} for the Add Similar Copy shortcut: re-enter the
 * add flow for the last added card with the prompts forced, so the user can
 * pick a different printing, finish, or condition (and, for a deck without a
 * pinned target section, a different section) for this copy.
 */
export function similarCopyInput(lastAdded: LastAdded): CardChoiceInput {
  return {
    cardName: lastAdded.name,
    preselected: null,
    forcePrompts: true,
    intent: 'similar-copy',
  }
}

/**
 * The list-type-specific half of a card-entry session. Implementations close
 * over their list model (deck structure or flat entry array + ID pool) and apply
 * every mutation as a {@link ChangeEvent} to the in-memory model. Nothing is
 * written to disk until the engine asks the strategy to {@link CardSessionStrategy.persist}
 * (the Save menu action or the save-and-exit choice in the exit menu); exiting
 * without saving instead discards the in-memory state.
 */
export type CardSessionStrategy = {
  /** Used in exit messages, e.g. `collection manager`. */
  managerLabel: string
  /**
   * Where {@link saveCardSession} writes this session, or null for a strategy
   * that spans several lists (a multi-list scope) and so has no file of its own —
   * such a session is saved one open list at a time, through each list's own
   * strategy.
   */
  saveTarget: ListSaveTarget | null
  sessionConfig: SessionConfig
  /** Extra menu entries inserted after the note shortcut in both modes. */
  extraMenuItems?: () => MenuChoice[]
  /** Handle a strategy-specific sentinel; any sentinel it does not recognize is ignored. */
  handleSentinel?: (ctx: CardSessionContext, value: MenuSentinel) => Promise<void>
  /** Re-prompt session filters and return the reloaded card-name list. */
  updateConfig: (excludeDigitalOnly: boolean) => Promise<string[]>
  /** Apply a change to the in-memory list model (not written to disk until {@link persist}). */
  applyChange: (change: ChangeEvent) => void
  /**
   * Receive the destination side of a cross-list move: add the moved card to
   * the in-memory model with a card id of this list's own (the event's cardId
   * is the *source* list's, kept for the changelog only). Called by the save
   * path when a saved list's `move-from` targets a list that is open in the
   * editor.
   *
   * `art` is the moved card's custom art in the source list, if it had any: the
   * strategy files it under the id it just allocated, so the art follows the
   * card the way it does on the on-disk move paths.
   */
  receiveMove: (change: MoveToChange, art?: CardArtRef) => void
  /** Write the in-memory list model to the list file. */
  persist: () => Promise<void>
  /** Whether the in-memory model differs from what was last written to disk. */
  hasUnsavedChanges: () => boolean
  /** Reset session-scoped tracking (session adds, undo stacks) after a mid-session save. */
  sessionSaved: () => void
  /** Run the full add/edit flow for a selected card. */
  handleCard: (ctx: CardSessionContext, input: CardChoiceInput) => Promise<void>
  /** Add another copy of the last added card. */
  addAnotherCopy: (ctx: CardSessionContext) => Promise<void>
  /** Notify the strategy that the engine applied a note to the last added card. */
  noteAdded?: (note: string) => void
  /** The cards added this session, in add order, for the Undo Last Add shortcut. */
  listSessionAdds?: () => SessionAddItem[]
  /** Discard the session add at `index` into {@link listSessionAdds}, re-packing ids. */
  discardSessionAdd?: (ctx: CardSessionContext, index: number) => Promise<void>
  /** Every change made this session (adds, edits, removals), for the View Session Changes picker. */
  listSessionChanges: () => SessionChangeItem[]
  /** Discard the session change at `index` into {@link listSessionChanges}. */
  discardSessionChange: (ctx: CardSessionContext, index: number) => Promise<void>
  /**
   * The list itself was discarded (its creation was taken back from the session
   * changes), so there is nothing left to edit. The session loop leaves for the
   * list selection menu when this turns true.
   */
  discarded?: () => boolean
  /** The list's current entries, for the edit-mode picker. */
  listEntries: () => EditableEntryItem[]
  /** Run the edit flow (action menu and prompts) for the entry with `cardId`. */
  editEntry: (ctx: CardSessionContext, cardId: number) => Promise<void>
  /** Label for the Undo Last Edit menu item, or null when there is no edit to undo. */
  lastEditUndoLabel: () => string | null
  /** Undo the most recent edit-mode operation. */
  undoLastEdit: (ctx: CardSessionContext) => Promise<void>
}

// ── Shared startup helpers ──────────────────────────────────────────

/**
 * Apply the `--refresh` freshness policy before a session, then load the
 * card-name list for autocomplete, logging progress. Returns null (after
 * telling the user to preload) when the Scryfall cache is empty.
 */
export async function prepareCardSessionCache(
  mode: RefreshMode,
  sets: string[] | undefined,
  excludeDigitalOnly: boolean,
): Promise<string[] | null> {
  await refreshCardCacheForSession(mode)
  return loadCardNamesOrWarn(sets, excludeDigitalOnly)
}

/**
 * Load the card-name list for autocomplete, logging progress. Returns null (after
 * telling the user to preload) when the Scryfall cache is empty.
 */
async function loadCardNamesOrWarn(
  sets: string[] | undefined,
  excludeDigitalOnly: boolean,
): Promise<string[] | null> {
  console.log(t('cli.session.loadingCards'))
  const cardNames = await getAllCardNames({ sets, excludeDigitalOnly })
  if (cardNames.length === 0) {
    console.error(emptyCacheAdvice(t('cli.session.cacheEmpty')))
    process.exitCode = ExitCode.RuntimeError
    return null
  }
  console.log(t('cli.session.loadedCards', { count: cardNames.length }))
  return cardNames
}

/**
 * Ensure `fileName` exists in `dir`, creating it (and the directory) with
 * `initialContent` and a content hash when missing. Returns the resolved path.
 */
export async function ensureListFile(
  dir: string,
  fileName: string,
  initialContent: string,
  label: string,
): Promise<string> {
  await fs.mkdir(dir, { recursive: true })
  const filePath = path.join(dir, fileName)
  if (!(await Bun.file(filePath).exists())) {
    await writeFileWithHash(filePath, initialContent)
    console.log(t('cli.session.createdFile', { label, file: fileName }))
  } else {
    console.log(t('cli.session.usingFile', { label, file: fileName }))
  }
  return filePath
}

/** List the `.md` files in a flat-list directory (excluding change files), as bare names. */
export async function listMarkdownNames(dir: string): Promise<string[]> {
  await fs.mkdir(dir, { recursive: true })
  const files = await fs.readdir(dir)
  return files.filter(isListMarkdownFile).map((f) => f.replace('.md', ''))
}

/** The CLI flags every card-entry command shares for its initial session filters. */
export type SessionConfigFlags = {
  finish?: string
  condition?: string
  collector?: boolean
}

/**
 * Build the initial session config from the shared CLI flags, validating the
 * finish/condition strings through the domain guards. `--collector` only picks
 * the entry mode: the collector pool is built lazily, the first time a prompt
 * is actually shown in that mode.
 */
export function buildInitialSessionConfig(
  options: SessionConfigFlags,
  parsedSets: string[] | undefined,
): SessionConfig {
  const upperCondition = options.condition?.toUpperCase()
  return {
    sets: parsedSets,
    finish: isFinish(options.finish) ? options.finish : undefined,
    condition: isCondition(upperCondition) ? upperCondition : undefined,
    entryMode: options.collector ? 'collector' : 'name',
    collectorChoices: null,
  }
}

// ── Session filter configuration ────────────────────────────────────

/** Answers shared by every session-filter prompt (deck adds a section question on top). */
export type SessionConfigAnswers = {
  sets?: string[]
  finish?: string
  condition?: string
}

/**
 * The session-filter questions common to all card-entry commands: set filter,
 * default finish, and (optionally) default condition.
 */
export function buildSessionConfigQuestions(
  config: SessionConfig,
  includeCondition: boolean,
): prompts.PromptObject[] {
  const questions: prompts.PromptObject[] = [
    {
      type: 'text',
      name: 'sets',
      message: t('cli.session.promptSetFilter'),
      initial: config.sets ? formatSetCodesForDisplay(config.sets) : '',
      format: (val: string) => parseSetCodesInput(val),
    },
    {
      type: 'select',
      name: 'finish',
      message: t('cli.session.promptDefaultFinish'),
      // The values are the persisted finish slugs and never move; only the
      // rows' titles are localized.
      choices: [
        { title: t('cli.session.finishAlwaysPrompt'), value: '' },
        { title: t('cli.session.finishNonfoil'), value: 'nonfoil' },
        { title: t('cli.session.finishFoil'), value: 'foil' },
        { title: t('cli.session.finishEtched'), value: 'etched' },
      ],
      initial: config.finish ? ['', 'nonfoil', 'foil', 'etched'].indexOf(config.finish) : 0,
    },
  ]
  if (includeCondition) {
    questions.push({
      type: 'select',
      name: 'condition',
      message: t('cli.session.promptDefaultCondition'),
      choices: [
        { title: t('cli.session.conditionAlwaysPrompt'), value: '' },
        { title: t('cli.session.conditionDontCare'), value: 'NONE' },
        ...VALID_CONDITIONS.map((c) => ({ title: conditionLabel(c), value: c })),
      ],
      initial: 0,
    })
  }
  return questions
}

/**
 * Whether two session set filters select the same printings. Order is
 * irrelevant — the filter is a set — so a re-ordered answer must not throw the
 * collector pool away.
 */
function sameSetFilter(before: string[] | undefined, after: string[] | undefined): boolean {
  if (before === undefined || after === undefined) return before === after
  if (before.length !== after.length) return false
  const sortedBefore = [...before].sort(compareData)
  const sortedAfter = [...after].sort(compareData)
  return sortedBefore.every((code, index) => code === sortedAfter[index])
}

/**
 * Write the shared session-filter answers back onto the config. The raw prompt
 * strings are validated through the domain guards; an empty string (or any
 * unexpected value) clears the default back to "always prompt".
 *
 * This is the one place the session's set filter moves, so it is also where the
 * collector-mode pool is invalidated — the filter decides which printings are
 * in it.
 */
export function applySessionConfigAnswers(
  config: SessionConfig,
  answers: SessionConfigAnswers,
): void {
  if (answers.sets !== undefined) {
    const sets = answers.sets.length > 0 ? answers.sets : undefined
    if (!sameSetFilter(config.sets, sets)) config.collectorChoices = null
    config.sets = sets
  }
  if (answers.finish !== undefined) {
    config.finish = isFinish(answers.finish) ? answers.finish : undefined
  }
  if (answers.condition !== undefined) {
    config.condition =
      answers.condition === 'NONE'
        ? 'NONE'
        : isCondition(answers.condition)
          ? answers.condition
          : undefined
  }
}

/** Reload the autocomplete card names after the set filter may have changed. */
export async function reloadCardNames(
  config: SessionConfig,
  excludeDigitalOnly: boolean,
): Promise<string[]> {
  console.log(t('cli.session.reloadingCards'))
  const cardNames = await getAllCardNames({ sets: config.sets, excludeDigitalOnly })
  console.log(t('cli.session.loadedCards', { count: cardNames.length }))
  return cardNames
}

/**
 * The full "Configure Session Filters" flow shared by the collection and wanted
 * commands (the deck command composes its extra target-section question on top).
 * Updates `config` in place and returns the reloaded card-name list.
 */
export async function promptSessionConfigUpdate(
  config: SessionConfig,
  includeCondition: boolean,
  excludeDigitalOnly: boolean,
): Promise<string[]> {
  const answers = (await prompts(
    buildSessionConfigQuestions(config, includeCondition),
  )) as SessionConfigAnswers
  applySessionConfigAnswers(config, answers)
  const cardNames = await reloadCardNames(config, excludeDigitalOnly)
  console.log(t('cli.session.filtersUpdated'))
  return cardNames
}

// ── Edit-mode action menu ───────────────────────────────────────────

/** One option in an edit-mode per-entry action menu. */
export type EditActionChoice = { title: string; value: string }
type EditActionPromptResponse = { action?: string }

const CANCEL_ACTION = '__CANCEL__'

/**
 * Prompt for the edit action to run on the selected entry. Returns the chosen
 * action value, or null when cancelled/escaped.
 */
export async function promptEditAction(
  entryLabel: string,
  actions: EditActionChoice[],
): Promise<string | null> {
  let isExited = false
  const response = (await prompts({
    type: 'select',
    name: 'action',
    message: t('cli.session.promptEditEntry', { entry: entryLabel }),
    choices: [...actions, { title: `← ${t('cli.menu.cancel')}`, value: CANCEL_ACTION }],
    onState: (state: PromptState) => {
      if (state.exited) isExited = true
    },
  })) as EditActionPromptResponse
  if (isExited || !response.action || response.action === CANCEL_ACTION) return null
  return response.action
}

/** A confirmed note edit: the new (trimmed) note and the value it replaces. */
export type NoteEdit = { note: string; before: string }

/**
 * Prompt for an existing entry's note (empty input clears it). Returns null when
 * the prompt is cancelled or the note is unchanged.
 */
export async function promptNoteEdit(currentNote: string | undefined): Promise<NoteEdit | null> {
  const response = (await prompts({
    type: 'text',
    name: 'note',
    message: t('cli.session.promptNoteEdit'),
    initial: currentNote ?? '',
  })) as NotePromptResponse
  if (response.note === undefined) return null
  const note = response.note.trim()
  const before = currentNote ?? ''
  return note === before ? null : { note, before }
}

// ── Menu construction & suggestion filtering ────────────────────────

/**
 * Cross-list pending-change counts for the unified editor's menu labels. When
 * present, Save flushes every open list (and a separate "save current list"
 * item appears once another list also has pending changes), and a Switch List
 * item lets the user back out to the list selection menu.
 */
export type MultiListMenuInfo = {
  /** Pending changes across every open list, including the current one. */
  totalChangeCount: number
  /** How many open lists have anything unsaved (pending events or a dirty model). */
  listsWithChanges: number
  /**
   * The session edits several lists at once (a multi-list scope), so there is no
   * single "current list" to save on its own — Save always means save all.
   */
  scoped?: boolean
}

/** Inputs to {@link buildMenuChoices}. */
export type MenuBuildInput = {
  sessionMode: SessionMode
  mode: EntryMode
  lastAdded: LastAdded | null
  changeCount: number
  /** Strategy-specific entries inserted after the note shortcut. */
  extraItems: Choice[]
  /** Cards added this session, in add order (drives the Undo Last Add item). */
  sessionAdds: SessionAddItem[]
  /** Label for the Undo Last Edit item, or null when there is no edit to undo. */
  editUndoLabel: string | null
  /** Total changes this session (drives the View Session Changes item). */
  sessionChangeCount: number
  /** Card-name, collector-number, or existing-entry choices appended after the menu entries. */
  cardChoices: Choice[]
  /**
   * The list model differs from disk beyond the tracked change events (e.g. a
   * deck format change). Surfaces the Save items even at a zero change count.
   */
  dirty?: boolean
  /** Present in a unified multi-list session: cross-list counts for the save/switch items. */
  multiList?: MultiListMenuInfo
}

/** The Save label: the change count when there is one, plain otherwise (dirty-only saves). */
function saveItem(changeCount: number): MenuChoice {
  return changeCount > 0
    ? menuRow('💾', '__SAVE__', 'cli.menu.save', { count: changeCount })
    : menuRow('💾', '__SAVE__', 'cli.menu.saveDirty')
}

/** The Save/Switch List menu entries, which differ between single- and multi-list sessions. */
function buildSaveAndSwitchItems(input: MenuBuildInput): Choice[] {
  const { changeCount, multiList } = input
  const currentUnsaved = changeCount > 0 || input.dirty === true
  if (!multiList) {
    return currentUnsaved ? [saveItem(changeCount)] : []
  }

  const items: Choice[] = []
  if (multiList.listsWithChanges > 1) {
    // With only dirty models and no tracked change events, a "0 across N
    // lists" count would misread as nothing to save, so drop the count.
    const lists = t('domain.count.lists', { count: multiList.listsWithChanges })
    const scope =
      multiList.totalChangeCount > 0
        ? t('cli.menu.saveAllScope', { count: multiList.totalChangeCount, lists })
        : lists
    items.push(menuRow('💾', '__SAVE__', 'cli.menu.saveAll', { scope }))
    if (currentUnsaved && !multiList.scoped) {
      items.push(
        changeCount > 0
          ? menuRow('💾', '__SAVE_CURRENT__', 'cli.menu.saveCurrent', { count: changeCount })
          : menuRow('💾', '__SAVE_CURRENT__', 'cli.menu.saveCurrentPlain'),
      )
    }
  } else if (multiList.listsWithChanges === 1) {
    // Only one list has anything unsaved, so save-all and save-current coincide.
    items.push(saveItem(multiList.totalChangeCount))
  }
  items.push(menuRow('🔀', '__SWITCH_LIST__', 'cli.menu.switchList'))
  return items
}

/**
 * How many rows the card prompt shows at once. It must be at least as tall as
 * the longest menu {@link buildMenuChoices} can build (a deck session showing
 * every shortcut), or Save and Exit — the items at its foot — would sit below
 * the fold. A new conditional menu item therefore has to be raised here and in
 * the maximal input of the "tallest possible menu" test that guards it.
 */
export const SESSION_MENU_LIMIT = 18

/**
 * Build the full autocomplete choice list (menu shortcuts first, then cards).
 *
 * The menu is ordered by how likely the user is to want an item right now:
 * everything about the card they just touched comes first (add a copy, note it,
 * edit it, take it back), then the undo shortcuts, then the session-wide
 * settings, then reviewing and saving, and finally Exit — a destination nobody
 * should hit by overshooting.
 */
export function buildMenuChoices(input: MenuBuildInput): Choice[] {
  const {
    sessionMode,
    mode,
    lastAdded,
    extraItems,
    sessionAdds,
    editUndoLabel,
    sessionChangeCount,
    cardChoices,
  } = input
  // Emoji whose glyph renders double-width carry a second space, so the labels
  // beside them still line up. That padding is layout, not text, which is why
  // the icons live here rather than in the catalog.
  // Both modes lead with the session filters: in collector mode the set filter
  // is what narrows the printing pool, so it is the set-code control too.
  const modeItems: Choice[] = [
    menuRow('⚙️ ', '__CONFIG__', 'cli.menu.configureFilters'),
    mode === 'name'
      ? menuRow('🔢', '__COLLECTOR_MODE__', 'cli.menu.collectorMode')
      : menuRow('🔤', '__NAME_MODE__', 'cli.menu.nameMode'),
  ]

  const undoItems: Choice[] = [
    ...(sessionAdds.length > 0
      ? [
          menuRow('↩️ ', '__UNDO_LAST__', 'cli.menu.undoLastAdd', {
            name: sessionAdds[sessionAdds.length - 1]!.name,
          }),
        ]
      : []),
    ...(editUndoLabel !== null
      ? [menuRow('↩️ ', '__UNDO_EDIT__', 'cli.menu.undoLastEdit', { label: editUndoLabel })]
      : []),
  ]

  // Edit mode pares the menu down to undo, mode switching, and save/exit — the
  // add-mode shortcuts (copies, notes, filters) only make sense while adding.
  const actionItems: Choice[] =
    sessionMode === 'edit'
      ? [...undoItems, menuRow('➕', '__ADD_MODE__', 'cli.menu.addMode')]
      : [
          ...(lastAdded
            ? [
                menuRow('➕', '__ADD_ANOTHER__', 'cli.menu.addExactCopy', { name: lastAdded.name }),
                menuRow('➕', '__ADD_SIMILAR__', 'cli.menu.addSimilarCopy', {
                  name: lastAdded.name,
                }),
                ...(!lastAdded.hasNote
                  ? [menuRow('📝', '__ADD_NOTE__', 'cli.menu.addNote', { name: lastAdded.name })]
                  : []),
                menuRow('✏️ ', '__EDIT_LAST__', 'cli.menu.editPrevious', { name: lastAdded.name }),
              ]
            : []),
          ...undoItems,
          ...extraItems,
          ...modeItems,
          menuRow('🛠️ ', '__EDIT_MODE__', 'cli.menu.editMode'),
        ]

  return [
    ...actionItems,
    ...(sessionChangeCount > 0
      ? [menuRow('📋', '__CHANGES__', 'cli.menu.viewChanges', { count: sessionChangeCount })]
      : []),
    ...buildSaveAndSwitchItems(input),
    menuRow('🚪', '__EXIT__', 'cli.menu.exit'),
    ...cardChoices,
  ]
}

/**
 * Build the collector-mode rows from a pool of printings: one row per printing,
 * titled `SET:CN — Card Name` (set codes uppercase in display), ordered by set
 * code and then by {@link compareCollectorNumbers} — the same natural ordering
 * the printing pickers use, so `2a` sorts right after the `2` it extends and a
 * letter-prefixed number (`A-12`) still orders by its digits.
 */
export function buildCollectorChoices(printings: ScryfallCard[]): CollectorChoice[] {
  const collectorChoices: CollectorChoice[] = printings.map((card) => ({
    title: t('cli.session.collectorChoice', {
      printing: formatPrintingLabel(card.set, card.collector_number),
      name: card.name,
    }),
    value: { type: 'card', card },
    setTerm: card.set.toLowerCase(),
    numTerm: card.collector_number.toLowerCase(),
  }))
  collectorChoices.sort((a, b) => {
    if (a.setTerm !== b.setTerm) return compareData(a.setTerm, b.setTerm)
    return compareCollectorNumbers(a.value.card.collector_number, b.value.card.collector_number)
  })
  return collectorChoices
}

/**
 * Load the session's collector-mode rows, building them once and keeping them
 * on the config. The pool is every printing in the cache under the session's
 * set filter — far too large to rebuild per prompt — and a unified session
 * shares one config across all its open lists, so this runs once per session
 * until the set filter moves.
 */
export async function ensureCollectorChoices(
  config: SessionConfig,
  excludeDigitalOnly: boolean,
): Promise<CollectorChoice[]> {
  const cached = config.collectorChoices
  if (cached) return cached
  console.log(t('cli.session.loadingPrintings'))
  const printings = await getAllPrintings({ sets: config.sets, excludeDigitalOnly })
  const choices = buildCollectorChoices(printings)
  console.log(t('cli.session.loadedPrintings', { count: choices.length }))
  config.collectorChoices = choices
  return choices
}

/**
 * Filter choices so every space-separated term of `input` appears in the title —
 * or, for a translated menu row, in the English terms it carries alongside it.
 * See `menu-search.ts` for why both are matched.
 */
function filterByTerms(input: string, choices: Choice[]): Choice[] {
  return choices.filter((choice) => matchesChoiceTerms(choice, input))
}

/**
 * Order the matched cards by how directly they answer the input (see
 * {@link rankNameMatches}), leaving the menu shortcuts where they are — they
 * always lead the prompt — and leaving equally good cards in their EDHRec
 * popularity order.
 */
function rankMatchedNames(input: string, matches: Choice[]): Choice[] {
  const menuItems = matches.filter(isMenuChoice)
  const cardItems = matches.filter((choice) => !isMenuChoice(choice))
  return [...menuItems, ...rankNameMatches(cardItems, input, (choice) => choice.title)]
}

/**
 * How long an input may be before the menu rows drop out of the suggestions.
 * The menu is reached by typing a word or two of a label, so a longer query is
 * a card search — and in collector mode a `:` says so outright, whatever its
 * length.
 */
const MENU_SUGGEST_MAX_LENGTH = 3

/**
 * Whether the menu rows are still offered alongside the card matches. Past a
 * few characters (or once the input carries a `SET:CN` colon) the user is
 * searching for a card, and menu rows sitting at the top of the list would only
 * push the matches down.
 *
 * The budget is counted in code points, not UTF-16 units, so an astral
 * character (or a CJK label) spends one of the three rather than two; and the
 * input is trimmed first, so the two add modes agree on the count whether or
 * not their caller already stripped a marker or a trailing space.
 */
function menuItemsVisible(input: string): boolean {
  const trimmed = input.trim()
  return [...trimmed].length <= MENU_SUGGEST_MAX_LENGTH && !trimmed.includes(':')
}

/** Drop the menu rows from `choices` unless `input` is still short enough to want them. */
function withMenuVisibility(input: string, choices: Choice[]): Choice[] {
  return menuItemsVisible(input) ? choices : choices.filter((choice) => !isMenuChoice(choice))
}

/**
 * Name-mode suggestion filter: empty input shows the menu shortcuts; otherwise
 * all space-separated terms must appear in a title, and the cards whose name the
 * terms answer most directly come first (see {@link rankNameMatches}). A trailing
 * `!` marks the selection to force the finish/condition prompts past any session
 * defaults. Past {@link MENU_SUGGEST_MAX_LENGTH} characters (or with a `:` typed)
 * the menu rows drop out — see {@link menuItemsVisible}.
 */
export function suggestNameMode(input: string, choices: Choice[]): Choice[] {
  const isForce = input.endsWith('!')
  const cleanInput = isForce ? input.slice(0, -1) : input

  if (!cleanInput) return choices.filter(isMenuChoice)

  const pool = withMenuVisibility(cleanInput, choices)
  const matches = rankMatchedNames(cleanInput, filterByTerms(cleanInput, pool))

  if (isForce) {
    return matches.map((m) =>
      isMenuChoice(m)
        ? m
        : {
            ...m,
            title: t('cli.session.forceOptions', { title: m.title }),
            value: `${m.value}${FORCE_SUFFIX}`,
          },
    )
  }
  return matches
}

/**
 * Edit-mode suggestion filter: empty input shows the menu shortcuts; otherwise
 * term-matches the rendered entry lines. Unlike name mode there is no `!` force
 * marker — entry values are objects, not strings, so they cannot carry a suffix.
 */
export function suggestEditMode(input: string, choices: Choice[]): Choice[] {
  if (!input) return choices.filter(isMenuChoice)
  return filterByTerms(input, choices)
}

/** Whether a prompt choice value is a collector-mode printing (vs. a menu sentinel string). */
function isCollectorChoiceValue(value: unknown): value is CollectorChoiceValue {
  return (
    typeof value === 'object' && value !== null && (value as CollectorChoiceValue).type === 'card'
  )
}

/** Whether a prompt choice value is an edit-mode entry selection. */
function isEntryChoiceValue(value: unknown): value is EntryChoiceValue {
  return typeof value === 'object' && value !== null && (value as EntryChoiceValue).type === 'entry'
}

/**
 * Whether a choice is one of the collector-mode printing rows
 * {@link buildCollectorChoices} built. The precomputed match terms are checked
 * rather than assumed: `prompts` hands `suggest` the whole choice list, menu
 * rows included, and {@link matchesCollectorQuery} dereferences both terms.
 */
function isCollectorChoice(choice: Choice): choice is CollectorChoice {
  return (
    isCollectorChoiceValue(choice.value) &&
    'setTerm' in choice &&
    typeof choice.setTerm === 'string' &&
    'numTerm' in choice &&
    typeof choice.numTerm === 'string'
  )
}

/**
 * Collector-mode suggestion filter over every printing in the session's pool:
 * empty input shows the menu shortcuts, and anything else is a set-code and/or
 * collector-number search (see {@link parseCollectorQuery}). Card names are
 * never matched here. The menu rows drop out once the input outgrows
 * {@link menuItemsVisible}, and while they are still offered they are narrowed
 * by the same term match name mode uses — otherwise a three-letter set code
 * would fill the whole prompt window with menu rows and show no printings.
 */
export function suggestCollectorMode(input: string, choices: Choice[]): Choice[] {
  if (!input) return choices.filter(isMenuChoice)
  const query = parseCollectorQuery(input)
  return withMenuVisibility(input, choices).filter((choice) =>
    isCollectorChoice(choice)
      ? matchesCollectorQuery(query, choice)
      : matchesChoiceTerms(choice, input),
  )
}

// ── The session loop ────────────────────────────────────────────────

/**
 * Hooks the unified multi-list editor injects into the session loop. When
 * present, Save writes every open list, Esc and the Switch List item back out
 * to the list selection menu (keeping unsaved changes in memory), and the exit
 * menu accounts for every open list's pending changes.
 */
export type MultiListSessionControls = {
  /** Pending changes across every open list, including the current one. */
  totalChangeCount: () => number
  /** How many open lists have pending changes. */
  listsWithChanges: () => number
  /** Whether any open list has unsaved changes. */
  hasAnyUnsaved: () => boolean
  /**
   * Persist every open list's pending changes and reset their session
   * tracking. False when any list could not be saved (a pending cross-list
   * move whose destination cannot be committed) — the exit gate then keeps
   * the editor open instead of discarding the unsaved session.
   */
  saveAll: () => Promise<boolean>
  /**
   * Persist the current list only (the Save Current item). Routed through the
   * editor rather than {@link saveCardSession} directly so a save always
   * commits the destination side of the list's pending cross-list moves.
   */
  saveCurrent: () => Promise<boolean>
}

/**
 * The unified editor's exit gate, shared by the in-session Exit action and the
 * list selection menu's Exit item: with unsaved changes anywhere, offer to save
 * them all, discard them all, or cancel. Returns false when the user cancels
 * (keep editing); logs the exit message otherwise.
 */
export async function confirmMultiListExit(multiList: MultiListSessionControls): Promise<boolean> {
  if (multiList.hasAnyUnsaved()) {
    const choice = await promptExitMenu(multiList.totalChangeCount())
    if (choice === 'cancel') return false
    if (choice === 'save') {
      // A failed save (a cross-list move whose destination could not be
      // committed) must not fall through to exiting — the unsaved session
      // would be silently thrown away right after the error.
      if (!(await multiList.saveAll())) return false
    } else console.log(t('cli.session.discardedAll'))
  }
  console.log(t('cli.session.exitingEditor'))
  return true
}

/** Inputs to {@link runCardSession}. */
export type CardSessionOptions = {
  strategy: CardSessionStrategy
  /** Initial autocomplete card names (already filtered by the session's set codes). */
  cardNames: string[]
  excludeDigitalOnly: boolean
  /**
   * The session context to work in, re-read at the top of every loop iteration.
   * The unified editor owns one per open list, so pending changes survive
   * backing out to the list selection menu; a multi-list scope returns the context
   * of whichever list the last card was added to, so the last-added shortcuts
   * and the note action land there. Omitted, a fresh context is created.
   */
  ctx?: () => CardSessionContext
  /** Present when the session runs inside the unified multi-list editor. */
  multiList?: MultiListSessionControls
  /** The strategy spans several lists at once (a multi-list scope). */
  scoped?: boolean
}

/**
 * Why the session loop returned: the user exited the editor, or backed out to
 * the list selection menu (multi-list sessions only). Carries the possibly
 * reloaded card-name list so a later session can resume with current filters.
 */
export type CardSessionResult = { reason: 'exit' | 'switch'; cardNames: string[] }

/** Persist the in-memory list model and append the session changelog, when either is pending. */
export async function saveCardSession(
  strategy: CardSessionStrategy,
  ctx: CardSessionContext,
): Promise<void> {
  const { saveTarget } = strategy
  if (!saveTarget) {
    throw new Error('A multi-list session must be saved one open list at a time.')
  }
  if (strategy.hasUnsavedChanges()) {
    await strategy.persist()
    console.log(t('cli.session.changesSaved'))
  }
  if (ctx.sessionChanges.length > 0) {
    await appendChangelog(saveTarget.filePath, saveTarget.listName, ctx.sessionChanges, {
      continueSession: ctx.hasSavedChangelog,
    })
    ctx.hasSavedChangelog = true
    console.log(t('cli.session.changelogSaved'))
  }
}

/**
 * Reset the session tracking after a save: everything up to here is committed,
 * so the undo/discard menus must not be able to claw back changes that are
 * already on disk.
 */
export function resetCardSessionTracking(
  strategy: CardSessionStrategy,
  ctx: CardSessionContext,
): void {
  strategy.sessionSaved()
  ctx.sessionChanges = []
  ctx.lastChangeIndex = null
  ctx.lastAdded = null
  ctx.lastAddedCount = 0
}

/**
 * The View Session Changes screen: list every change made this session and
 * offer to discard the selected one. Discarding re-renders the list; Back (or
 * escape) returns to the main prompt.
 */
async function viewSessionChanges(
  strategy: CardSessionStrategy,
  ctx: CardSessionContext,
): Promise<void> {
  while (true) {
    const items = strategy.listSessionChanges()
    if (items.length === 0) {
      console.log(t('cli.session.noChanges'))
      return
    }
    const response = (await prompts({
      type: 'select',
      name: 'index',
      message: t('cli.session.promptPickChangeToDiscard', { count: items.length }),
      choices: [
        ...items.map((item, index) => ({ title: item.label, value: index })).reverse(),
        { title: `← ${t('cli.menu.back')}`, value: null },
      ],
    })) as ChangeIndexPromptResponse
    if (response.index == null) return
    const item = items[response.index]
    if (!item) return
    if (item.blocked) {
      console.log(t('cli.session.discardBlocked', { reason: item.blocked }))
      continue
    }
    const confirmResponse = (await prompts({
      type: 'confirm',
      name: 'confirm',
      message: t('cli.session.promptDiscardChange', { label: item.label }),
      initial: false,
    })) as ConfirmPromptResponse
    if (confirmResponse.confirm) {
      await strategy.discardSessionChange(ctx, response.index)
      // Discarding a list's creation takes the list away with it: there is
      // nothing left to render, let alone discard.
      if (strategy.discarded?.()) return
    }
  }
}

/**
 * Run the interactive card-entry loop until the user exits. Changes accumulate
 * on the in-memory list model; Save writes the file and the session changelog
 * without leaving the session, and Exit (or Esc) opens the shared exit menu to
 * save and exit, exit without saving, or keep editing.
 *
 * In a unified multi-list session (`multiList` present), Save flushes every
 * open list, Esc and Switch List return to the list selection menu with
 * unsaved changes kept in memory, and the exit menu covers all open lists.
 */
export async function runCardSession(options: CardSessionOptions): Promise<CardSessionResult> {
  const { strategy, excludeDigitalOnly, multiList } = options
  const { sessionConfig } = strategy
  let cardNames = options.cardNames
  let sessionMode: SessionMode = 'add'

  const ownCtx = createCardSessionContext()
  const currentCtx: () => CardSessionContext = options.ctx ?? (() => ownCtx)

  while (true) {
    const ctx = currentCtx()
    let isExited = false
    let forcePrompts = false
    let intent: CardChoiceIntent = 'add'

    const cardChoices: Choice[] =
      sessionMode === 'edit'
        ? strategy.listEntries().map(
            (entry): Choice => ({
              title: entry.label,
              value: { type: 'entry', cardId: entry.cardId } satisfies EntryChoiceValue,
            }),
          )
        : sessionConfig.entryMode === 'name'
          ? cardNames.map((name) => ({ title: name, value: name }))
          : // Built once and cached on the shared config, so the whole-cache
            // printing pool is not rebuilt on every loop iteration.
            await ensureCollectorChoices(sessionConfig, excludeDigitalOnly)

    const sessionAdds = strategy.listSessionAdds?.() ?? []

    const choices = buildMenuChoices({
      sessionMode,
      mode: sessionConfig.entryMode,
      lastAdded: ctx.lastAdded,
      changeCount: ctx.sessionChanges.length,
      extraItems: strategy.extraMenuItems?.() ?? [],
      sessionAdds,
      editUndoLabel: strategy.lastEditUndoLabel(),
      sessionChangeCount: strategy.listSessionChanges().length,
      cardChoices,
      dirty: strategy.hasUnsavedChanges(),
      multiList: multiList
        ? {
            totalChangeCount: multiList.totalChangeCount(),
            listsWithChanges: multiList.listsWithChanges(),
            scoped: options.scoped === true,
          }
        : undefined,
    })

    const streak: string =
      ctx.lastAdded && ctx.lastAddedCount > 0
        ? t('cli.session.streakHint', { count: ctx.lastAddedCount, name: ctx.lastAdded.name })
        : ''
    const promptMessage: string =
      sessionMode === 'edit'
        ? t('cli.session.promptSearchToEdit')
        : sessionConfig.entryMode === 'name'
          ? t('cli.session.promptCardName', { streak })
          : t('cli.session.promptCollectorSearch', { streak })

    const response = (await prompts({
      type: 'autocomplete',
      name: 'cardName',
      message: promptMessage,
      choices,
      limit: SESSION_MENU_LIMIT,
      suggest: async (rawInput, suggestChoices) =>
        sessionMode === 'edit'
          ? suggestEditMode(String(rawInput), suggestChoices)
          : sessionConfig.entryMode === 'name'
            ? suggestNameMode(String(rawInput), suggestChoices)
            : suggestCollectorMode(String(rawInput), suggestChoices),
      onState: (state: PromptState) => {
        if (state.exited) isExited = true
      },
    })) as CardSelectionResponse

    // The menu shortcut this selection is, or null for a card/entry choice.
    const menuAction = asMenuSentinel(response.cardName)

    // In a multi-list session, Esc backs out to the list selection menu (like
    // Switch List) rather than exiting — unsaved changes stay in memory.
    if (multiList && (isExited || menuAction === '__SWITCH_LIST__')) {
      console.log(t('cli.session.returningToLists'))
      return { reason: 'switch', cardNames }
    }

    if (isExited || menuAction === '__EXIT__') {
      if (multiList) {
        if (!(await confirmMultiListExit(multiList))) continue
        return { reason: 'exit', cardNames }
      }
      if (ctx.sessionChanges.length > 0 || strategy.hasUnsavedChanges()) {
        const choice = await promptExitMenu(ctx.sessionChanges.length)
        if (choice === 'cancel') continue
        if (choice === 'save') await saveCardSession(strategy, ctx)
        else console.log(t('cli.session.discardedAll'))
      }
      console.log(t('cli.session.exitingManager', { manager: strategy.managerLabel }))
      return { reason: 'exit', cardNames }
    }

    // In a multi-list session, Save flushes every open list (saveAll also
    // resets each list's tracking, including this session's ctx).
    if (menuAction === '__SAVE__' && multiList) {
      await multiList.saveAll()
      continue
    }

    // Save Current in a multi-list session goes through the editor's save
    // path, which also commits the destination side of pending cross-list moves.
    if (menuAction === '__SAVE_CURRENT__' && multiList) {
      await multiList.saveCurrent()
      continue
    }

    // The single-list Save (no multi-list controls present).
    if (menuAction === '__SAVE__' || menuAction === '__SAVE_CURRENT__') {
      await saveCardSession(strategy, ctx)
      // Everything up to here is committed: the undo/discard menus reset so a
      // later undo can never claw back changes that are already on disk.
      resetCardSessionTracking(strategy, ctx)
      continue
    }

    if (!response.cardName) {
      console.error(t('cli.session.cardNotFound'))
      if (sessionConfig.sets && sessionConfig.sets.length > 0) {
        console.warn(
          t('cli.session.setFiltersActive', {
            sets: formatSetCodesForDisplay(sessionConfig.sets),
          }),
        )
      }
      continue
    }

    // ── Menu actions ──────────────────────────────────────────────
    if (menuAction === '__ADD_ANOTHER__' && ctx.lastAdded) {
      await strategy.addAnotherCopy(ctx)
      continue
    }

    if (menuAction === '__ADD_SIMILAR__' && ctx.lastAdded) {
      console.log(t('cli.session.addingSimilar', { name: ctx.lastAdded.name }))
      await strategy.handleCard(ctx, similarCopyInput(ctx.lastAdded))
      continue
    }

    if (menuAction === '__ADD_NOTE__' && ctx.lastAdded) {
      const target: LastAdded = ctx.lastAdded
      const noteResponse = (await prompts({
        type: 'text',
        name: 'note',
        message: t('cli.session.promptNote'),
      })) as NotePromptResponse
      const note = noteResponse.note?.trim()
      if (note) {
        const change = createSetNoteChange(target.name, { note, cardId: target.cardId })
        strategy.applyChange(change)
        // Notes never become the in-place edit target, so lastChangeIndex stays put.
        ctx.sessionChanges.push(change)
        ctx.lastAdded = { ...target, hasNote: true }
        strategy.noteAdded?.(note)
        console.log(t('cli.session.noteAdded', { name: target.name, note }))
      }
      continue
    }

    if (menuAction === '__EDIT_MODE__') {
      sessionMode = 'edit'
      console.log(t('cli.session.switchedToEdit'))
      continue
    }

    if (menuAction === '__ADD_MODE__') {
      sessionMode = 'add'
      console.log(t('cli.session.switchedToAdd'))
      continue
    }

    if (menuAction === '__UNDO_EDIT__') {
      await strategy.undoLastEdit(ctx)
      continue
    }

    if (menuAction === '__COLLECTOR_MODE__') {
      // No set codes to pick first: the pool spans every printing the cache
      // holds (narrowed only by the session's own set filter), and the next
      // loop iteration builds it.
      sessionConfig.entryMode = 'collector'
      console.log(t('cli.session.switchedToCollector'))
      continue
    }

    if (menuAction === '__NAME_MODE__') {
      sessionConfig.entryMode = 'name'
      console.log(t('cli.session.switchedToName'))
      continue
    }

    if (menuAction === '__CONFIG__') {
      cardNames = await strategy.updateConfig(excludeDigitalOnly)
      continue
    }

    if (menuAction === '__UNDO_LAST__' && strategy.discardSessionAdd) {
      if (sessionAdds.length > 0) await strategy.discardSessionAdd(ctx, sessionAdds.length - 1)
      continue
    }

    if (menuAction === '__CHANGES__') {
      await viewSessionChanges(strategy, ctx)
      // The session's own list was discarded, so back out to the selection menu.
      if (strategy.discarded?.()) {
        console.log(t('cli.session.returningToLists'))
        return { reason: 'switch', cardNames }
      }
      continue
    }

    if (menuAction && menuAction !== '__EDIT_LAST__') {
      // A sentinel neither the engine nor the strategy handles (e.g.
      // __ADD_ANOTHER__ with no last card) is ignored.
      await strategy.handleSentinel?.(ctx, menuAction)
      continue
    }

    // ── Resolve the chosen card ───────────────────────────────────
    let cardName: string
    let preselected: ScryfallCard | null = null

    if (typeof response.cardName === 'string') {
      cardName = response.cardName
      if (cardName.endsWith(FORCE_SUFFIX)) {
        cardName = cardName.slice(0, -FORCE_SUFFIX.length)
        forcePrompts = true
      }
      if (menuAction === '__EDIT_LAST__') {
        if (!ctx.lastAdded) continue
        cardName = ctx.lastAdded.name
        forcePrompts = true
        intent = 'edit-last'
        console.log(t('cli.session.editingCard', { name: ctx.lastAdded.name }))
      }
    } else if (isCollectorChoiceValue(response.cardName)) {
      cardName = response.cardName.card.name
      preselected = response.cardName.card
    } else if (isEntryChoiceValue(response.cardName)) {
      await strategy.editEntry(ctx, response.cardName.cardId)
      continue
    } else {
      // Unexpected value from the prompt library — ignore and re-prompt.
      continue
    }

    await strategy.handleCard(ctx, { cardName, preselected, forcePrompts, intent })
  }
}
