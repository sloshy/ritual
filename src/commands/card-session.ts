import prompts, { type Choice } from 'prompts'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { getAllCardNames, getCardsBySet } from '../scryfall'
import type { Condition, Finish, ScryfallCard } from '../types'
import { CONDITION_LABELS, isCondition, isFinish, VALID_CONDITIONS } from '../finish-condition'
import type { PromptState } from './prompts-types'
import { appendChangelog } from '../changelog-writer'
import { createSetNoteChange, type ChangeEvent } from '../change-event'
import { writeFileWithHash } from '../content-hash'
import { formatSetCodesForDisplay, parseSetCodesInput } from '../set-codes'
import { matchesAllTerms } from '../term-match'
import { promptExitMenu } from './prompts-helpers'

/**
 * Shared engine for the interactive card-entry commands (`deck`, `collection`,
 * `wanted-list`). Owns everything the three sessions have in common — the
 * autocomplete loop, menu construction, entry modes, collector-set management,
 * session filters, and save/exit/changelog plumbing — and delegates the
 * list-type-specific flows (printing/finish/condition prompts, change
 * application, copy semantics) to a {@link CardSessionStrategy}.
 */

// ── Session config ──────────────────────────────────────────────────

export type EntryMode = 'name' | 'collector'

/** Session-wide filters and entry-mode state shared by all card-entry commands. */
export type SessionConfig = {
  sets?: string[]
  finish?: Finish
  condition?: Condition | 'NONE'
  entryMode: EntryMode
  collectorSets: string[]
  activeSetIndex: number
  setCardMaps: Map<string, Map<string, ScryfallCard>>
}

/** The slice of {@link SessionConfig} used by collector-set management. */
export type CollectorSessionConfig = Pick<
  SessionConfig,
  'collectorSets' | 'activeSetIndex' | 'setCardMaps'
>

/** Shape of a free-form text prompt asking for set codes. */
export type SetsPromptResponse = { sets?: string }

// ── Menu sentinels ──────────────────────────────────────────────────

/**
 * The menu sentinel values (e.g. `__EXIT__`). Matched by exact membership rather
 * than a `__` prefix check, because real card names can begin with underscores
 * (e.g. the Unstable card `_____ Goblin`) and must not be mistaken for menu items.
 */
export const MENU_SENTINELS: ReadonlySet<string> = new Set([
  '__ADD_ANOTHER__',
  '__ADD_NOTE__',
  '__SECTION__',
  '__CONFIG__',
  '__COLLECTOR_MODE__',
  '__MANAGE_SETS__',
  '__NAME_MODE__',
  '__EDIT_MODE__',
  '__ADD_MODE__',
  '__SAVE__',
  '__EXIT__',
  '__EDIT_LAST__',
  '__UNDO_LAST__',
  '__UNDO_EDIT__',
  '__CHANGES__',
])

/** A choice is a menu item (vs. a card) when its value is exactly a known sentinel. */
export const isMenuChoice = (choice: Choice): boolean =>
  typeof choice.value === 'string' && MENU_SENTINELS.has(choice.value)

// ── Choice values & prompt responses ────────────────────────────────

/** A collector-mode autocomplete choice value: a specific printing keyed by collector number. */
export type CollectorChoiceValue = { type: 'card'; num: string; card: ScryfallCard }
/** An edit-mode autocomplete choice value: an existing entry, targeted by card ID. */
export type EntryChoiceValue = { type: 'entry'; cardId: number }
/** The card-entry prompt resolves to a menu sentinel/card-name string, a collector choice, or an entry. */
type CardSelectionResponse = { cardName?: string | CollectorChoiceValue | EntryChoiceValue }

type ListPromptResponse = { list?: string }
type NamePromptResponse = { name?: string }
type NotePromptResponse = { note?: string }
type ConfirmPromptResponse = { confirm?: boolean }
/** The session-changes picker resolves to an item index, null (Back), or undefined (escaped). */
type ChangeIndexPromptResponse = { index?: number | null }
type CodePromptResponse = { code?: string }
/** An action picked in the Manage Set Codes menu. */
type SetAction =
  | { type: 'toggle'; index: number }
  | { type: 'add' }
  | { type: 'remove' }
  | { type: 'back' }
type SetActionPromptResponse = { action?: SetAction }

// ── Session context & strategy ──────────────────────────────────────

/**
 * Whether the session is adding new cards (autocomplete over the card database)
 * or editing existing entries (autocomplete over the list's current entries).
 * Toggled from the session menu; orthogonal to the name/collector {@link EntryMode}.
 */
export type SessionMode = 'add' | 'edit'

/** An existing list entry offered in the edit-mode picker. */
export type EditableEntryItem = { label: string; cardId: number }

/** The most recently added/edited card, tracked for the menu shortcuts. */
export type LastAdded = { name: string; hasNote: boolean; cardId?: number }

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

/** Input to {@link CardSessionStrategy.handleCard} once the engine has resolved a selection. */
export type CardChoiceInput = {
  cardName: string
  /** Printing preselected via collector mode, or null in name mode. */
  preselected: ScryfallCard | null
  /** Force the finish/condition prompts even when session defaults would apply. */
  forcePrompts: boolean
  /** The selection is an edit of the last added card rather than a new add. */
  isEditing: boolean
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
  /** File the session edits; changelog entries are appended next to it. */
  filePath: string
  /** Display name recorded in the changelog. */
  listName: string
  sessionConfig: SessionConfig
  /** Extra menu entries inserted after the note shortcut in both modes (values must be in {@link MENU_SENTINELS}). */
  extraMenuItems?: () => Choice[]
  /** Handle a strategy-specific sentinel; returns true when it was handled. */
  handleSentinel?: (ctx: CardSessionContext, value: string) => Promise<boolean>
  /** Re-prompt session filters and return the reloaded card-name list. */
  updateConfig: (excludeDigitalOnly: boolean) => Promise<string[]>
  /** Apply a change to the in-memory list model (not written to disk until {@link persist}). */
  applyChange: (change: ChangeEvent) => void
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
 * Load the card-name list for autocomplete, logging progress. Returns null (after
 * telling the user to preload) when the Scryfall cache is empty.
 */
export async function loadCardNamesOrWarn(
  sets: string[] | undefined,
  excludeDigitalOnly: boolean,
): Promise<string[] | null> {
  console.log('Loading card database for autocomplete...')
  const cardNames = await getAllCardNames({ sets, excludeDigitalOnly })
  if (cardNames.length === 0) {
    console.log('Cache is empty. Please run preload to populate the cache for autocomplete.')
    return null
  }
  console.log(`Loaded ${cardNames.length} cards.`)
  return cardNames
}

/** Result of the list-selection prompt: an existing list's value, or a new list's name. */
export type ListSelection = { kind: 'existing'; value: string } | { kind: 'new'; name: string }

const NEW_LIST = '__NEW__'

/** Inputs to {@link promptListSelection}. */
export type ListSelectionPromptOptions = {
  message: string
  items: Choice[]
  createTitle: string
  newNameMessage: string
}

/**
 * Prompt to select an existing list or create a new one. Returns null when the
 * prompt is cancelled or the new-list name is empty.
 */
export async function promptListSelection(
  options: ListSelectionPromptOptions,
): Promise<ListSelection | null> {
  const selectionResponse = (await prompts({
    type: 'autocomplete',
    name: 'list',
    message: options.message,
    choices: [...options.items, { title: options.createTitle, value: NEW_LIST }],
  })) as ListPromptResponse

  if (!selectionResponse.list) return null
  if (selectionResponse.list !== NEW_LIST) {
    return { kind: 'existing', value: selectionResponse.list }
  }

  const nameResponse = (await prompts({
    type: 'text',
    name: 'name',
    message: options.newNameMessage,
    validate: (value: string) => (value.length > 0 ? true : 'Name cannot be empty'),
  })) as NamePromptResponse
  if (!nameResponse.name) return null
  return { kind: 'new', name: nameResponse.name }
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
    console.log(`Created new ${label} file: ${fileName}`)
  } else {
    console.log(`Using ${label} file: ${fileName}`)
  }
  return filePath
}

/** List the `.md` files in a flat-list directory (excluding change files), as bare names. */
export async function listMarkdownNames(dir: string): Promise<string[]> {
  await fs.mkdir(dir, { recursive: true })
  const files = await fs.readdir(dir)
  return files
    .filter((f) => f.endsWith('.md') && !f.endsWith('.changes.md'))
    .map((f) => f.replace('.md', ''))
}

/** Load card maps for `setCodes` and make them the session's collector sets. */
export async function loadCollectorSets(
  config: CollectorSessionConfig,
  setCodes: string[],
): Promise<void> {
  console.log('Loading set data...')
  for (const setCode of setCodes) {
    console.log(`Loading ${setCode.toUpperCase()}...`)
    const cardMap = await getCardsBySet(setCode)
    config.setCardMaps.set(setCode.toLowerCase(), cardMap)
    console.log(`  ${cardMap.size} cards loaded`)
  }
  config.collectorSets = setCodes
  config.activeSetIndex = 0
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
      message: 'Filter by Set Codes (comma separated, e.g. "ECL, ECC"):',
      initial: config.sets ? formatSetCodesForDisplay(config.sets) : '',
      format: (val: string) => parseSetCodesInput(val),
    },
    {
      type: 'select',
      name: 'finish',
      message: 'Default Finish:',
      choices: [
        { title: 'None (Always Prompt)', value: '' },
        { title: 'Nonfoil', value: 'nonfoil' },
        { title: 'Foil', value: 'foil' },
        { title: 'Etched', value: 'etched' },
      ],
      initial: config.finish ? ['', 'nonfoil', 'foil', 'etched'].indexOf(config.finish) : 0,
    },
  ]
  if (includeCondition) {
    questions.push({
      type: 'select',
      name: 'condition',
      message: 'Default Condition:',
      choices: [
        { title: 'None (Always Prompt)', value: '' },
        { title: "Don't Care", value: 'NONE' },
        ...VALID_CONDITIONS.map((c) => ({ title: CONDITION_LABELS[c], value: c })),
      ],
      initial: 0,
    })
  }
  return questions
}

/**
 * Write the shared session-filter answers back onto the config. The raw prompt
 * strings are validated through the domain guards; an empty string (or any
 * unexpected value) clears the default back to "always prompt".
 */
export function applySessionConfigAnswers(
  config: SessionConfig,
  answers: SessionConfigAnswers,
): void {
  if (answers.sets !== undefined) {
    config.sets = answers.sets.length > 0 ? answers.sets : undefined
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
  console.log('Reloading card database with new filters...')
  const cardNames = await getAllCardNames({ sets: config.sets, excludeDigitalOnly })
  console.log(`Loaded ${cardNames.length} cards.`)
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
  console.log('Session filters updated.')
  return cardNames
}

// ── Collector-set management ────────────────────────────────────────

/** Interactive add/remove/switch of the collector-mode set codes. */
export async function manageSetCodes(config: CollectorSessionConfig): Promise<void> {
  while (true) {
    const setChoices: Choice[] = config.collectorSets.map((code, idx) => ({
      title: `${idx === config.activeSetIndex ? '→ ' : '  '}${code.toUpperCase()}${idx === config.activeSetIndex ? ' (active)' : ''}`,
      value: { type: 'toggle', index: idx },
    }))

    setChoices.push(
      { title: '+ Add Set Code', value: { type: 'add' } },
      { title: '- Remove Set Code', value: { type: 'remove' } },
      { title: '← Back', value: { type: 'back' } },
    )

    const response = (await prompts({
      type: 'select',
      name: 'action',
      message: 'Manage Set Codes:',
      choices: setChoices,
    })) as SetActionPromptResponse

    if (!response.action || response.action.type === 'back') {
      break
    }

    if (response.action.type === 'toggle') {
      config.activeSetIndex = response.action.index
      console.log(
        `Active set changed to: ${config.collectorSets[config.activeSetIndex]?.toUpperCase()}`,
      )
      break
    }

    if (response.action.type === 'add') {
      const addResponse = (await prompts({
        type: 'text',
        name: 'code',
        message: 'Enter set code to add:',
        validate: (val: string) => (val.trim().length > 0 ? true : 'Set code cannot be empty'),
      })) as CodePromptResponse

      if (addResponse.code) {
        const newCode = addResponse.code.trim().toLowerCase()
        if (!config.collectorSets.includes(newCode)) {
          console.log(`Loading ${newCode.toUpperCase()}...`)
          const cardMap = await getCardsBySet(newCode)
          config.setCardMaps.set(newCode, cardMap)
          config.collectorSets.push(newCode)
          console.log(`  ${cardMap.size} cards loaded`)
        } else {
          console.log(`Set ${newCode.toUpperCase()} already added.`)
        }
      }
    }

    if (response.action.type === 'remove') {
      if (config.collectorSets.length === 0) {
        console.log('No sets to remove.')
        continue
      }

      const removeResponse = (await prompts({
        type: 'select',
        name: 'code',
        message: 'Select set to remove:',
        choices: config.collectorSets.map((code) => ({
          title: code.toUpperCase(),
          value: code,
        })),
      })) as CodePromptResponse

      if (removeResponse.code) {
        const idx = config.collectorSets.indexOf(removeResponse.code)
        if (idx !== -1) {
          config.collectorSets.splice(idx, 1)
          config.setCardMaps.delete(removeResponse.code)
          if (config.activeSetIndex >= config.collectorSets.length) {
            config.activeSetIndex = Math.max(0, config.collectorSets.length - 1)
          }
          console.log(`Removed ${removeResponse.code.toUpperCase()}`)
        }
      }
    }
  }
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
    message: `Edit ${entryLabel}:`,
    choices: [...actions, { title: '← Cancel', value: CANCEL_ACTION }],
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
    message: 'Note (empty clears it):',
    initial: currentNote ?? '',
  })) as NotePromptResponse
  if (response.note === undefined) return null
  const note = response.note.trim()
  const before = currentNote ?? ''
  return note === before ? null : { note, before }
}

// ── Menu construction & suggestion filtering ────────────────────────

/** Inputs to {@link buildMenuChoices}. */
export type MenuBuildInput = {
  sessionMode: SessionMode
  mode: EntryMode
  lastAdded: LastAdded | null
  changeCount: number
  /** Active collector set code (collector mode only). */
  activeSet: string
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
}

/** Build the full autocomplete choice list (menu shortcuts first, then cards). */
export function buildMenuChoices(input: MenuBuildInput): Choice[] {
  const {
    sessionMode,
    mode,
    lastAdded,
    changeCount,
    activeSet,
    extraItems,
    sessionAdds,
    editUndoLabel,
    sessionChangeCount,
    cardChoices,
  } = input
  const modeItems: Choice[] =
    mode === 'name'
      ? [
          { title: '⚙️  Configure Session Filters', value: '__CONFIG__' },
          { title: '🔢 Switch to Collector Number Mode', value: '__COLLECTOR_MODE__' },
        ]
      : [
          {
            title: `📦 Manage Set Codes (Active: ${activeSet.toUpperCase() || 'none'})`,
            value: '__MANAGE_SETS__',
          },
          { title: '🔤 Switch to Name Mode', value: '__NAME_MODE__' },
        ]

  // Edit mode pares the menu down to mode switching, save/exit, and undo — the
  // add-mode shortcuts (copies, notes, filters) only make sense while adding.
  const topItems: Choice[] =
    sessionMode === 'edit'
      ? [{ title: '➕ Switch to Add Mode', value: '__ADD_MODE__' }]
      : [
          ...(lastAdded
            ? [{ title: `➕ Add Another Copy (${lastAdded.name})`, value: '__ADD_ANOTHER__' }]
            : []),
          ...(lastAdded && !lastAdded.hasNote
            ? [{ title: `📝 Add Note (${lastAdded.name})`, value: '__ADD_NOTE__' }]
            : []),
          ...extraItems,
          ...modeItems,
          { title: '🛠️  Switch to Edit Mode (edit existing cards)', value: '__EDIT_MODE__' },
        ]

  return [
    ...topItems,
    ...(changeCount > 0
      ? [{ title: `💾 Save ${changeCount} change(s) (keep editing)`, value: '__SAVE__' }]
      : []),
    { title: '🚪 Exit', value: '__EXIT__' },
    ...(sessionMode === 'add' && lastAdded
      ? [{ title: `✏️  Edit Previous Card (${lastAdded.name})`, value: '__EDIT_LAST__' }]
      : []),
    ...(sessionAdds.length > 0
      ? [
          {
            title: `↩️  Undo Last Add (${sessionAdds[sessionAdds.length - 1]!.name})`,
            value: '__UNDO_LAST__',
          },
        ]
      : []),
    ...(editUndoLabel !== null
      ? [{ title: `↩️  Undo Last Edit (${editUndoLabel})`, value: '__UNDO_EDIT__' }]
      : []),
    ...(sessionChangeCount > 0
      ? [{ title: `📋 View Session Changes (${sessionChangeCount})`, value: '__CHANGES__' }]
      : []),
    ...cardChoices,
  ]
}

/** A collector-mode choice with its value still concretely typed (before widening to Choice). */
type CollectorChoice = { title: string; value: CollectorChoiceValue }

/** Build the collector-mode card choices for a set, sorted numerically by collector number. */
export function buildCollectorChoices(setCardMap: Map<string, ScryfallCard>): Choice[] {
  const collectorChoices: CollectorChoice[] = []
  for (const [num, card] of setCardMap) {
    collectorChoices.push({ title: `${num} - ${card.name}`, value: { type: 'card', num, card } })
  }
  collectorChoices.sort((a, b) => {
    const numA = parseInt(a.value.num, 10) || 0
    const numB = parseInt(b.value.num, 10) || 0
    if (numA !== numB) return numA - numB
    return a.value.num.localeCompare(b.value.num)
  })
  return collectorChoices
}

/** Filter choices so every space-separated term of `input` appears in the title. */
function filterByTerms(input: string, choices: Choice[]): Choice[] {
  return choices.filter((choice) => matchesAllTerms(choice.title, input))
}

/**
 * Name-mode suggestion filter: empty input shows the menu shortcuts; otherwise
 * all space-separated terms must appear in a title. A trailing `!` marks the
 * selection to force the finish/condition prompts past any session defaults.
 */
export function suggestNameMode(input: string, choices: Choice[]): Choice[] {
  const isForce = input.endsWith('!')
  const cleanInput = isForce ? input.slice(0, -1) : input

  if (!cleanInput) return choices.filter(isMenuChoice)

  const matches = filterByTerms(cleanInput, choices)

  if (isForce) {
    return matches.map((m) =>
      isMenuChoice(m)
        ? m
        : {
            ...m,
            title: `${m.title} (Force Options)`,
            value: `${m.value}__FORCE__`,
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
 * Collector-mode suggestion filter: empty input shows the menu shortcuts;
 * otherwise filters printings by collector-number prefix (menu items stay).
 */
export function suggestCollectorMode(input: string, choices: Choice[]): Choice[] {
  if (!input) return choices.filter(isMenuChoice)
  return choices.filter((choice) => {
    if (!isCollectorChoiceValue(choice.value)) return true
    return choice.value.num.startsWith(input)
  })
}

// ── The session loop ────────────────────────────────────────────────

/** Inputs to {@link runCardSession}. */
export type CardSessionOptions = {
  strategy: CardSessionStrategy
  /** Initial autocomplete card names (already filtered by the session's set codes). */
  cardNames: string[]
  excludeDigitalOnly: boolean
}

/** Persist the in-memory list model and append the session changelog, when either is pending. */
async function saveSession(strategy: CardSessionStrategy, ctx: CardSessionContext): Promise<void> {
  if (strategy.hasUnsavedChanges()) {
    await strategy.persist()
    console.log('Changes saved.')
  }
  if (ctx.sessionChanges.length > 0) {
    await appendChangelog(strategy.filePath, strategy.listName, ctx.sessionChanges, {
      continueSession: ctx.hasSavedChangelog,
    })
    ctx.hasSavedChangelog = true
    console.log('Changelog saved.')
  }
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
      console.log('No changes this session.')
      return
    }
    const response = (await prompts({
      type: 'select',
      name: 'index',
      message: `${items.length} change(s) this session — select one to discard it:`,
      choices: [
        ...items.map((item, index) => ({ title: item.label, value: index })).reverse(),
        { title: '← Back', value: null },
      ],
    })) as ChangeIndexPromptResponse
    if (response.index == null) return
    const item = items[response.index]
    if (!item) return
    if (item.blocked) {
      console.log(`Cannot discard this change yet — ${item.blocked}.`)
      continue
    }
    const confirmResponse = (await prompts({
      type: 'confirm',
      name: 'confirm',
      message: `Discard ${item.label}?`,
      initial: false,
    })) as ConfirmPromptResponse
    if (confirmResponse.confirm) {
      await strategy.discardSessionChange(ctx, response.index)
    }
  }
}

/**
 * Run the interactive card-entry loop until the user exits. Changes accumulate
 * on the in-memory list model; Save writes the file and the session changelog
 * without leaving the session, and Exit (or Esc) opens the shared exit menu to
 * save and exit, exit without saving, or keep editing.
 */
export async function runCardSession(options: CardSessionOptions): Promise<void> {
  const { strategy, excludeDigitalOnly } = options
  const { sessionConfig } = strategy
  let cardNames = options.cardNames
  let sessionMode: SessionMode = 'add'

  const ctx: CardSessionContext = {
    sessionChanges: [],
    lastChangeIndex: null,
    lastAdded: null,
    lastAddedCount: 0,
    hasSavedChangelog: false,
  }

  while (true) {
    let isExited = false
    let forcePrompts = false
    let isEditing = false

    const activeSet = sessionConfig.collectorSets[sessionConfig.activeSetIndex] || ''
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
          : buildCollectorChoices(
              sessionConfig.setCardMaps.get(activeSet.toLowerCase()) ??
                new Map<string, ScryfallCard>(),
            )

    const sessionAdds = strategy.listSessionAdds?.() ?? []

    const choices = buildMenuChoices({
      sessionMode,
      mode: sessionConfig.entryMode,
      lastAdded: ctx.lastAdded,
      changeCount: ctx.sessionChanges.length,
      activeSet,
      extraItems: strategy.extraMenuItems?.() ?? [],
      sessionAdds,
      editUndoLabel: strategy.lastEditUndoLabel(),
      sessionChangeCount: strategy.listSessionChanges().length,
      cardChoices,
    })

    const streakHint: string =
      ctx.lastAdded && ctx.lastAddedCount > 0
        ? ` (${ctx.lastAddedCount}x ${ctx.lastAdded.name})`
        : ''
    const promptMessage: string =
      sessionMode === 'edit'
        ? 'Search for a card to edit'
        : sessionConfig.entryMode === 'name'
          ? `Enter card name to add${streakHint}`
          : `Enter collector # for ${activeSet.toUpperCase() || 'SET'}${streakHint}`

    const response = (await prompts({
      type: 'autocomplete',
      name: 'cardName',
      message: promptMessage,
      choices,
      limit: 10,
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

    if (isExited || response.cardName === '__EXIT__') {
      if (ctx.sessionChanges.length > 0 || strategy.hasUnsavedChanges()) {
        const choice = await promptExitMenu(ctx.sessionChanges.length)
        if (choice === 'cancel') continue
        if (choice === 'save') await saveSession(strategy, ctx)
        else console.log('Discarded all unsaved changes.')
      }
      console.log(`Exiting ${strategy.managerLabel}.`)
      break
    }

    if (response.cardName === '__SAVE__') {
      await saveSession(strategy, ctx)
      // Everything up to here is committed: the undo/discard menus reset so a
      // later undo can never claw back changes that are already on disk.
      strategy.sessionSaved()
      ctx.sessionChanges = []
      ctx.lastChangeIndex = null
      ctx.lastAdded = null
      ctx.lastAddedCount = 0
      continue
    }

    if (!response.cardName) {
      console.error('❌ Card not found.')
      if (sessionConfig.sets && sessionConfig.sets.length > 0) {
        console.warn(
          `(Note: Set filters are active: ${formatSetCodesForDisplay(sessionConfig.sets)}. The card might exist in a different set.)`,
        )
      }
      continue
    }

    // ── Menu actions ──────────────────────────────────────────────
    if (response.cardName === '__ADD_ANOTHER__' && ctx.lastAdded) {
      await strategy.addAnotherCopy(ctx)
      continue
    }

    if (response.cardName === '__ADD_NOTE__' && ctx.lastAdded) {
      const target: LastAdded = ctx.lastAdded
      const noteResponse = (await prompts({
        type: 'text',
        name: 'note',
        message: 'Enter note:',
      })) as NotePromptResponse
      const note = noteResponse.note?.trim()
      if (note) {
        const change = createSetNoteChange(target.name, { note, cardId: target.cardId })
        strategy.applyChange(change)
        // Notes never become the in-place edit target, so lastChangeIndex stays put.
        ctx.sessionChanges.push(change)
        ctx.lastAdded = { ...target, hasNote: true }
        strategy.noteAdded?.(note)
        console.log(`Note added to ${target.name}: ${note}`)
      }
      continue
    }

    if (response.cardName === '__EDIT_MODE__') {
      sessionMode = 'edit'
      console.log('Switched to edit mode. Pick an existing card to change or remove it.')
      continue
    }

    if (response.cardName === '__ADD_MODE__') {
      sessionMode = 'add'
      console.log('Switched to add mode.')
      continue
    }

    if (response.cardName === '__UNDO_EDIT__') {
      await strategy.undoLastEdit(ctx)
      continue
    }

    if (response.cardName === '__COLLECTOR_MODE__') {
      if (sessionConfig.collectorSets.length === 0) {
        const setsResponse = (await prompts({
          type: 'text',
          name: 'sets',
          message: 'Enter set codes to use (comma-separated, e.g., "FDN, SPG"):',
          validate: (val: string) =>
            val.trim().length > 0 ? true : 'At least one set code required',
        })) as SetsPromptResponse
        if (!setsResponse.sets) continue
        await loadCollectorSets(sessionConfig, parseSetCodesInput(setsResponse.sets))
      }
      sessionConfig.entryMode = 'collector'
      console.log(
        `Switched to collector number mode. Active set: ${sessionConfig.collectorSets[sessionConfig.activeSetIndex]?.toUpperCase()}`,
      )
      continue
    }

    if (response.cardName === '__NAME_MODE__') {
      sessionConfig.entryMode = 'name'
      console.log('Switched to name mode.')
      continue
    }

    if (response.cardName === '__MANAGE_SETS__') {
      await manageSetCodes(sessionConfig)
      continue
    }

    if (response.cardName === '__CONFIG__') {
      cardNames = await strategy.updateConfig(excludeDigitalOnly)
      continue
    }

    if (response.cardName === '__UNDO_LAST__' && strategy.discardSessionAdd) {
      if (sessionAdds.length > 0) await strategy.discardSessionAdd(ctx, sessionAdds.length - 1)
      continue
    }

    if (response.cardName === '__CHANGES__') {
      await viewSessionChanges(strategy, ctx)
      continue
    }

    if (
      typeof response.cardName === 'string' &&
      MENU_SENTINELS.has(response.cardName) &&
      response.cardName !== '__EDIT_LAST__'
    ) {
      if (strategy.handleSentinel && (await strategy.handleSentinel(ctx, response.cardName))) {
        continue
      }
      // An unhandled sentinel (e.g. __ADD_ANOTHER__ with no last card) is ignored.
      continue
    }

    // ── Resolve the chosen card ───────────────────────────────────
    let cardName: string
    let preselected: ScryfallCard | null = null

    if (typeof response.cardName === 'string') {
      cardName = response.cardName
      if (cardName.endsWith('__FORCE__')) {
        cardName = cardName.replace('__FORCE__', '')
        forcePrompts = true
      }
      if (cardName === '__EDIT_LAST__') {
        if (!ctx.lastAdded) continue
        cardName = ctx.lastAdded.name
        forcePrompts = true
        isEditing = true
        console.log(`Editing: ${ctx.lastAdded.name}`)
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

    await strategy.handleCard(ctx, { cardName, preselected, forcePrompts, isEditing })
  }
}
